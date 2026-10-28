import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { passwordSchema, requireAdmin } from '../auth.js';
import { pool } from '../db/pool.js';
import { emailSchema } from '../http/validation.js';
import { avatarVersionColumn } from '../services/avatar.js';
import { resetUserData } from '../services/dataReset.js';
import { disabledMailer, sendInBackground, type Mailer } from '../services/mailer.js';
import { emailChangedEmail, inviteEmail, issuePasswordToken, passwordChangedEmail, passwordLink, resetEmail } from '../services/passwordLinks.js';

const userId = z.string().uuid();
const optionalName = z.union([z.string().trim().max(60), z.null()]);
const roleSchema = z.enum(['user', 'admin']);
// Without a temporary password the account is created with an unusable one
// and the user receives an e-mail invitation to choose their own.
const createUserInput = z.object({
  email: emailSchema,
  temporaryPassword: passwordSchema.optional(),
  firstName: optionalName.optional(),
  lastName: optionalName.optional(),
  role: roleSchema.default('user'),
});
const updateUserInput = z.object({ email: emailSchema, firstName: optionalName, lastName: optionalName });
const roleInput = z.object({ role: roleSchema });
const activeInput = z.object({ isActive: z.boolean() });
const resetPasswordInput = z.object({ temporaryPassword: passwordSchema });
const passwordLinkInput = z.object({ purpose: z.enum(['invite', 'reset']).default('reset') });
const userFields = `id,email,role,first_name AS "firstName",last_name AS "lastName",gender,
  is_active AS "isActive",must_change_password AS "mustChangePassword",created_at AS "createdAt",${avatarVersionColumn}`;
const clean = (value: string | null | undefined) => value?.trim() || null;

export type AdminMailOptions = { mailer: Mailer; appOrigin: string };

export function registerAdminUserRoutes(app: FastifyInstance, mail: AdminMailOptions = { mailer: disabledMailer, appOrigin: '' }): void {
  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => ({
    users: (await pool.query(`SELECT ${userFields} FROM users ORDER BY created_at,id`)).rows,
  }));

  app.post('/api/admin/users', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const input = createUserInput.parse(request.body);
    const invite = input.temporaryPassword === undefined;
    if (invite && !mail.mailer.enabled) return reply.code(503).send({ error: 'MAIL_NOT_CONFIGURED' });
    const passwordHash = await argon2.hash(input.temporaryPassword ?? randomBytes(32).toString('base64url'), { type: argon2.argon2id });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; email: string; firstName: string | null }>(
        `INSERT INTO users(email,password_hash,role,first_name,last_name,must_change_password)
         VALUES($1,$2,$3,$4,$5,true) RETURNING ${userFields}`,
        [input.email.toLowerCase(), passwordHash, input.role, clean(input.firstName), clean(input.lastName)],
      );
      const user = result.rows[0]!;
      await client.query('INSERT INTO user_settings(user_id) VALUES($1)', [user.id]);
      const token = invite ? await issuePasswordToken(client, user.id, 'invite') : null;
      await client.query('COMMIT');
      if (!token) return reply.code(201).send({ user });
      // The account exists even if delivery fails: the administrator can
      // send the invitation again from the account list.
      const inviteSent = await mail.mailer.send(inviteEmail(user, passwordLink(mail.appOrigin, token))).then(() => true, (error: unknown) => {
        request.log.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Invitation e-mail not sent');
        return false;
      });
      return reply.code(201).send({ user, inviteSent });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  // Name and login e-mail of a regular account. Administrators edit their own
  // data from the profile, and other administrators must be demoted first.
  app.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const targetId = userId.parse((request.params as { id: string }).id);
    const input = updateUserInput.parse(request.body);
    if (targetId === request.userId) return reply.code(409).send({ error: 'CANNOT_MANAGE_SELF' });
    const email = input.email.toLowerCase();
    const client = await pool.connect();
    let previous: { email: string; firstName: string | null } | undefined;
    try {
      await client.query('BEGIN');
      previous = (await client.query<{ email: string; firstName: string | null }>(
        `SELECT email,first_name AS "firstName" FROM users WHERE id=$1 AND role='user' FOR UPDATE`,
        [targetId],
      )).rows[0];
      if (!previous) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }
      const result = await client.query(
        `UPDATE users SET email=$1,first_name=$2,last_name=$3,updated_at=now()
         WHERE id=$4 AND role='user' RETURNING ${userFields}`,
        [email, clean(input.firstName), clean(input.lastName), targetId],
      );
      // A password link delivered to the old address, or a session opened
      // with it, must not outlive the change of login e-mail.
      const emailChanged = previous.email !== email;
      if (emailChanged) {
        await client.query('DELETE FROM password_tokens WHERE user_id=$1', [targetId]);
        await client.query('DELETE FROM sessions WHERE user_id=$1', [targetId]);
      }
      await client.query('COMMIT');
      if (emailChanged) sendInBackground(mail.mailer, request.log, emailChangedEmail(previous));
      return { user: result.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  // Promote or demote another account. The requester can never change their
  // own role, so at least one administrator always remains.
  app.patch('/api/admin/users/:id/role', { preHandler: requireAdmin }, async (request, reply) => {
    const targetId = userId.parse((request.params as { id: string }).id);
    const input = roleInput.parse(request.body);
    if (targetId === request.userId) return reply.code(409).send({ error: 'CANNOT_MANAGE_SELF' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<{ isActive: boolean }>(
        'SELECT is_active AS "isActive" FROM users WHERE id=$1 FOR UPDATE',
        [targetId],
      );
      const user = target.rows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }
      // Disabled administrators could not be reactivated or deleted.
      if (input.role === 'admin' && !user.isActive) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'USER_MUST_BE_ACTIVE' });
      }
      const result = await client.query(
        `UPDATE users SET role=$1,updated_at=now() WHERE id=$2 RETURNING ${userFields}`,
        [input.role, targetId],
      );
      await client.query('COMMIT');
      return { user: result.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/admin/users/:id/status', { preHandler: requireAdmin }, async (request, reply) => {
    const targetId = userId.parse((request.params as { id: string }).id);
    const input = activeInput.parse(request.body);
    if (targetId === request.userId) return reply.code(409).send({ error: 'CANNOT_MANAGE_SELF' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE users SET is_active=$1,updated_at=now() WHERE id=$2 AND role='user' RETURNING ${userFields}`,
        [input.isActive, targetId],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }
      // A disabled account keeps no usable credential: reactivation must not
      // revive a password link issued before.
      if (!input.isActive) {
        await client.query('DELETE FROM sessions WHERE user_id=$1', [targetId]);
        await client.query('DELETE FROM password_tokens WHERE user_id=$1', [targetId]);
      }
      await client.query('COMMIT');
      return { user: result.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/admin/users/:id', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const targetId = userId.parse((request.params as { id: string }).id);
    if (targetId === request.userId) return reply.code(409).send({ error: 'CANNOT_MANAGE_SELF' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<{ role: 'user' | 'admin'; isActive: boolean }>(
        `SELECT role,is_active AS "isActive" FROM users WHERE id=$1`,
        [targetId],
      );
      const user = target.rows[0];
      if (!user || user.role !== 'user') {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }
      if (user.isActive) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'USER_MUST_BE_DISABLED' });
      }
      await resetUserData(client, targetId, 'total');
      const deleted = await client.query(
        `DELETE FROM users WHERE id=$1 AND role='user' AND is_active=false RETURNING id`,
        [targetId],
      );
      if (!deleted.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'USER_MUST_BE_DISABLED' });
      }
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/admin/users/:id/reset-password', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const targetId = userId.parse((request.params as { id: string }).id);
    const input = resetPasswordInput.parse(request.body);
    if (targetId === request.userId) return reply.code(409).send({ error: 'CANNOT_MANAGE_SELF' });
    const passwordHash = await argon2.hash(input.temporaryPassword, { type: argon2.argon2id });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ email: string; firstName: string | null }>(
        `UPDATE users SET password_hash=$1,must_change_password=true,updated_at=now()
         WHERE id=$2 AND role='user' RETURNING email,first_name AS "firstName"`,
        [passwordHash, targetId],
      );
      const user = result.rows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }
      await client.query('DELETE FROM sessions WHERE user_id=$1', [targetId]);
      // An earlier link would otherwise undo the reset.
      await client.query('DELETE FROM password_tokens WHERE user_id=$1', [targetId]);
      await client.query('COMMIT');
      sendInBackground(mail.mailer, request.log, passwordChangedEmail(user, 'admin'));
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  // E-mails a single-use link to choose a password: an invitation sent again
  // or a reset requested by the administrator. The current password keeps
  // working until the link is used.
  app.post('/api/admin/users/:id/password-link', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const targetId = userId.parse((request.params as { id: string }).id);
    const input = passwordLinkInput.parse(request.body ?? {});
    if (targetId === request.userId) return reply.code(409).send({ error: 'CANNOT_MANAGE_SELF' });
    if (!mail.mailer.enabled) return reply.code(503).send({ error: 'MAIL_NOT_CONFIGURED' });
    const client = await pool.connect();
    let issued: { user: { email: string; firstName: string | null }; token: string };
    try {
      await client.query('BEGIN');
      const user = (await client.query<{ email: string; firstName: string | null }>(
        `SELECT email,first_name AS "firstName" FROM users WHERE id=$1 AND role='user' AND is_active=true FOR UPDATE`,
        [targetId],
      )).rows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }
      issued = { user, token: await issuePasswordToken(client, targetId, input.purpose) };
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const url = passwordLink(mail.appOrigin, issued.token);
    try {
      await mail.mailer.send(input.purpose === 'invite' ? inviteEmail(issued.user, url) : resetEmail(issued.user, url));
    } catch (error) {
      request.log.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Password link e-mail not sent');
      return reply.code(502).send({ error: 'MAIL_DELIVERY_FAILED' });
    }
    return reply.code(204).send();
  });
}
