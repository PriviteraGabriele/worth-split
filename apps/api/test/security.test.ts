import { readdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {queryMock,verifyMock}=vi.hoisted(()=>({queryMock:vi.fn(),verifyMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{
  query:queryMock,
  connect:async()=>({query:queryMock,release:()=>undefined}),
}}));
vi.mock('argon2',()=>({default:{verify:verifyMock,hash:async()=>'hash'},argon2id:2}));

import { buildApp } from '../src/app.js';
import { sessionDigest as sessionDigestOf } from '../src/auth.js';

const config={
  NODE_ENV:'test' as const,
  DATABASE_URL:'postgres://test',
  SESSION_SECRET:'a'.repeat(32),
  APP_ORIGIN:'https://app.example.it',
  API_PORT:3000,
  SESSION_DAYS:30,
  COOKIE_SECURE:true,
  TRUST_PROXY:'loopback,linklocal,uniquelocal',
  // Production keeps operation logging on: its asynchronous onSend hook delays
  // every response, which is what exposes guards that rely on reply.sent.
  OPERATION_LOG_ENABLED:true,
  ELASTICSEARCH_URL:'http://127.0.0.1:9',
};
const sessions:Record<string,{userId:string;role:'user'|'admin';mustChangePassword:boolean}>={
  'user-token':{userId:'00000000-0000-4000-8000-000000000001',role:'user',mustChangePassword:false},
  'admin-token':{userId:'00000000-0000-4000-8000-000000000002',role:'admin',mustChangePassword:false},
};
const sourceDir=join(import.meta.dirname,'../src');
const sourceFiles=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>
  entry.isDirectory()?sourceFiles(join(dir,entry.name)):entry.name.endsWith('.ts')?[join(dir,entry.name)]:[]);
const routes=sourceFiles(sourceDir).flatMap((file)=>[...readFileSync(file,'utf8').matchAll(/app\.(get|post|put|patch|delete)\('(\/api\/[^']+)'/g)]
  .map((match)=>({method:match[1]!.toUpperCase() as 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:match[2]!.replace(':id','00000000-0000-4000-8000-0000000000aa')})));
const publicRoutes=new Set(['POST /api/auth/login','POST /api/auth/logout','POST /api/auth/password-reset/request','POST /api/auth/password-reset']);

async function createApp(){
  const app=await buildApp(config,{logger:false});
  await app.ready();
  return app;
}

const isTelemetry=(sql:string)=>sql.includes('operation_log_outbox');
const applicationQueries=()=>queryMock.mock.calls.filter(([sql])=>!isTelemetry(String(sql)));

// Every statement takes a few milliseconds, like a real database round trip.
function routeDatabase(){
  queryMock.mockImplementation(async(sql:string,values:unknown[]=[])=>{
    await new Promise((resolve)=>setTimeout(resolve,2));
    if(sql.includes('FROM sessions s JOIN users u')){
      const session=Object.entries(sessions).find(([token])=>(values[0] as string[]).includes(sessionDigestOf(token)));
      return {rows:session?[session[1]]:[],rowCount:session?1:0};
    }
    if(sql.includes('COALESCE(MAX(sort_order)'))return {rows:[{next:0}],rowCount:1};
    if(sql.startsWith('INSERT')&&sql.includes('RETURNING id'))return {rows:[{id:'00000000-0000-4000-8000-0000000000ee'}],rowCount:1};
    return {rows:[],rowCount:0};
  });
}

async function settle(){
  await new Promise((resolve)=>setTimeout(resolve,50));
}

describe('API security',()=>{
  beforeEach(()=>{queryMock.mockReset();verifyMock.mockReset();routeDatabase()});

  it('discovers the API routes to check',()=>{
    expect(routes.length).toBeGreaterThan(40);
  });

  it('rejects anonymous requests on every private route before touching the database',async()=>{
    const app=await createApp();
    for(const route of routes.filter((candidate)=>!publicRoutes.has(`${candidate.method} ${candidate.url}`))){
      const response=await app.inject({method:route.method,url:route.url,...(route.method==='GET'||route.method==='DELETE'?{}:{payload:{}})});
      expect(response.statusCode,`${route.method} ${route.url}`).toBe(401);
      expect(response.json(),`${route.method} ${route.url}`).toEqual({error:'UNAUTHENTICATED'});
    }
    await settle();
    expect(applicationQueries()).toEqual([]);
    await app.close();
  });

  it('rejects regular users on every administration route',async()=>{
    const app=await createApp();
    const adminRoutes=routes.filter((route)=>route.url.startsWith('/api/admin/'));
    expect(adminRoutes.length).toBeGreaterThan(0);
    for(const route of adminRoutes){
      const response=await app.inject({method:route.method,url:route.url,cookies:{worth_session:'user-token'},...(route.method==='GET'||route.method==='DELETE'?{}:{payload:{}})});
      expect(response.statusCode,`${route.method} ${route.url}`).toBe(403);
      expect(response.json()).toEqual({error:'ADMIN_REQUIRED'});
    }
    await settle();
    expect(applicationQueries().every(([sql])=>String(sql).includes('FROM sessions s JOIN users u'))).toBe(true);
    await app.close();
  });

  it('runs no route logic for an account that must still change its temporary password',async()=>{
    sessions['temporary-token']={userId:'00000000-0000-4000-8000-000000000003',role:'admin',mustChangePassword:true};
    const app=await createApp();
    const response=await app.inject({method:'POST',url:'/api/admin/users',cookies:{worth_session:'temporary-token'},payload:{email:'new@example.it',temporaryPassword:'temporary-password'}});
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({error:'PASSWORD_CHANGE_REQUIRED'});
    await settle();
    expect(applicationQueries().every(([sql])=>String(sql).includes('FROM sessions s JOIN users u'))).toBe(true);
    delete sessions['temporary-token'];
  });

  it('only interpolates code constants into SQL text',()=>{
    const allowed=new Set(['userFields','userSelection','profileFields','avatarVersionColumn']);
    const interpolated=sourceFiles(sourceDir).flatMap((file)=>{
      const source=readFileSync(file,'utf8');
      return [...source.matchAll(/\.query(?:<[^>]*>)?\(\s*`([^`]*)`/g)].flatMap((match)=>[...match[1]!.matchAll(/\$\{([^}]+)\}/g)].map((value)=>`${file}: ${value[1]}`));
    });
    expect(interpolated.filter((value)=>!allowed.has(value.split(': ')[1]!.trim()))).toEqual([]);
  });

  it('passes SQL injection payloads only as bound parameters',async()=>{
    const app=await createApp();
    const payload="x'); DROP TABLE users; -- INJECTED";
    const cookies={worth_session:'user-token'};
    const bucketId='00000000-0000-4000-8000-0000000000bb';
    const requests=[
      {method:'POST',url:'/api/buckets',payload:{name:payload,description:payload,type:'saving',icon:payload.slice(0,30),color:'#112233'}},
      {method:'PATCH',url:`/api/buckets/${bucketId}`,payload:{name:payload,description:payload,type:'saving',icon:'piggy',color:'#112233'}},
      {method:'PATCH',url:'/api/profile',payload:{firstName:payload.slice(0,60),lastName:payload.slice(0,60),gender:null}},
      {method:'POST',url:'/api/templates',payload:{name:payload.slice(0,60),items:[{bucketId,amountCents:'100'}]}},
      {method:'POST',url:'/api/transfers',payload:{fromBucketId:bucketId,toBucketId:'00000000-0000-4000-8000-0000000000cc',amountCents:'100',note:payload,idempotencyKey:'00000000-0000-4000-8000-0000000000dd'}},
      {method:'POST',url:'/api/planned-expenses',payload:{name:payload,description:payload,bucketId,amountCents:'100',amountMode:'fixed',frequency:'monthly',startMonth:'2026-01'}},
    ] as const;
    for(const request of requests){
      const response=await app.inject({...request,cookies});
      expect(response.statusCode,`${request.method} ${request.url}`).toBeLessThan(500);
    }
    const statements=applicationQueries().map(([sql])=>String(sql));
    const values=applicationQueries().flatMap(([,parameters])=>(parameters as unknown[]|undefined)??[]);
    expect(statements.length).toBeGreaterThan(requests.length);
    expect(statements.filter((sql)=>sql.includes('INJECTED'))).toEqual([]);
    expect(values.some((value)=>typeof value==='string'&&value.includes('INJECTED'))).toBe(true);
    await app.close();
  });

  it('rejects injection attempts in identifiers and filters during validation',async()=>{
    const app=await createApp();
    const cookies={worth_session:'user-token'};
    for(const url of [
      "/api/buckets/1'%20OR%20'1'='1/adjust",
      "/api/operations?bucketId=1'%20OR%201=1--",
      '/api/operations?year=2026;DROP%20TABLE%20users',
      "/api/planned-expenses?month=2026-01'--",
    ]){
      const response=await app.inject(url.endsWith('/adjust')?{method:'POST',url,cookies,payload:{}}:{method:'GET',url,cookies});
      expect(response.statusCode,url).toBe(400);
      expect(response.json().error).toBe('VALIDATION_ERROR');
    }
    // Only the session lookups reached the database.
    expect(applicationQueries().every(([sql])=>String(sql).includes('FROM sessions s JOIN users u'))).toBe(true);
    await app.close();
  });

  it('ignores fields that would escalate privileges',async()=>{
    const app=await createApp();
    await app.inject({method:'PATCH',url:'/api/profile',cookies:{worth_session:'user-token'},payload:{firstName:'Ada',lastName:null,gender:null,role:'admin',isActive:true,mustChangePassword:false}});
    const update=queryMock.mock.calls.find(([sql])=>String(sql).startsWith('UPDATE users'));
    expect(String(update?.[0]).split('RETURNING')[0]).not.toMatch(/role|is_active|password/);
    expect(update?.[1]).toEqual(['Ada',null,null,sessions['user-token']!.userId]);
    await app.close();
  });

  it('rejects amounts that could overflow a balance before reaching the database',async()=>{
    const app=await createApp();
    const response=await app.inject({method:'POST',url:'/api/transfers',cookies:{worth_session:'user-token'},payload:{
      fromBucketId:'00000000-0000-4000-8000-0000000000bb',toBucketId:'00000000-0000-4000-8000-0000000000cc',
      amountCents:'9'.repeat(25),idempotencyKey:'00000000-0000-4000-8000-0000000000dd',
    }});
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('reports values PostgreSQL cannot store as a client error',async()=>{
    const app=await createApp();
    queryMock.mockImplementation(async(sql:string,values:unknown[]=[])=>{
      if(sql.includes('FROM sessions s JOIN users u'))return {rows:(values[0] as string[]).includes(sessionDigestOf('user-token'))?[sessions['user-token']]:[],rowCount:1};
      if(sql.startsWith('INSERT INTO templates'))throw Object.assign(new Error('value out of range'),{code:'22003'});
      return {rows:[],rowCount:0};
    });
    const response=await app.inject({method:'POST',url:'/api/templates',cookies:{worth_session:'user-token'},payload:{name:'Stipendio',items:[{bucketId:'00000000-0000-4000-8000-0000000000bb',amountCents:'100'}]}});
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({error:'INVALID_INPUT'});
    await app.close();
  });

  it('never exposes internal error details',async()=>{
    const app=await createApp();
    queryMock.mockImplementation(async(sql:string,values:unknown[]=[])=>{
      if(sql.includes('FROM sessions s JOIN users u'))return {rows:(values[0] as string[]).includes(sessionDigestOf('user-token'))?[sessions['user-token']]:[],rowCount:1};
      throw new Error('relation "secret_table" does not exist at 10.0.0.5');
    });
    const response=await app.inject({method:'GET',url:'/api/buckets',cookies:{worth_session:'user-token'}});
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('{"error":"INTERNAL_ERROR"}');
    await app.close();
  });

  it('rejects prototype pollution and non-JSON bodies',async()=>{
    const app=await createApp();
    const polluted=await app.inject({method:'PATCH',url:'/api/profile',cookies:{worth_session:'user-token'},headers:{'content-type':'application/json'},
      payload:'{"firstName":"a","lastName":null,"gender":null,"__proto__":{"role":"admin"}}'});
    expect(polluted.statusCode).toBe(400);
    // A cross-site HTML form can only send these content types: none of them
    // is accepted as a JSON command.
    for(const contentType of ['text/plain','application/x-www-form-urlencoded','multipart/form-data; boundary=x']){
      const response=await app.inject({method:'POST',url:'/api/backup/reset',cookies:{worth_session:'user-token'},headers:{'content-type':contentType},payload:'mode=total&confirmation=RESET_TOTAL'});
      expect([400,415],contentType).toContain(response.statusCode);
    }
    await settle();
    expect(queryMock.mock.calls.some(([sql])=>String(sql).startsWith('DELETE'))).toBe(false);
    await app.close();
  });

  it('only allows the application origin to make credentialed cross-origin requests',async()=>{
    const app=await createApp();
    const allowed=await app.inject({method:'OPTIONS',url:'/api/buckets',headers:{origin:config.APP_ORIGIN,'access-control-request-method':'POST'}});
    expect(allowed.headers['access-control-allow-origin']).toBe(config.APP_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied=await app.inject({method:'OPTIONS',url:'/api/buckets',headers:{origin:'https://evil.example',  'access-control-request-method':'POST'}});
    // The allowed origin is fixed: a browser on another origin sees a mismatch
    // and withholds the response.
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    await app.close();
  });

  it('issues a hardened session cookie and stores only its hash',async()=>{
    const app=await createApp();
    queryMock.mockImplementation(async(sql:string)=>sql.includes('FROM users WHERE email')
      ?{rows:[{id:sessions['user-token']!.userId,email:'ada@example.it',role:'user',firstName:null,lastName:null,gender:null,isActive:true,mustChangePassword:false,passwordHash:'stored-hash'}],rowCount:1}
      :{rows:[],rowCount:1});
    verifyMock.mockResolvedValue(true);
    const response=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'ada@example.it',password:'correct-password'}});
    expect(response.statusCode).toBe(200);
    const cookie=response.cookies.find((candidate)=>candidate.name==='worth_session');
    expect(cookie).toMatchObject({httpOnly:true,secure:true,sameSite:'Strict',path:'/'});
    expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const insert=queryMock.mock.calls.find(([sql])=>String(sql).includes('INSERT INTO sessions'));
    expect(insert?.[1]).toContain(sessionDigestOf(cookie!.value));
    expect(insert?.[1]).not.toContain(cookie!.value);
    await app.close();
  });

  it('spends the same password work on unknown e-mails',async()=>{
    const app=await createApp();
    verifyMock.mockResolvedValue(false);
    const response=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'nobody@example.it',password:'guess'}});
    expect(response.statusCode).toBe(401);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock.mock.calls[0]![0]).toMatch(/^\$argon2id\$/);
    await app.close();
  });

  it('marks API responses as not cacheable',async()=>{
    const app=await createApp();
    const authenticated=await app.inject({method:'GET',url:'/api/buckets',cookies:{worth_session:'user-token'}});
    const anonymous=await app.inject({method:'GET',url:'/api/buckets'});
    expect(authenticated.headers['cache-control']).toBe('no-store');
    expect(anonymous.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('limits login attempts per client IP',async()=>{
    const app=await createApp();
    verifyMock.mockResolvedValue(false);
    const statuses=[];
    for(let attempt=0;attempt<6;attempt++){
      statuses.push((await app.inject({method:'POST',url:'/api/auth/login',payload:{email:`user-${attempt}@example.it`,password:'guess'}})).statusCode);
    }
    expect(statuses).toEqual([401,401,401,401,401,429]);
    await app.close();
  });

  it('limits expensive backup imports per client IP',async()=>{
    const app=await createApp();
    const statuses=[];
    for(let attempt=0;attempt<6;attempt++){
      statuses.push((await app.inject({method:'POST',url:'/api/backup/import',cookies:{worth_session:'user-token'},payload:{}})).statusCode);
    }
    expect(statuses).toEqual([400,400,400,400,400,429]);
    await app.close();
  });

  it('rejects oversized request bodies',async()=>{
    const app=await createApp();
    const response=await app.inject({method:'POST',url:'/api/backup/validate',cookies:{worth_session:'user-token'},payload:{padding:'x'.repeat(3*1024*1024)}});
    expect(response.statusCode).toBe(413);
    await app.close();
  });
});
