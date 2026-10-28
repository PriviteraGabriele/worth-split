import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db/pool.js';
import type { Config } from './config.js';
import { emailSchema } from './http/validation.js';
import { LoginThrottle } from './security/loginThrottle.js';
import { UserWriteLimiter } from './security/userWriteLimit.js';
import { avatarVersionColumn } from './services/avatar.js';
import { disabledMailer, sendInBackground, type Mailer } from './services/mailer.js';
import { issuePasswordToken, passwordChangedEmail, passwordLink, passwordTokenDigest, resetEmail } from './services/passwordLinks.js';

export type UserRole = 'user' | 'admin';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    userRole: UserRole;
    mustChangePassword: boolean;
  }
}

const credentials = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const passwordSchema = z.string().min(12).max(128);
const resetRequestInput = z.object({ email: emailSchema });
const resetConfirmInput = z.object({ token: z.string().min(32).max(128), newPassword: passwordSchema });
export const sessionDigest = (token: string) => createHash('sha256').update(token).digest('hex');
// Verifying against a throwaway hash when the e-mail is unknown makes both
// failures cost the same Argon2 work, so response timing cannot reveal
// which accounts exist.
const unknownUserPasswordHash = '$argon2id$v=19$m=65536,t=3,p=4$AowNnKZ9IZ8Icd+CXFP1WQ$RBKrY55WUxBbOn4zaMtSe+tAZWhRX08vFSlpQN2NwLE';
export const loginThrottleOptions = { maxAttempts: 10, windowMs: 15 * 60_000, lockMs: 15 * 60_000, maxEntries: 10_000 };

// A browser that already signed in to an account gets a signed "known device"
// cookie bound to that e-mail. Its attempts count in their own bucket, so an
// attacker who locks the account from elsewhere cannot lock out its owner.
// The cookie is not a credential: it only changes which counter applies.
const deviceCookie = 'worth_device';
const deviceCookieDays = 365;
const deviceProof = (secret: string, nonce: string, email: string) =>
  createHmac('sha256', secret).update(`${nonce}|${email}`).digest('base64url');

export function knownDevice(secret: string, value: string | undefined, email: string): string | undefined {
  const [nonce, proof, extra] = value?.split('.') ?? [];
  if (!nonce || !proof || extra !== undefined) return undefined;
  const expected = Buffer.from(deviceProof(secret, nonce, email));
  const actual = Buffer.from(proof);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? nonce : undefined;
}

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  firstName: string | null;
  lastName: string | null;
  gender: 'male' | 'female' | null;
  isActive: boolean;
  mustChangePassword: boolean;
  avatarVersion: string | null;
};

const userSelection = `SELECT id,email,role,first_name AS "firstName",last_name AS "lastName",gender,
  is_active AS "isActive",must_change_password AS "mustChangePassword",${avatarVersionColumn} FROM users`;
const publicUser = (user: UserRow): UserRow => ({
  id: user.id,
  email: user.email,
  role: user.role,
  firstName: user.firstName,
  lastName: user.lastName,
  gender: user.gender,
  isActive: user.isActive,
  mustChangePassword: user.mustChangePassword,
  avatarVersion: user.avatarVersion,
});

/**
 * Every session cookie the browser sent, not only the first. A browser can
 * hold more than one (for example a cookie left by an older version with
 * another path or domain), and `request.cookies` exposes only the first: that
 * may be a stale session of the previous user, which a logout would not close.
 */
export function presentedSessionTokens(request: FastifyRequest): string[] {
  const tokens = new Set<string>();
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== 'worth_session') continue;
    const value = part.slice(separator + 1).trim();
    if (value && value.length <= 256) tokens.add(value);
  }
  return [...tokens].slice(0, 5);
}

// Issues a reset link for an active account and e-mails it. Unknown and
// disabled addresses are silently ignored.
async function sendResetLink(email: string, mailer: Mailer, appOrigin: string, log: FastifyBaseLogger): Promise<void> {
  if (!mailer.enabled) {
    log.warn('Password reset requested but no SMTP server is configured');
    return;
  }
  const client = await pool.connect();
  let issued: { recipient: { email: string; firstName: string | null }; token: string } | undefined;
  try {
    await client.query('BEGIN');
    const user = (await client.query<{ id: string; email: string; firstName: string | null }>(
      `SELECT id,email,first_name AS "firstName" FROM users WHERE email=$1 AND is_active=true FOR UPDATE`,
      [email],
    )).rows[0];
    // At most one link per minute and account, so the form cannot be used to
    // flood someone's inbox.
    const recent = user
      ? (await client.query(`SELECT 1 FROM password_tokens WHERE user_id=$1 AND created_at>now()-interval '1 minute'`, [user.id])).rowCount
      : 0;
    if (user && !recent) issued = { recipient: user, token: await issuePasswordToken(client, user.id, 'reset') };
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (issued) await mailer.send(resetEmail(issued.recipient, passwordLink(appOrigin, issued.token)));
}

export function registerAuth(app: FastifyInstance, config: Config, mailer: Mailer = disabledMailer): void {
  app.decorateRequest('userId', '');
  app.decorateRequest('userRole', 'user');
  app.decorateRequest('mustChangePassword', false);
  const loginThrottle = new LoginThrottle(loginThrottleOptions);

  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = credentials.parse(request.body);
    const email = input.email.toLowerCase();
    const device = knownDevice(config.SESSION_SECRET, request.cookies[deviceCookie], email);
    const throttleKey = device ? `device:${device}` : `account:${email}`;
    const decision = loginThrottle.reserve(throttleKey);
    if (!decision.allowed) {
      reply.header('retry-after', decision.retryAfterSeconds);
      return reply.code(429).send({ error: 'TOO_MANY_LOGIN_ATTEMPTS' });
    }
    const result = await pool.query<UserRow & { passwordHash: string }>(
      `SELECT id,email,role,first_name AS "firstName",last_name AS "lastName",gender,
         is_active AS "isActive",must_change_password AS "mustChangePassword",${avatarVersionColumn},
         password_hash AS "passwordHash"
       FROM users WHERE email=$1`,
      [email],
    );
    const user = result.rows[0];
    const passwordValid = await argon2.verify(user?.passwordHash ?? unknownUserPasswordHash, input.password);
    if (!user || !passwordValid) {
      return reply.code(401).send({ error: 'EMAIL_OR_PASSWORD_INVALID' });
    }
    loginThrottle.succeed(throttleKey);
    if (!user.isActive) return reply.code(403).send({ error: 'ACCOUNT_DISABLED' });

    // Keep the successful authentication attributable in the operation log.
    // Passwords and e-mail addresses are never included in that log.
    request.userId = user.id;
    request.userRole = user.role;
    request.mustChangePassword = user.mustChangePassword;
    const token = randomBytes(32).toString('base64url');
    // Expired sessions of the same user are pruned on login so the table
    // cannot grow without bound.
    await pool.query(
      // Any session this browser was still carrying (possibly another user's)
      // is closed, so the new login is the only identity it can present.
      `WITH expired AS (DELETE FROM sessions WHERE user_id=$1 AND expires_at<=now()),
         replaced AS (DELETE FROM sessions WHERE token_hash=ANY($4::text[]))
       INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+($3 || ' days')::interval)`,
      [user.id, sessionDigest(token), config.SESSION_DAYS, presentedSessionTokens(request).map(sessionDigest)],
    );
    reply.setCookie('worth_session', token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
      maxAge: config.SESSION_DAYS * 86400,
    });
    const nonce = device ?? randomBytes(16).toString('base64url');
    reply.setCookie(deviceCookie, `${nonce}.${deviceProof(config.SESSION_SECRET, nonce, email)}`, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: deviceCookieDays * 86400,
    });
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const digests = presentedSessionTokens(request).map(sessionDigest);
    if (digests.length) {
      // Logout intentionally remains idempotent for an expired cookie, but a
      // valid session is still attributed to its actor in the operation log.
      const session = (await pool.query<{ userId: string; role: UserRole; mustChangePassword: boolean }>(
        `SELECT u.id AS "userId",u.role,u.must_change_password AS "mustChangePassword"
         FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND u.is_active=true`,
        [digests],
      )).rows[0];
      if (session) {
        request.userId = session.userId;
        request.userRole = session.role;
        request.mustChangePassword = session.mustChangePassword;
      }
      // Every session the browser carried ends here, not only the first one.
      await pool.query('DELETE FROM sessions WHERE token_hash=ANY($1::text[])', [digests]);
    }
    reply.clearCookie('worth_session', { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'strict', path: '/' });
    return reply.code(204).send();
  });

  // The response never depends on the address: the lookup and the e-mail run
  // after it has been sent, so neither the status nor the timing reveals
  // which accounts exist.
  app.post('/api/auth/password-reset/request', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const input = resetRequestInput.parse(request.body);
    sendResetLink(input.email.toLowerCase(), mailer, config.APP_ORIGIN, request.log).catch((error: unknown) => {
      request.log.error({ errorClass: error instanceof Error ? error.constructor.name : 'UnknownError' }, 'Password reset link not sent');
    });
    return reply.code(204).send();
  });

  // Completes both a reset and an invitation. Every session is closed, and
  // the user signs in again with the new password.
  app.post('/api/auth/password-reset', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const input = resetConfirmInput.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const link = (await client.query<{ userId: string; role: UserRole; email: string; firstName: string | null; purpose: 'invite' | 'reset' }>(
        `SELECT t.user_id AS "userId",u.role,u.email,u.first_name AS "firstName",t.purpose
         FROM password_tokens t JOIN users u ON u.id=t.user_id
         WHERE t.token_hash=$1 AND t.expires_at>now() AND u.is_active=true
         FOR UPDATE OF t`,
        [passwordTokenDigest(input.token)],
      )).rows[0];
      if (!link) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'PASSWORD_TOKEN_INVALID' });
      }
      // Hashed only for a valid link, so an invalid token costs no Argon2 work.
      const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
      await client.query(
        'UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',
        [passwordHash, link.userId],
      );
      await client.query('DELETE FROM password_tokens WHERE user_id=$1', [link.userId]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [link.userId]);
      await client.query('COMMIT');
      request.userId = link.userId;
      request.userRole = link.role;
      // Choosing the first password of an invitation is not worth a notice.
      if (link.purpose === 'reset') sendInBackground(mailer, request.log, passwordChangedEmail(link, 'user'));
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ({
    user: (await pool.query<UserRow>(`${userSelection} WHERE id=$1`, [request.userId])).rows[0],
  }));
}

// Loads the session into the request and reports whether it is valid. Guards
// decide on this result, never on reply.sent: that flag only turns true once
// the response is fully written, which the asynchronous onSend hooks (such as
// operation logging) delay past the end of the guard.
async function loadSession(request: FastifyRequest): Promise<boolean> {
  const digests = presentedSessionTokens(request).map(sessionDigest);
  if (!digests.length) return false;
  const sessions = (await pool.query<{ userId: string; role: UserRole; mustChangePassword: boolean }>(
    `SELECT u.id AS "userId",u.role,u.must_change_password AS "mustChangePassword"
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=ANY($1::text[]) AND s.expires_at>now() AND u.is_active=true`,
    [digests],
  )).rows;
  // Live sessions of two different accounts in one browser: never guess which
  // identity is meant. The user signs in again, and the login closes both.
  if (new Set(sessions.map((row) => row.userId)).size !== 1) return false;
  const session = sessions[0]!;
  request.userId = session.userId;
  request.userRole = session.role;
  request.mustChangePassword = session.mustChangePassword;
  return true;
}

// Every rejection returns the reply: Fastify then waits until the response is
// written and skips the route handler. Without the return, the handler could
// still run (and, for example, change a password) while the 401 is being sent.
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!(await loadSession(request))) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
  return undefined;
}

// Writes per account and minute, whatever the client IP: far above what the
// app sends during normal use, but it caps how fast one account can grow the
// shared database.
export const userWriteLimitOptions = { max: 60, windowMs: 60_000 };
const userWriteLimiter = new UserWriteLimiter(userWriteLimitOptions);

function limitWrites(request: FastifyRequest, reply: FastifyReply): FastifyReply | undefined {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const decision = userWriteLimiter.reserve(request.userId);
  if (decision.allowed) return undefined;
  reply.header('retry-after', decision.retryAfterSeconds);
  return reply.code(429).send({ error: 'RATE_LIMITED' });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!(await loadSession(request))) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
  if (request.mustChangePassword) return reply.code(403).send({ error: 'PASSWORD_CHANGE_REQUIRED' });
  return limitWrites(request, reply);
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!(await loadSession(request))) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
  if (request.mustChangePassword) return reply.code(403).send({ error: 'PASSWORD_CHANGE_REQUIRED' });
  if (request.userRole !== 'admin') return reply.code(403).send({ error: 'ADMIN_REQUIRED' });
  return limitWrites(request, reply);
}
