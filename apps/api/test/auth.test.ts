import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {queryMock,verifyMock}=vi.hoisted(()=>({queryMock:vi.fn(),verifyMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:queryMock}}));
vi.mock('argon2',()=>({default:{verify:verifyMock},argon2id:2}));

import { registerAuth,requireAuth,sessionDigest } from '../src/auth.js';

const config={
  NODE_ENV:'test' as const,
  DATABASE_URL:'postgres://test',
  SESSION_SECRET:'a'.repeat(32),
  APP_ORIGIN:'http://localhost:5173',
  API_PORT:3000,
  SESSION_DAYS:30,
  COOKIE_SECURE:false,
  TRUST_PROXY:'loopback',
};

describe('authentication and temporary passwords',()=>{
  beforeEach(()=>{queryMock.mockReset();verifyMock.mockReset()});

  it('does not expose the password hash after login',async()=>{
    const app=Fastify();
    await app.register(cookie);
    registerAuth(app,config);
    queryMock
      .mockResolvedValueOnce({rows:[{
        id:'00000000-0000-4000-8000-000000000001',email:'admin@example.it',role:'admin',
        firstName:null,lastName:null,gender:null,isActive:true,mustChangePassword:false,passwordHash:'secret-hash',
      }]})
      .mockResolvedValueOnce({rows:[]});
    verifyMock.mockResolvedValue(true);

    const response=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'ADMIN@example.it',password:'valid-password'}});

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({email:'admin@example.it',role:'admin'});
    expect(response.json().user).not.toHaveProperty('passwordHash');
    await app.close();
  });

  it('blocks application routes until a temporary password is replaced',async()=>{
    const app=Fastify();
    await app.register(cookie);
    app.decorateRequest('userId','');
    app.decorateRequest('userRole','user');
    app.decorateRequest('mustChangePassword',false);
    app.get('/private',{preHandler:requireAuth},async()=>({private:true}));
    queryMock.mockResolvedValue({rows:[{userId:'00000000-0000-4000-8000-000000000002',role:'user',mustChangePassword:true}]});

    const response=await app.inject({method:'GET',url:'/private',headers:{cookie:'worth_session=temporary-session'}});

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({error:'PASSWORD_CHANGE_REQUIRED'});
    await app.close();
  });

  it('rejects sessions belonging to inactive users',async()=>{
    const app=Fastify();
    await app.register(cookie);
    app.decorateRequest('userId','');
    app.decorateRequest('userRole','user');
    app.decorateRequest('mustChangePassword',false);
    app.get('/private',{preHandler:requireAuth},async()=>({private:true}));
    queryMock.mockResolvedValue({rows:[]});

    const response=await app.inject({method:'GET',url:'/private',headers:{cookie:'worth_session=disabled-session'}});

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({error:'UNAUTHENTICATED'});
    await app.close();
  });
});

describe('switching accounts in the same browser',()=>{
  const userA={userId:'00000000-0000-4000-8000-00000000000a',role:'user',mustChangePassword:false};
  const userB={userId:'00000000-0000-4000-8000-00000000000b',role:'user',mustChangePassword:false};
  beforeEach(()=>{queryMock.mockReset();verifyMock.mockReset()});

  async function privateApp(){
    const app=Fastify();
    await app.register(cookie);
    app.decorateRequest('userId','');
    app.decorateRequest('userRole','user');
    app.decorateRequest('mustChangePassword',false);
    app.get('/private',{preHandler:requireAuth},async request=>({userId:request.userId}));
    return app;
  }
  // Answers the session lookup from a token → user table, like the database.
  function sessionsFor(live:Record<string,typeof userA>){
    queryMock.mockImplementation(async(sql:string,values:unknown[]=[])=>{
      if(!sql.includes('FROM sessions s JOIN users u'))return {rows:[],rowCount:0};
      const digests=values[0] as string[];
      return {rows:Object.entries(live).filter(([token])=>digests.includes(sessionDigest(token))).map(([,user])=>user)};
    });
  }

  it('uses the live session even when a stale cookie of the previous user comes first',async()=>{
    const app=await privateApp();
    sessionsFor({'session-b':userB});

    const response=await app.inject({method:'GET',url:'/private',headers:{cookie:'worth_session=closed-session-a; worth_session=session-b'}});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({userId:userB.userId});
    await app.close();
  });

  it('refuses to guess when the browser carries live sessions of two accounts',async()=>{
    const app=await privateApp();
    sessionsFor({'session-a':userA,'session-b':userB});

    const response=await app.inject({method:'GET',url:'/private',headers:{cookie:'worth_session=session-a; worth_session=session-b'}});

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('closes every session the browser carried when another account signs in',async()=>{
    const app=Fastify();
    await app.register(cookie);
    registerAuth(app,config);
    queryMock
      .mockResolvedValueOnce({rows:[{id:userB.userId,email:'b@example.it',role:'user',firstName:null,lastName:null,gender:null,isActive:true,mustChangePassword:false,avatarVersion:null,passwordHash:'hash'}]})
      .mockResolvedValueOnce({rows:[]});
    verifyMock.mockResolvedValue(true);

    const response=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'b@example.it',password:'valid-password'},headers:{cookie:'worth_session=session-a; worth_session=old-session-a'}});

    expect(response.statusCode).toBe(200);
    const insert=queryMock.mock.calls[1]!;
    expect(String(insert[0])).toContain('DELETE FROM sessions WHERE token_hash=ANY($4::text[])');
    expect(insert[1]?.[3]).toEqual([sessionDigest('session-a'),sessionDigest('old-session-a')]);
    expect(response.cookies.find(cookie=>cookie.name==='worth_session')?.value).not.toBe('session-a');
    await app.close();
  });

  it('ends every session the browser carried on logout, not only the first',async()=>{
    const app=Fastify();
    await app.register(cookie);
    registerAuth(app,config);
    queryMock.mockResolvedValue({rows:[]});

    const response=await app.inject({method:'POST',url:'/api/auth/logout',headers:{cookie:'worth_session=session-a; worth_session=old-session-a'}});

    expect(response.statusCode).toBe(204);
    expect(queryMock).toHaveBeenCalledWith('DELETE FROM sessions WHERE token_hash=ANY($1::text[])',[[sessionDigest('session-a'),sessionDigest('old-session-a')]]);
    expect(response.cookies.find(cookie=>cookie.name==='worth_session')?.expires?.getTime()).toBeLessThan(Date.now());
    await app.close();
  });
});
