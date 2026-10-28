import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {queryMock,clientQueryMock,connectMock,verifyMock,hashMock}=vi.hoisted(()=>({queryMock:vi.fn(),clientQueryMock:vi.fn(),connectMock:vi.fn(),verifyMock:vi.fn(),hashMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:queryMock,connect:connectMock}}));
vi.mock('argon2',()=>({default:{verify:verifyMock,hash:hashMock},argon2id:2}));
vi.mock('../src/auth.js',async()=>{
  const actual=await vi.importActual<typeof import('../src/auth.js')>('../src/auth.js');
  return {...actual,authenticate:async(request:{userId:string})=>{request.userId='00000000-0000-4000-8000-000000000002'}};
});

import { sessionDigest } from '../src/auth.js';
import { registerProfileRoutes } from '../src/routes/profile.js';

describe('personal password changes',()=>{
  beforeEach(()=>{
    queryMock.mockReset();clientQueryMock.mockReset();connectMock.mockReset();verifyMock.mockReset();hashMock.mockReset();
    connectMock.mockResolvedValue({query:clientQueryMock,release:vi.fn()});
    hashMock.mockResolvedValue('new-password-hash');
  });

  it('clears the temporary flag and revokes all sessions except the current one',async()=>{
    const app=Fastify();await app.register(cookie);registerProfileRoutes(app);await app.ready();
    queryMock.mockResolvedValue({rows:[{passwordHash:'old-password-hash'}]});
    verifyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    clientQueryMock.mockResolvedValue({rows:[]});

    const response=await app.inject({
      method:'POST',url:'/api/profile/password',headers:{cookie:'worth_session=current-token'},
      payload:{currentPassword:'temporary-pass-123',newPassword:'personal-pass-456'},
    });

    expect(response.statusCode).toBe(204);
    expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain('must_change_password=false');
    expect(clientQueryMock.mock.calls[2]).toEqual([
      'DELETE FROM sessions WHERE user_id=$1 AND NOT (token_hash=ANY($2::text[]))',
      ['00000000-0000-4000-8000-000000000002',[sessionDigest('current-token')]],
    ]);
    await app.close();
  });

  it('rejects an incorrect current password without changing data',async()=>{
    const app=Fastify();await app.register(cookie);registerProfileRoutes(app);await app.ready();
    queryMock.mockResolvedValue({rows:[{passwordHash:'old-password-hash'}]});
    verifyMock.mockResolvedValue(false);

    const response=await app.inject({method:'POST',url:'/api/profile/password',payload:{currentPassword:'wrong-password',newPassword:'personal-pass-456'}});

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({error:'CURRENT_PASSWORD_INVALID'});
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });
});
