import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const {clientQueryMock,connectMock,hashMock,poolQueryMock,verifyMock}=vi.hoisted(()=>({clientQueryMock:vi.fn(),connectMock:vi.fn(),hashMock:vi.fn(),poolQueryMock:vi.fn(),verifyMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:poolQueryMock,connect:connectMock}}));
vi.mock('argon2',()=>({default:{hash:hashMock,verify:verifyMock},argon2id:2}));
vi.mock('../src/auth.js',async()=>{
  const actual=await vi.importActual<typeof import('../src/auth.js')>('../src/auth.js');
  return {
    ...actual,
    requireAdmin:async(request:{userId:string;userRole:string})=>{request.userId='00000000-0000-4000-8000-000000000001';request.userRole='admin'},
    authenticate:async(request:{userId:string})=>{request.userId='00000000-0000-4000-8000-000000000003'},
  };
});

import { registerAuth } from '../src/auth.js';
import { registerAdminUserRoutes } from '../src/routes/adminUsers.js';
import { registerProfileRoutes } from '../src/routes/profile.js';
import { disabledMailer,type Mailer,type MailMessage } from '../src/services/mailer.js';
import { inviteEmail,passwordTokenDigest } from '../src/services/passwordLinks.js';

const config={
  NODE_ENV:'test' as const,
  DATABASE_URL:'postgres://test',
  SESSION_SECRET:'a'.repeat(32),
  APP_ORIGIN:'https://worth.example.it',
  API_PORT:3000,
  SESSION_DAYS:30,
  COOKIE_SECURE:false,
  TRUST_PROXY:'loopback',
};
const userId='00000000-0000-4000-8000-000000000002';
const sendMock=vi.fn<(message:MailMessage)=>Promise<void>>();
const mailer:Mailer={enabled:true,send:sendMock};
const token='t'.repeat(43);

// Answers by statement so the tests do not depend on the exact query order.
function database(answers:Array<[string,unknown[]]>){
  clientQueryMock.mockImplementation(async(sql:string)=>{
    const match=answers.find(([fragment])=>sql.includes(fragment));
    const rows=match?.[1]??[];
    return {rows,rowCount:rows.length};
  });
}
const statements=()=>clientQueryMock.mock.calls.map(([sql])=>String(sql));
const linkToken=(message:MailMessage)=>/#token=([\w-]+)/.exec(message.text)?.[1];

async function authApp(withMailer=mailer){
  const app=Fastify();await app.register(cookie);registerAuth(app,config,withMailer);await app.ready();return app;
}

describe('password links by e-mail',()=>{
  beforeEach(()=>{
    clientQueryMock.mockReset();connectMock.mockReset();hashMock.mockReset();poolQueryMock.mockReset();verifyMock.mockReset();sendMock.mockReset();
    connectMock.mockResolvedValue({query:clientQueryMock,release:vi.fn()});
    hashMock.mockResolvedValue('new-password-hash');
    sendMock.mockResolvedValue();
  });

  it('e-mails a reset link to an active account without revealing it in the response',async()=>{
    database([['FROM users WHERE email=$1',[{id:userId,email:'anna@example.it',firstName:'Anna'}]]]);
    const app=await authApp();

    const response=await app.inject({method:'POST',url:'/api/auth/password-reset/request',payload:{email:'ANNA@example.it'}});

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    await vi.waitFor(()=>expect(sendMock).toHaveBeenCalledOnce());
    const message=sendMock.mock.calls[0]![0];
    expect(message.to).toBe('anna@example.it');
    expect(message.text).toContain('https://worth.example.it/reimposta-password#token=');
    const insert=clientQueryMock.mock.calls.find(([sql])=>String(sql).includes('INSERT INTO password_tokens'))!;
    expect(insert[1]).toEqual([userId,passwordTokenDigest(linkToken(message)!),'reset','1 hour']);
    expect(clientQueryMock.mock.calls.find(([sql])=>String(sql).includes('FROM users WHERE email=$1'))![1]).toEqual(['anna@example.it']);
    await app.close();
  });

  it('answers the same way for an unknown address and sends nothing',async()=>{
    database([]);
    const app=await authApp();

    const response=await app.inject({method:'POST',url:'/api/auth/password-reset/request',payload:{email:'nobody@example.it'}});

    expect(response.statusCode).toBe(204);
    await vi.waitFor(()=>expect(statements()).toContain('COMMIT'));
    expect(statements().some((sql)=>sql.includes('INSERT INTO password_tokens'))).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('sends at most one reset link per minute to the same account',async()=>{
    database([['FROM users WHERE email=$1',[{id:userId,email:'anna@example.it',firstName:null}]],["interval '1 minute'",[{}]]]);
    const app=await authApp();

    await app.inject({method:'POST',url:'/api/auth/password-reset/request',payload:{email:'anna@example.it'}});

    await vi.waitFor(()=>expect(statements()).toContain('COMMIT'));
    expect(statements().some((sql)=>sql.includes('INSERT INTO password_tokens'))).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not touch the database when no SMTP server is configured',async()=>{
    const app=await authApp(disabledMailer);
    const response=await app.inject({method:'POST',url:'/api/auth/password-reset/request',payload:{email:'anna@example.it'}});
    expect(response.statusCode).toBe(204);
    await new Promise((resolve)=>setTimeout(resolve,20));
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an unknown or expired link without changing any password',async()=>{
    database([]);
    const app=await authApp();

    const response=await app.inject({method:'POST',url:'/api/auth/password-reset',payload:{token,newPassword:'brand-new-pass-1'}});

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({error:'PASSWORD_TOKEN_INVALID'});
    expect(statements().some((sql)=>sql.startsWith('UPDATE users'))).toBe(false);
    expect(clientQueryMock.mock.calls.find(([sql])=>String(sql).includes('FROM password_tokens t'))![1]).toEqual([passwordTokenDigest(token)]);
    // An invalid link costs no Argon2 work.
    expect(hashMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('sets the new password, consumes every link, closes every session and sends a notice',async()=>{
    database([['FROM password_tokens t',[{userId,role:'user',email:'anna@example.it',firstName:'Anna',purpose:'reset'}]]]);
    const app=await authApp();

    const response=await app.inject({method:'POST',url:'/api/auth/password-reset',payload:{token,newPassword:'brand-new-pass-1'}});

    expect(response.statusCode).toBe(204);
    const calls=clientQueryMock.mock.calls.map(([sql,values])=>[String(sql),values]);
    expect(calls).toContainEqual(['UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',['new-password-hash',userId]]);
    expect(calls).toContainEqual(['DELETE FROM password_tokens WHERE user_id=$1',[userId]]);
    expect(calls).toContainEqual(['DELETE FROM sessions WHERE user_id=$1',[userId]]);
    await vi.waitFor(()=>expect(sendMock).toHaveBeenCalledOnce());
    expect(sendMock.mock.calls[0]![0].subject).toContain('Password modificata');
    await app.close();
  });

  it('sends no notice when an invited user chooses their first password',async()=>{
    database([['FROM password_tokens t',[{userId,role:'user',email:'anna@example.it',firstName:null,purpose:'invite'}]]]);
    const app=await authApp();

    const response=await app.inject({method:'POST',url:'/api/auth/password-reset',payload:{token,newPassword:'brand-new-pass-1'}});

    expect(response.statusCode).toBe(204);
    await new Promise((resolve)=>setTimeout(resolve,20));
    expect(sendMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('invitations from the administrator',()=>{
  beforeEach(()=>{
    clientQueryMock.mockReset();connectMock.mockReset();hashMock.mockReset();sendMock.mockReset();
    connectMock.mockResolvedValue({query:clientQueryMock,release:vi.fn()});
    hashMock.mockResolvedValue('unusable-password-hash');
    sendMock.mockResolvedValue();
  });

  const adminApp=async(withMailer=mailer)=>{const app=Fastify();registerAdminUserRoutes(app,{mailer:withMailer,appOrigin:config.APP_ORIGIN});await app.ready();return app};

  it('creates an account without a temporary password and e-mails a 7-day invitation',async()=>{
    database([['INSERT INTO users',[{id:userId,email:'nuovo@example.it',firstName:'Luca',mustChangePassword:true}]]]);
    const app=await adminApp();

    const response=await app.inject({method:'POST',url:'/api/admin/users',payload:{email:'nuovo@example.it',firstName:'Luca'}});

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({user:{email:'nuovo@example.it'},inviteSent:true});
    const message=sendMock.mock.calls[0]![0];
    expect(message.subject).toContain('Il tuo account è pronto');
    const insert=clientQueryMock.mock.calls.find(([sql])=>String(sql).includes('INSERT INTO password_tokens'))!;
    expect(insert[1]).toEqual([userId,passwordTokenDigest(linkToken(message)!),'invite','7 days']);
    // The stored password is random, never a known value.
    expect(hashMock.mock.calls[0]![0]).toMatch(/^[\w-]{43}$/);
    await app.close();
  });

  it('keeps the account and reports it when the invitation cannot be delivered',async()=>{
    database([['INSERT INTO users',[{id:userId,email:'nuovo@example.it',firstName:null}]]]);
    sendMock.mockRejectedValue(new Error('smtp down'));
    const app=await adminApp();

    const response=await app.inject({method:'POST',url:'/api/admin/users',payload:{email:'nuovo@example.it'}});

    expect(response.statusCode).toBe(201);
    expect(response.json().inviteSent).toBe(false);
    expect(statements()).toContain('COMMIT');
    await app.close();
  });

  it('refuses an invitation when e-mail is not configured',async()=>{
    const app=await adminApp(disabledMailer);
    const response=await app.inject({method:'POST',url:'/api/admin/users',payload:{email:'nuovo@example.it'}});
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({error:'MAIL_NOT_CONFIGURED'});
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('e-mails a new password link to an active regular account',async()=>{
    database([["AND role='user' AND is_active=true",[{email:'anna@example.it',firstName:'Anna'}]]]);
    const app=await adminApp();

    const response=await app.inject({method:'POST',url:`/api/admin/users/${userId}/password-link`,payload:{purpose:'invite'}});

    expect(response.statusCode).toBe(204);
    expect(sendMock.mock.calls[0]![0].subject).toContain('Il tuo account è pronto');
    await app.close();
  });

  it('reports a failed delivery of the password link',async()=>{
    database([["AND role='user' AND is_active=true",[{email:'anna@example.it',firstName:null}]]]);
    sendMock.mockRejectedValue(new Error('smtp down'));
    const app=await adminApp();

    const response=await app.inject({method:'POST',url:`/api/admin/users/${userId}/password-link`,payload:{}});

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({error:'MAIL_DELIVERY_FAILED'});
    await app.close();
  });

  it('does not send links for unknown, disabled or administrator accounts',async()=>{
    database([]);
    const app=await adminApp();
    const response=await app.inject({method:'POST',url:`/api/admin/users/${userId}/password-link`,payload:{}});
    expect(response.statusCode).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('warns the user when the administrator resets the password',async()=>{
    database([['UPDATE users SET password_hash',[{email:'anna@example.it',firstName:'Anna'}]]]);
    const app=await adminApp();

    const response=await app.inject({method:'POST',url:`/api/admin/users/${userId}/reset-password`,payload:{temporaryPassword:'temporary-pass-123'}});

    expect(response.statusCode).toBe(204);
    await vi.waitFor(()=>expect(sendMock).toHaveBeenCalledOnce());
    expect(sendMock.mock.calls[0]![0].text).toContain('un amministratore ha reimpostato la password');
    // A link sent before the reset would otherwise undo it.
    expect(clientQueryMock.mock.calls).toContainEqual(['DELETE FROM password_tokens WHERE user_id=$1',[userId]]);
    await app.close();
  });
});

describe('password change notice',()=>{
  beforeEach(()=>{
    clientQueryMock.mockReset();connectMock.mockReset();hashMock.mockReset();poolQueryMock.mockReset();verifyMock.mockReset();sendMock.mockReset();
    connectMock.mockResolvedValue({query:clientQueryMock,release:vi.fn()});
    clientQueryMock.mockResolvedValue({rows:[]});
    hashMock.mockResolvedValue('new-password-hash');
    verifyMock.mockImplementation(async(_hash:string,password:string)=>password==='current-password');
    sendMock.mockResolvedValue();
  });

  const change=async(mustChangePassword:boolean)=>{
    poolQueryMock.mockResolvedValue({rows:[{passwordHash:'old-hash',email:'anna@example.it',firstName:'Anna',mustChangePassword}]});
    const app=Fastify();await app.register(cookie);registerProfileRoutes(app,mailer);await app.ready();
    const response=await app.inject({method:'POST',url:'/api/profile/password',payload:{currentPassword:'current-password',newPassword:'brand-new-pass-1'}});
    await app.close();
    return response;
  };

  it('e-mails the user after a password change',async()=>{
    expect((await change(false)).statusCode).toBe(204);
    await vi.waitFor(()=>expect(sendMock).toHaveBeenCalledOnce());
    expect(sendMock.mock.calls[0]![0].to).toBe('anna@example.it');
  });

  it('revokes a pending reset link together with the old password',async()=>{
    expect((await change(false)).statusCode).toBe(204);
    expect(clientQueryMock.mock.calls).toContainEqual(['DELETE FROM password_tokens WHERE user_id=$1',['00000000-0000-4000-8000-000000000003']]);
  });

  it('does not e-mail when a temporary password is replaced on first access',async()=>{
    expect((await change(true)).statusCode).toBe(204);
    await new Promise((resolve)=>setTimeout(resolve,20));
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('e-mail templates',()=>{
  it('escapes user-provided names in the HTML body',()=>{
    const message=inviteEmail({email:'x@example.it',firstName:'<script>alert(1)</script>'},'https://worth.example.it/reimposta-password#token=abc');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&#60;script&#62;');
  });
});
