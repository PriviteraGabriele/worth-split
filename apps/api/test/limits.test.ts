import cookie from '@fastify/cookie';
import Fastify,{ type FastifyRequest } from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {queryMock}=vi.hoisted(()=>({queryMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:queryMock}}));

import { requireAuth,userWriteLimitOptions } from '../src/auth.js';
import { buildOperationDocument,isRejectedNoise,RejectedRequestBudget,type OperationLogDocument } from '../src/observability/operationLogging.js';
import { UserWriteLimiter } from '../src/security/userWriteLimit.js';
import { MailBudgetExceededError,withSendBudget,type MailMessage } from '../src/services/mailer.js';

const mail=(to:string):MailMessage=>({to,subject:'s',text:'t',html:'h'});

describe('writes per account',()=>{
  beforeEach(()=>queryMock.mockReset());

  it('counts writes per account and resets after the window',()=>{
    let now=0;
    const limiter=new UserWriteLimiter({max:2,windowMs:60_000,now:()=>now});
    expect(limiter.reserve('a')).toEqual({allowed:true});
    expect(limiter.reserve('a')).toEqual({allowed:true});
    expect(limiter.reserve('a')).toEqual({allowed:false,retryAfterSeconds:60});
    expect(limiter.reserve('b')).toEqual({allowed:true});
    now=60_000;
    expect(limiter.reserve('a')).toEqual({allowed:true});
  });

  it('limits the writes of one account whatever its IP, but never its reads',async()=>{
    const app=Fastify();await app.register(cookie);
    app.post('/api/write',{preHandler:requireAuth},async()=>({ok:true}));
    app.get('/api/read',{preHandler:requireAuth},async()=>({ok:true}));
    const session=(userId:string)=>queryMock.mockResolvedValue({rows:[{userId,role:'user',mustChangePassword:false}]});
    session('00000000-0000-4000-8000-0000000000a1');

    const statuses=[];
    for(let index=0;index<=userWriteLimitOptions.max;index++){
      statuses.push((await app.inject({method:'POST',url:'/api/write',cookies:{worth_session:'t'},remoteAddress:`198.51.100.${index%250}`})).statusCode);
    }
    expect(statuses.slice(0,-1).every((status)=>status===200)).toBe(true);
    const blocked=await app.inject({method:'POST',url:'/api/write',cookies:{worth_session:'t'}});
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({error:'RATE_LIMITED'});
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject({method:'GET',url:'/api/read',cookies:{worth_session:'t'}})).statusCode).toBe(200);

    session('00000000-0000-4000-8000-0000000000a2');
    expect((await app.inject({method:'POST',url:'/api/write',cookies:{worth_session:'t'}})).statusCode).toBe(200);
    await app.close();
  });
});

describe('e-mail sending budget',()=>{
  it('refuses messages past the hourly budget and frees it an hour later',async()=>{
    let now=0;
    const send=vi.fn(async()=>{});
    const mailer=withSendBudget({enabled:true,send},{hourly:3,perRecipientDaily:100,now:()=>now});
    for(let index=0;index<3;index++)await mailer.send(mail(`u${index}@example.it`));
    await expect(mailer.send(mail('u9@example.it'))).rejects.toBeInstanceOf(MailBudgetExceededError);
    expect(send).toHaveBeenCalledTimes(3);
    now=60*60_000;
    await expect(mailer.send(mail('u9@example.it'))).resolves.toBeUndefined();
  });

  it('caps the messages one recipient receives per day, whatever the case of the address',async()=>{
    let now=0;
    const send=vi.fn(async()=>{});
    const mailer=withSendBudget({enabled:true,send},{hourly:1000,perRecipientDaily:2,now:()=>now});
    await mailer.send(mail('anna@example.it'));
    await mailer.send(mail('Anna@Example.it'));
    await expect(mailer.send(mail('anna@example.it'))).rejects.toBeInstanceOf(MailBudgetExceededError);
    await expect(mailer.send(mail('bruno@example.it'))).resolves.toBeUndefined();
    now=24*60*60_000;
    await expect(mailer.send(mail('anna@example.it'))).resolves.toBeUndefined();
  });
});

describe('operation log volume',()=>{
  const document=(overrides:Partial<OperationLogDocument>)=>({operation:'buckets.list',http_status:200,user_id:null,...overrides}) as OperationLogDocument;

  it('treats throttled and anonymous rejected calls as noise, but keeps failed logins and user errors',()=>{
    expect(isRejectedNoise(document({http_status:429}))).toBe(true);
    expect(isRejectedNoise(document({http_status:401}))).toBe(true);
    expect(isRejectedNoise(document({http_status:401,operation:'auth.login'}))).toBe(false);
    expect(isRejectedNoise(document({http_status:401,user_id:'00000000-0000-4000-8000-0000000000a1'}))).toBe(false);
    expect(isRejectedNoise(document({http_status:404}))).toBe(false);
  });

  it('lets only a fixed number of noisy documents through per minute',()=>{
    let now=0;
    const budget=new RejectedRequestBudget(3,()=>now);
    expect([budget.take(),budget.take(),budget.take(),budget.take()]).toEqual([true,true,true,false]);
    now=60_000;
    expect(budget.take()).toBe(true);
  });

  it('keeps only short identifier-like query keys in the document',()=>{
    const request={
      method:'GET',routeOptions:{url:'/api/operations'},id:'r1',userId:'',userRole:'user',params:{},body:undefined,
      query:{limit:'10',['x'.repeat(40)]:'1','bad key\n{"index":{}}':'1',...Object.fromEntries(Array.from({length:20},(_,index)=>[`k${String(index).padStart(2,'0')}`,'1']))},
    } as unknown as FastifyRequest;
    const keys=buildOperationDocument(request,200)!.query_keys;
    expect(keys).toHaveLength(10);
    expect(keys.every((key)=>/^[A-Za-z0-9_]{1,32}$/.test(key))).toBe(true);
  });
});
