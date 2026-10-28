import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {queryMock,connectMock}=vi.hoisted(()=>({queryMock:vi.fn(),connectMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:queryMock,connect:connectMock}}));

import { registerAuth } from '../src/auth.js';
import { registerAdminUserRoutes } from '../src/routes/adminUsers.js';

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

describe('admin account authorization',()=>{
  beforeEach(()=>{queryMock.mockReset();connectMock.mockReset()});

  it('rejects permanent user deletion from a regular account',async()=>{
    const app=Fastify();
    await app.register(cookie);
    registerAuth(app,config);
    registerAdminUserRoutes(app);
    await app.ready();
    queryMock.mockResolvedValue({rows:[{
      userId:'00000000-0000-4000-8000-000000000002',
      role:'user',
      mustChangePassword:false,
    }]});

    const response=await app.inject({
      method:'DELETE',
      url:'/api/admin/users/00000000-0000-4000-8000-000000000003',
      headers:{cookie:'worth_session=regular-user-session'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({error:'ADMIN_REQUIRED'});
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    {method:'PATCH' as const,url:'/api/admin/users/00000000-0000-4000-8000-000000000003/role',payload:{role:'admin'}},
    {method:'PATCH' as const,url:'/api/admin/users/00000000-0000-4000-8000-000000000003',payload:{email:'x@example.it',firstName:null,lastName:null}},
  ])('rejects $method $url from a regular account',async({method,url,payload})=>{
    const app=Fastify();
    await app.register(cookie);
    registerAuth(app,config);
    registerAdminUserRoutes(app);
    await app.ready();
    queryMock.mockResolvedValue({rows:[{userId:'00000000-0000-4000-8000-000000000002',role:'user',mustChangePassword:false}]});

    const response=await app.inject({method,url,payload,headers:{cookie:'worth_session=regular-user-session'}});

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({error:'ADMIN_REQUIRED'});
    expect(connectMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
