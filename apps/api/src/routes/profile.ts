import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, passwordSchema, presentedSessionTokens, requireAuth, sessionDigest } from '../auth.js';
import { pool } from '../db/pool.js';
import { AvatarError,avatarVersionColumn,parseAvatarDataUrl } from '../services/avatar.js';
import { disabledMailer, sendInBackground, type Mailer } from '../services/mailer.js';
import { passwordChangedEmail } from '../services/passwordLinks.js';

const optionalName = z.union([z.string().trim().max(60), z.null()]);
const profileInput = z.object({
  firstName: optionalName,
  lastName: optionalName,
  gender: z.enum(['male', 'female']).nullable(),
});
const passwordInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
// A 512 KB image is about 700 000 base64 characters.
const avatarInput = z.object({ image: z.string().max(720_000) });
const userId = z.string().uuid();
const profileFields = `id,email,role,first_name AS "firstName",last_name AS "lastName",gender,
  is_active AS "isActive",must_change_password AS "mustChangePassword",${avatarVersionColumn}`;

const clean = (value: string | null) => value?.trim() || null;

export function registerProfileRoutes(app: FastifyInstance, mailer: Mailer = disabledMailer): void {
  app.patch('/api/profile', { preHandler: requireAuth }, async (request) => {
    const input = profileInput.parse(request.body);
    const result = await pool.query(
      `UPDATE users SET first_name=$1,last_name=$2,gender=$3,updated_at=now() WHERE id=$4
       RETURNING ${profileFields}`,
      [clean(input.firstName), clean(input.lastName), input.gender, request.userId],
    );
    return { user: result.rows[0] };
  });

  app.put('/api/profile/avatar', {
    preHandler: requireAuth,
    bodyLimit: 1024 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const input = avatarInput.parse(request.body);
    let avatar: ReturnType<typeof parseAvatarDataUrl>;
    try { avatar = parseAvatarDataUrl(input.image); }
    catch (error) {
      if (error instanceof AvatarError) return reply.code(error.code === 'AVATAR_TOO_LARGE' ? 413 : 400).send({ error: error.code });
      throw error;
    }
    const result = await pool.query(
      `UPDATE users SET avatar=$1,avatar_mime=$2,avatar_updated_at=now(),updated_at=now() WHERE id=$3 RETURNING ${profileFields}`,
      [avatar.bytes, avatar.mime, request.userId],
    );
    return { user: result.rows[0] };
  });

  app.delete('/api/profile/avatar', { preHandler: requireAuth }, async (request) => {
    const result = await pool.query(
      `UPDATE users SET avatar=NULL,avatar_mime=NULL,avatar_updated_at=NULL,updated_at=now() WHERE id=$1 RETURNING ${profileFields}`,
      [request.userId],
    );
    return { user: result.rows[0] };
  });

  // Photos are visible to their owner and to administrators, who see them in
  // the accounts list. A photo is not financial data.
  app.get('/api/users/:id/avatar', { preHandler: requireAuth }, async (request, reply) => {
    const targetId = userId.parse((request.params as { id: string }).id);
    if (targetId !== request.userId && request.userRole !== 'admin') return reply.code(404).send({ error: 'AVATAR_NOT_FOUND' });
    const row = (await pool.query<{ avatar: Buffer | null; mime: string | null }>(
      'SELECT avatar,avatar_mime AS mime FROM users WHERE id=$1',
      [targetId],
    )).rows[0];
    if (!row?.avatar || !row.mime) return reply.code(404).send({ error: 'AVATAR_NOT_FOUND' });
    // The URL carries the version, so the browser may keep the image.
    return reply
      .header('content-type', row.mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .send(row.avatar);
  });

  app.post('/api/profile/password', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const input = passwordInput.parse(request.body);
    const user = (await pool.query<{ passwordHash: string; email: string; firstName: string | null; mustChangePassword: boolean }>(
      `SELECT password_hash AS "passwordHash",email,first_name AS "firstName",must_change_password AS "mustChangePassword"
       FROM users WHERE id=$1`,
      [request.userId],
    )).rows[0];
    if (!user || !(await argon2.verify(user.passwordHash, input.currentPassword))) {
      return reply.code(400).send({ error: 'CURRENT_PASSWORD_INVALID' });
    }
    if (await argon2.verify(user.passwordHash, input.newPassword)) {
      return reply.code(409).send({ error: 'PASSWORD_UNCHANGED' });
    }

    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    // The session in use is one of the cookies this browser sent; it stays open.
    const currentDigests = presentedSessionTokens(request).map(sessionDigest);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',
        [passwordHash, request.userId],
      );
      await client.query(
        'DELETE FROM sessions WHERE user_id=$1 AND NOT (token_hash=ANY($2::text[]))',
        [request.userId, currentDigests],
      );
      // A pending reset link would otherwise undo the new password.
      await client.query('DELETE FROM password_tokens WHERE user_id=$1', [request.userId]);
      await client.query('COMMIT');
      // Replacing a temporary password is the first access, not a change
      // the user needs to be warned about.
      if (!user.mustChangePassword) sendInBackground(mailer, request.log, passwordChangedEmail(user, 'user'));
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
