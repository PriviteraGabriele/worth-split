import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const {queryMock,verifyMock}=vi.hoisted(()=>({queryMock:vi.fn(),verifyMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:queryMock}}));
vi.mock('argon2',()=>({default:{verify:verifyMock},argon2id:2}));

import { trustProxyOption } from '../src/app.js';
import { loginThrottleOptions,registerAuth } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { LoginThrottle } from '../src/security/loginThrottle.js';

const config={
  NODE_ENV:'test' as const,
  DATABASE_URL:'postgres://test',
  SESSION_SECRET:'a'.repeat(32),
  APP_ORIGIN:'http://localhost:5173',
  API_PORT:3000,
  SESSION_DAYS:30,
  COOKIE_SECURE:false,
  TRUST_PROXY:'loopback,linklocal,uniquelocal',
};
const user={
  id:'00000000-0000-4000-8000-000000000001',email:'admin@example.it',role:'admin',
  firstName:null,lastName:null,gender:null,isActive:true,mustChangePassword:false,passwordHash:'secret-hash',
};

describe('login throttle',()=>{
  const options={maxAttempts:3,windowMs:60_000,lockMs:120_000,maxEntries:100};

  it('locks an account after too many attempts and reports when to retry',()=>{
    let now=0;
    const throttle=new LoginThrottle({...options,now:()=>now});
    for(let attempt=0;attempt<3;attempt++)expect(throttle.reserve('a@example.it')).toEqual({allowed:true});

    expect(throttle.reserve('a@example.it')).toEqual({allowed:false,retryAfterSeconds:120});
    now=119_500;
    expect(throttle.reserve('a@example.it')).toEqual({allowed:false,retryAfterSeconds:1});
    expect(throttle.reserve('b@example.it')).toEqual({allowed:true});
    now=120_000;
    expect(throttle.reserve('a@example.it')).toEqual({allowed:true});
  });

  it('starts a new window after the previous one expires',()=>{
    let now=0;
    const throttle=new LoginThrottle({...options,now:()=>now});
    for(let attempt=0;attempt<3;attempt++)throttle.reserve('a@example.it');
    now=60_000;
    for(let attempt=0;attempt<3;attempt++)expect(throttle.reserve('a@example.it').allowed).toBe(true);
  });

  it('forgets previous failures after a successful login',()=>{
    const throttle=new LoginThrottle(options);
    for(let attempt=0;attempt<3;attempt++)throttle.reserve('a@example.it');
    throttle.succeed('a@example.it');
    expect(throttle.reserve('a@example.it').allowed).toBe(true);
  });

  it('keeps memory bounded under a flood of distinct e-mails',()=>{
    const throttle=new LoginThrottle({...options,maxEntries:10});
    for(let index=0;index<1000;index++)throttle.reserve(`random-${index}@example.it`);
    expect((throttle as unknown as {entries:Map<string,unknown>}).entries.size).toBeLessThanOrEqual(10);
  });
});

describe('login route brute-force protection',()=>{
  beforeEach(()=>{queryMock.mockReset();verifyMock.mockReset()});

  it('verifies only the allowed number of passwords during a concurrent burst',async()=>{
    const app=Fastify();
    await app.register(cookie);
    registerAuth(app,config);
    queryMock.mockResolvedValue({rows:[user]});
    verifyMock.mockImplementation(()=>new Promise((resolve)=>setTimeout(()=>resolve(false),5)));

    const responses=await Promise.all(Array.from({length:40},()=>app.inject({
      method:'POST',url:'/api/auth/login',payload:{email:'Admin@Example.it',password:'wrong-password'},
    })));

    expect(verifyMock).toHaveBeenCalledTimes(loginThrottleOptions.maxAttempts);
    expect(responses.filter((response)=>response.statusCode===401)).toHaveLength(loginThrottleOptions.maxAttempts);
    const blocked=responses.filter((response)=>response.statusCode===429);
    expect(blocked).toHaveLength(40-loginThrottleOptions.maxAttempts);
    expect(blocked[0]?.json()).toEqual({error:'TOO_MANY_LOGIN_ATTEMPTS'});
    expect(Number(blocked[0]?.headers['retry-after'])).toBeGreaterThan(0);
    await app.close();
  });

  it('applies the same lock to unknown e-mails so it does not reveal accounts',async()=>{
    const app=Fastify();
    await app.register(cookie);
    registerAuth(app,config);
    queryMock.mockResolvedValue({rows:[]});

    const statuses=[];
    for(let attempt=0;attempt<=loginThrottleOptions.maxAttempts;attempt++){
      statuses.push((await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'nobody@example.it',password:'x'}})).statusCode);
    }

    expect(statuses.slice(0,-1).every((status)=>status===401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    await app.close();
  });
});

describe('known devices during an account lock',()=>{
  const owner={...user,email:'owner@example.it'};
  const login=(app:Awaited<ReturnType<typeof Fastify>>,password:string,cookies:Record<string,string>={},email='owner@example.it')=>
    app.inject({method:'POST',url:'/api/auth/login',payload:{email,password},cookies});
  const lockOut=async(app:Awaited<ReturnType<typeof Fastify>>)=>{
    for(let attempt=0;attempt<=loginThrottleOptions.maxAttempts;attempt++)await login(app,'attacker-guess');
  };
  const deviceOf=(response:{cookies:Array<{name:string;value:string}>})=>response.cookies.find((cookie)=>cookie.name==='worth_device')?.value;

  beforeEach(()=>{
    queryMock.mockReset();verifyMock.mockReset();
    queryMock.mockResolvedValue({rows:[owner]});
    verifyMock.mockImplementation(async(_hash:string,password:string)=>password==='owner-password');
  });

  it('lets the owner sign in from a known device while strangers have locked the account',async()=>{
    const app=Fastify();await app.register(cookie);registerAuth(app,config);
    const first=await login(app,'owner-password');
    expect(first.statusCode).toBe(200);
    const device=deviceOf(first);
    expect(device).toBeDefined();

    await lockOut(app);
    expect((await login(app,'owner-password')).statusCode).toBe(429);
    expect((await login(app,'owner-password',{worth_device:device!})).statusCode).toBe(200);
    await app.close();
  });

  it('still limits guesses made through a known device',async()=>{
    const app=Fastify();await app.register(cookie);registerAuth(app,config);
    const device=deviceOf(await login(app,'owner-password'))!;
    const statuses=[];
    for(let attempt=0;attempt<=loginThrottleOptions.maxAttempts;attempt++)statuses.push((await login(app,'wrong',{worth_device:device})).statusCode);
    expect(statuses.at(-1)).toBe(429);
    expect((await login(app,'owner-password',{worth_device:device})).statusCode).toBe(429);
    await app.close();
  });

  it('ignores forged cookies and cookies issued for another account',async()=>{
    const app=Fastify();await app.register(cookie);registerAuth(app,config);
    const device=deviceOf(await login(app,'owner-password'))!;
    const [nonce]=device.split('.');
    await lockOut(app);

    expect((await login(app,'owner-password',{worth_device:`${nonce}.forged-proof`})).statusCode).toBe(429);
    queryMock.mockResolvedValue({rows:[{...owner,email:'other@example.it'}]});
    for(let attempt=0;attempt<=loginThrottleOptions.maxAttempts;attempt++)await login(app,'guess',{},'other@example.it');
    expect((await login(app,'owner-password',{worth_device:device},'other@example.it')).statusCode).toBe(429);
    await app.close();
  });

  it('binds the known-device cookie to the login path and keeps it out of scripts',async()=>{
    const app=Fastify();await app.register(cookie);registerAuth(app,config);
    const response=await login(app,'owner-password');
    const device=response.cookies.find((cookie:{name:string})=>cookie.name==='worth_device');
    expect(device).toMatchObject({path:'/api/auth',httpOnly:true,sameSite:'Strict'});
    await app.close();
  });
});

describe('client IP behind the reverse proxies',()=>{
  afterEach(()=>vi.unstubAllEnvs());

  it('ignores forged X-Forwarded-For entries when limiting by IP',async()=>{
    const app=Fastify({trustProxy:trustProxyOption(config.TRUST_PROXY)});
    await app.register(cookie);
    await app.register(rateLimit,{max:120,timeWindow:'1 minute',errorResponseBuilder:(_request,context)=>({statusCode:context.statusCode,code:'RATE_LIMITED'})});
    app.setErrorHandler((error:{statusCode?:number;code?:string},_request,reply)=>reply.code(error.statusCode??500).send({error:error.code}));
    registerAuth(app,config);
    queryMock.mockResolvedValue({rows:[]});

    // Nginx Proxy Manager appends the real client to whatever the client sent,
    // then the web container appends Nginx Proxy Manager.
    const attempt=(index:number)=>app.inject({
      method:'POST',url:'/api/auth/login',remoteAddress:'172.18.0.3',
      headers:{'x-forwarded-for':`198.51.100.${index}, 203.0.113.7, 172.18.0.2`},
      payload:{email:`user-${index}@example.it`,password:'x'},
    });
    const statuses=[];
    for(let index=0;index<6;index++)statuses.push((await attempt(index)).statusCode);

    expect(statuses).toEqual([401,401,401,401,401,429]);
    expect((await attempt(99)).json()).toEqual({error:'RATE_LIMITED'});
    await app.close();
  });

  it('accepts a hop count and rejects trusting every proxy',()=>{
    vi.stubEnv('DATABASE_URL','postgres://test');
    vi.stubEnv('SESSION_SECRET','a'.repeat(32));
    vi.stubEnv('APP_ORIGIN','http://localhost:5173');

    vi.stubEnv('TRUST_PROXY','2');
    const trust=trustProxyOption(loadConfig().TRUST_PROXY) as (address:string,hop:number)=>boolean;
    expect([trust('172.18.0.3',0),trust('172.18.0.2',1),trust('198.51.100.1',2)]).toEqual([true,true,false]);
    vi.stubEnv('TRUST_PROXY','true');
    expect(()=>loadConfig()).toThrow();
  });
});
