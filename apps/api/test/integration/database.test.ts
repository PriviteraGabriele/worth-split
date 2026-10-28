import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs only against a disposable database, never a real one:
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db npx vitest run test/integration
// The migrations are applied to it, and every test works on its own accounts.
const databaseUrl = process.env.TEST_DATABASE_URL;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const timestamp = '2026-08-22T08:00:00.000Z';

describe.skipIf(!databaseUrl)('against a real PostgreSQL', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;

  // An account with a session cookie, created straight in the database.
  async function account(role: 'user' | 'admin' = 'user', password = 'unused-password') {
    const id = (await pool.query<{ id: string }>(
      'INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id',
      [`it-${randomUUID()}@example.it`, await argon2.hash(password, { type: argon2.argon2id }), role],
    )).rows[0]!.id;
    await pool.query('INSERT INTO user_settings(user_id) VALUES($1)', [id]);
    const token = randomUUID();
    await pool.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')`, [id, sha256(token)]);
    return { id, cookies: { worth_session: token } };
  }

  async function pendingLink(userId: string) {
    const { issuePasswordToken } = await import('../../src/services/passwordLinks.js');
    return issuePasswordToken(pool, userId, 'invite');
  }
  const redeem = (token: string) => app.inject({ method: 'POST', url: '/api/auth/password-reset', payload: { token, newPassword: 'chosen-through-link' } });

  const backup = (operations = 1) => {
    const bucket = (legacyId: string, name: string) => ({
      legacyId, name, description: null, type: 'spending', balanceCents: '5000', currency: 'EUR', icon: 'wallet',
      color: '#8B5CF6', monthlyTargetCents: null, sortOrder: 0, includeInTotal: true, archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
    });
    const [first, second, operation, expense, occurrence] = Array.from({ length: 5 }, () => randomUUID());
    return {
      format: 'worth-split-backup', exportedAt: timestamp,
      buckets: [bucket(first!, 'Spese'), { ...bucket(second!, 'Risparmi'), type: 'saving', archivedAt: timestamp }],
      operations: Array.from({ length: operations }, (_, index) => ({
        legacyId: index === 0 ? operation : randomUUID(), kind: 'distribution', note: index === 0 ? 'Stipendio' : null,
        idempotencyKey: null, occurredAt: timestamp, createdAt: timestamp,
        entries: [
          { bucketLegacyId: first, amountCents: '3000', balanceAfterCents: '3000' },
          { bucketLegacyId: second, amountCents: '2000', balanceAfterCents: '2000' },
        ],
      })),
      templates: [{ legacyId: randomUUID(), name: 'Mensile', mode: 'percentage', createdAt: timestamp, updatedAt: timestamp,
        items: [{ bucketLegacyId: first, percentageBasisPoints: 6000, sortOrder: 0 }, { bucketLegacyId: second, percentageBasisPoints: 4000, sortOrder: 1 }] }],
      plannedExpenses: [{ legacyId: expense, bucketLegacyId: first, name: 'Carburante', description: null, category: 'other', amountCents: '10000',
        amountMode: 'estimated', frequency: 'monthly', dueRule: 'end', dueDay: null, dueDate: null, startMonth: '2026-08-01',
        durationMonths: null, archivedAt: null, createdAt: timestamp, updatedAt: timestamp }],
      plannedExpenseOccurrences: [{ legacyId: occurrence, plannedExpenseLegacyId: expense, period: '2026-08-01', amountCents: '10000',
        dueDate: '2026-08-31', status: 'completed', completedAt: timestamp, createdAt: timestamp, updatedAt: timestamp }],
      plannedExpensePayments: [{ legacyId: randomUUID(), occurrenceLegacyId: occurrence, operationLegacyId: operation, amountCents: '3000',
        note: 'Pieno', idempotencyKey: randomUUID(), createdAt: timestamp }],
      plannedExpenseEstimatedTotalVisibility: [{ legacyId: randomUUID(), plannedExpenseLegacyId: expense, effectiveMonth: '2026-08-01',
        includedInEstimatedTotal: false, createdAt: timestamp, updatedAt: timestamp }],
      settings: { currency: 'EUR', locale: 'it-IT', theme: 'dark', hideAmounts: true, quickAmountsCents: ['5000', '7500'], updatedAt: timestamp },
    };
  };

  // Ids differ after an import; everything else, and every reference, must survive.
  function normalize(data: ReturnType<typeof backup>) {
    const ids = new Map<string, string>();
    const name = (id: string) => { if (!ids.has(id)) ids.set(id, `#${ids.size}`); return ids.get(id)!; };
    // Entries are exported in id order, which is random; nulls stand for absent optional fields.
    const walk = (value: unknown, key = ''): unknown => {
      if (Array.isArray(value)) {
        const items = value.map((item) => walk(item));
        return key === 'entries' ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
      }
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, walk(v, k)]));
      if (typeof value === 'string' && /legacyid$/i.test(key)) return name(value);
      if (typeof value === 'string' && /At$/.test(key) && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
      return value;
    };
    const copy = structuredClone(data) as Record<string, unknown> & { settings: Record<string, unknown> };
    delete copy.exportedAt;
    delete copy.settings.updatedAt;
    return walk(copy);
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl, SESSION_SECRET: 'i'.repeat(32), APP_ORIGIN: 'http://localhost:5173', NODE_ENV: 'test', OPERATION_LOG_ENABLED: 'false',
    });
    ({ pool } = await import('../../src/db/pool.js'));
    await (await import('../../src/db/migrate.js')).migrate();
    const { buildApp } = await import('../../src/app.js');
    const { loadConfig } = await import('../../src/config.js');
    app = await buildApp(loadConfig(), { logger: false });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('gives every connection a statement and idle-transaction deadline', async () => {
    const client = await pool.connect();
    try {
      expect((await client.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('30s');
      expect((await client.query('SHOW idle_in_transaction_session_timeout')).rows[0].idle_in_transaction_session_timeout).toBe('30s');
    } finally { client.release(); }
  });

  it('restores a backup that exports back to the same content, without touching other accounts', async () => {
    const owner = await account();
    const other = await account();
    expect((await app.inject({ method: 'POST', url: '/api/backup/import', cookies: other.cookies, payload: backup() })).statusCode).toBe(204);

    const original = backup();
    expect((await app.inject({ method: 'POST', url: '/api/backup/import', cookies: owner.cookies, payload: original })).statusCode).toBe(204);
    const exported = await app.inject({ method: 'GET', url: '/api/backup/export', cookies: owner.cookies });
    expect(exported.statusCode).toBe(200);
    expect(normalize(exported.json())).toEqual(normalize(original));

    // A second round trip through the API keeps the content as well.
    expect((await app.inject({ method: 'POST', url: '/api/backup/import', cookies: owner.cookies, payload: exported.json() })).statusCode).toBe(204);
    const again = await app.inject({ method: 'GET', url: '/api/backup/export', cookies: owner.cookies });
    expect(normalize(again.json())).toEqual(normalize(original));

    const otherCounts = await pool.query('SELECT (SELECT count(*) FROM buckets WHERE user_id=$1)::int AS buckets,(SELECT count(*) FROM operations WHERE user_id=$1)::int AS operations', [other.id]);
    expect(otherCounts.rows[0]).toEqual({ buckets: 2, operations: 1 });
  });

  it('imports a backup close to the 2 MiB limit in a few seconds', async () => {
    const owner = await account();
    const large = backup(5000);
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(1_500_000);
    const started = Date.now();
    const response = await app.inject({ method: 'POST', url: '/api/backup/import', cookies: owner.cookies, payload: large });
    const elapsed = Date.now() - started;
    expect(response.statusCode).toBe(204);
    expect(elapsed).toBeLessThan(5_000);
    expect((await pool.query('SELECT count(*)::int AS count FROM operation_entries e JOIN operations o ON o.id=e.operation_id WHERE o.user_id=$1', [owner.id])).rows[0].count).toBe(10_000);
  });

  it('revokes an older password link on every credential change', async () => {
    const admin = await account('admin');
    const target = await account('user', 'current-password-1');

    let link = await pendingLink(target.id);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/users/${target.id}`, cookies: admin.cookies, payload: { email: `moved-${randomUUID()}@example.it`, firstName: null, lastName: null } })).statusCode).toBe(200);
    expect((await redeem(link)).statusCode).toBe(400);

    link = await pendingLink(target.id);
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${target.id}/reset-password`, cookies: admin.cookies, payload: { temporaryPassword: 'temporary-pass-1' } })).statusCode).toBe(204);
    expect((await redeem(link)).statusCode).toBe(400);

    link = await pendingLink(target.id);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/users/${target.id}/status`, cookies: admin.cookies, payload: { isActive: false } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/users/${target.id}/status`, cookies: admin.cookies, payload: { isActive: true } })).statusCode).toBe(200);
    expect((await redeem(link)).statusCode).toBe(400);

    await pool.query('UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2', [await argon2.hash('current-password-1', { type: argon2.argon2id }), target.id]);
    const session = randomUUID();
    await pool.query(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')`, [target.id, sha256(session)]);
    link = await pendingLink(target.id);
    expect((await app.inject({ method: 'POST', url: '/api/profile/password', cookies: { worth_session: session }, payload: { currentPassword: 'current-password-1', newPassword: 'personal-password-2' } })).statusCode).toBe(204);
    expect((await redeem(link)).statusCode).toBe(400);

    // A link nobody revoked still works: the checks above are not vacuous.
    link = await pendingLink(target.id);
    expect((await redeem(link)).statusCode).toBe(204);
  });
});
