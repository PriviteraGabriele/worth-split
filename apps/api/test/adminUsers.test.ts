import Fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {clientQueryMock,connectMock,hashMock,poolQueryMock}=vi.hoisted(()=>({clientQueryMock:vi.fn(),connectMock:vi.fn(),hashMock:vi.fn(),poolQueryMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:poolQueryMock,connect:connectMock}}));
vi.mock('argon2',()=>({default:{hash:hashMock},argon2id:2}));
vi.mock('../src/auth.js',async()=>{
  const actual=await vi.importActual<typeof import('../src/auth.js')>('../src/auth.js');
  return {...actual,requireAdmin:async(request:{userId:string;userRole:string})=>{request.userId='00000000-0000-4000-8000-000000000001';request.userRole='admin'}};
});

import { registerAdminUserRoutes } from '../src/routes/adminUsers.js';

const createdUser={id:'00000000-0000-4000-8000-000000000002',email:'nuovo@example.it',role:'user',firstName:null,lastName:null,gender:null,isActive:true,mustChangePassword:true,createdAt:'2026-08-22T10:00:00Z'};

describe('admin account management',()=>{
  beforeEach(()=>{
    clientQueryMock.mockReset();connectMock.mockReset();hashMock.mockReset();poolQueryMock.mockReset();
    connectMock.mockResolvedValue({query:clientQueryMock,release:vi.fn()});
    hashMock.mockResolvedValue('temporary-password-hash');
  });

  it('creates an empty regular account with default settings and a temporary password',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[createdUser]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'POST',url:'/api/admin/users',payload:{email:'NUOVO@example.it',temporaryPassword:'temporary-pass-123'}});

    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({email:'nuovo@example.it',role:'user',mustChangePassword:true});
    expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain('VALUES($1,$2,$3,$4,$5,true)');
    expect(clientQueryMock.mock.calls[1]?.[1]).toEqual(['nuovo@example.it','temporary-password-hash','user',null,null]);
    expect(clientQueryMock.mock.calls[2]?.[0]).toContain('INSERT INTO user_settings');
    await app.close();
  });

  it('revokes every session when an account is disabled',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{...createdUser,isActive:false}],rowCount:1})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'PATCH',url:`/api/admin/users/${createdUser.id}/status`,payload:{isActive:false}});

    expect(response.statusCode).toBe(200);
    expect(clientQueryMock.mock.calls[2]).toEqual(['DELETE FROM sessions WHERE user_id=$1',[createdUser.id]]);
    // Reactivating the account later must not revive an older password link.
    expect(clientQueryMock.mock.calls[3]).toEqual(['DELETE FROM password_tokens WHERE user_id=$1',[createdUser.id]]);
    await app.close();
  });

  it('prevents the administrator from disabling their own account',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    const response=await app.inject({method:'PATCH',url:'/api/admin/users/00000000-0000-4000-8000-000000000001/status',payload:{isActive:false}});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({error:'CANNOT_MANAGE_SELF'});
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('permanently deletes a disabled regular account and its data in safe order',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{role:'user',isActive:false}],rowCount:1})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:createdUser.id}],rowCount:1})
      .mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'DELETE',url:`/api/admin/users/${createdUser.id}`});

    expect(response.statusCode).toBe(204);
    expect(clientQueryMock.mock.calls.slice(2,9)).toEqual([
      ['SELECT id FROM buckets WHERE user_id=$1 ORDER BY id FOR UPDATE',[createdUser.id]],
      ['DELETE FROM planned_expense_payments WHERE user_id=$1',[createdUser.id]],
      ['DELETE FROM planned_expense_occurrences WHERE user_id=$1',[createdUser.id]],
      ['DELETE FROM planned_expenses WHERE user_id=$1',[createdUser.id]],
      ['DELETE FROM templates WHERE user_id=$1',[createdUser.id]],
      ['DELETE FROM operations WHERE user_id=$1',[createdUser.id]],
      ['DELETE FROM buckets WHERE user_id=$1',[createdUser.id]],
    ]);
    expect(String(clientQueryMock.mock.calls[9]?.[0])).toContain("DELETE FROM users WHERE id=$1 AND role='user' AND is_active=false");
    expect(clientQueryMock.mock.calls[10]).toEqual(['COMMIT']);
    await app.close();
  });

  it('requires an account to be disabled before permanent deletion',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{role:'user',isActive:true}],rowCount:1})
      .mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'DELETE',url:`/api/admin/users/${createdUser.id}`});

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({error:'USER_MUST_BE_DISABLED'});
    expect(clientQueryMock).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM users'),expect.anything());
    expect(clientQueryMock.mock.calls[2]).toEqual(['ROLLBACK']);
    await app.close();
  });

  it('prevents the administrator from permanently deleting their own account',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    const response=await app.inject({method:'DELETE',url:'/api/admin/users/00000000-0000-4000-8000-000000000001'});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({error:'CANNOT_MANAGE_SELF'});
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });
  it('creates an administrator with a name when requested',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{...createdUser,role:'admin',firstName:'Giulia',lastName:'Ferri'}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'POST',url:'/api/admin/users',payload:{email:'giulia@example.it',temporaryPassword:'temporary-pass-123',firstName:'  Giulia ',lastName:'Ferri',role:'admin'}});

    expect(response.statusCode).toBe(201);
    expect(clientQueryMock.mock.calls[1]?.[1]).toEqual(['giulia@example.it','temporary-password-hash','admin','Giulia','Ferri']);
    await app.close();
  });

  it('updates the name and login e-mail of a regular account',async()=>{
    const sendMock=vi.fn(async()=>{});
    const app=Fastify();registerAdminUserRoutes(app,{mailer:{enabled:true,send:sendMock},appOrigin:''});await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{email:'vecchia@example.it',firstName:'Sara'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{...createdUser,email:'nuova@example.it',firstName:'Sara'}],rowCount:1})
      .mockResolvedValue({rows:[]});

    const response=await app.inject({method:'PATCH',url:`/api/admin/users/${createdUser.id}`,payload:{email:'Nuova@Example.it',firstName:' Sara ',lastName:''}});

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({email:'nuova@example.it',firstName:'Sara'});
    expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("WHERE id=$4 AND role='user'");
    expect(clientQueryMock.mock.calls[2]?.[1]).toEqual(['nuova@example.it','Sara',null,createdUser.id]);
    // The old address loses every way back in, and its owner is told.
    expect(clientQueryMock.mock.calls[3]).toEqual(['DELETE FROM password_tokens WHERE user_id=$1',[createdUser.id]]);
    expect(clientQueryMock.mock.calls[4]).toEqual(['DELETE FROM sessions WHERE user_id=$1',[createdUser.id]]);
    await vi.waitFor(()=>expect(sendMock).toHaveBeenCalledOnce());
    const notice=(sendMock.mock.calls[0] as unknown as [{to:string;text:string}])[0];
    expect(notice.to).toBe('vecchia@example.it');
    expect(notice.text).toContain('ha cambiato l’indirizzo email');
    expect(notice.text).not.toContain('nuova@example.it');
    await app.close();
  });

  it('keeps sessions and links when only the name changes',async()=>{
    const sendMock=vi.fn(async()=>{});
    const app=Fastify();registerAdminUserRoutes(app,{mailer:{enabled:true,send:sendMock},appOrigin:''});await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{email:'nuovo@example.it',firstName:null}],rowCount:1})
      .mockResolvedValueOnce({rows:[{...createdUser,firstName:'Sara'}],rowCount:1})
      .mockResolvedValue({rows:[]});

    const response=await app.inject({method:'PATCH',url:`/api/admin/users/${createdUser.id}`,payload:{email:'nuovo@example.it',firstName:'Sara',lastName:null}});

    expect(response.statusCode).toBe(200);
    expect(clientQueryMock.mock.calls.map(([sql])=>String(sql)).filter((sql)=>sql.startsWith('DELETE'))).toEqual([]);
    await new Promise((resolve)=>setTimeout(resolve,20));
    expect(sendMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not edit administrators or unknown accounts from the admin panel',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock.mockResolvedValue({rows:[],rowCount:0});

    const response=await app.inject({method:'PATCH',url:`/api/admin/users/${createdUser.id}`,payload:{email:'x@example.it',firstName:null,lastName:null}});

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({error:'USER_NOT_FOUND'});
    expect(clientQueryMock.mock.calls.map(([sql])=>String(sql)).some((sql)=>sql.startsWith('UPDATE'))).toBe(false);
    await app.close();
  });

  it('promotes another active account to administrator',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{isActive:true}],rowCount:1})
      .mockResolvedValueOnce({rows:[{...createdUser,role:'admin'}],rowCount:1})
      .mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'PATCH',url:`/api/admin/users/${createdUser.id}/role`,payload:{role:'admin'}});

    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe('admin');
    expect(clientQueryMock.mock.calls[2]?.[1]).toEqual(['admin',createdUser.id]);
    expect(clientQueryMock.mock.calls[3]).toEqual(['COMMIT']);
    await app.close();
  });

  it('refuses to promote a disabled account',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{isActive:false}],rowCount:1})
      .mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'PATCH',url:`/api/admin/users/${createdUser.id}/role`,payload:{role:'admin'}});

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({error:'USER_MUST_BE_ACTIVE'});
    expect(clientQueryMock.mock.calls[2]).toEqual(['ROLLBACK']);
    await app.close();
  });

  it('never lets administrators change their own role or data',async()=>{
    const app=Fastify();registerAdminUserRoutes(app);await app.ready();
    const self='00000000-0000-4000-8000-000000000001';
    const role=await app.inject({method:'PATCH',url:`/api/admin/users/${self}/role`,payload:{role:'user'}});
    const data=await app.inject({method:'PATCH',url:`/api/admin/users/${self}`,payload:{email:'a@example.it',firstName:null,lastName:null}});
    expect(role.statusCode).toBe(409);
    expect(data.statusCode).toBe(409);
    expect(connectMock).not.toHaveBeenCalled();
    expect(poolQueryMock).not.toHaveBeenCalled();
    await app.close();
  });
});
