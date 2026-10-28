import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../auth.js';
import { recordOperation } from '../services/ledger.js';
import { sendDomainError } from '../http/errors.js';
import { centsSchema } from '../http/validation.js';

const id = z.string().uuid();
const bucketInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullish(),
  type: z.enum(['spending', 'saving', 'investment', 'other']),
  icon: z.string().trim().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  monthlyTargetCents: centsSchema.nullish(),
});
const adjustment = z.object({
  mode: z.enum(['add', 'subtract', 'set']), amountCents: centsSchema, note: z.string().max(300).optional(), idempotencyKey: z.string().uuid(),
});
const totalVisibility = z.object({ includeInTotal: z.boolean() });

export function registerBucketRoutes(app: FastifyInstance): void {
  app.get('/api/buckets', { preHandler: requireAuth }, async (request) => {
    const result = await pool.query(
      `SELECT id, name, description, type, balance_cents::text AS "balanceCents", currency, icon, color, include_in_total AS "includeInTotal",
              monthly_target_cents::text AS "monthlyTargetCents", sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM buckets WHERE user_id = $1 AND archived_at IS NULL ORDER BY sort_order, created_at`, [request.userId],
    );
    return { buckets: result.rows };
  });

  app.post('/api/buckets', { preHandler: requireAuth }, async (request, reply) => {
    const input = bucketInput.parse(request.body);
    const order = await pool.query<{ next: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM buckets WHERE user_id = $1', [request.userId]);
    const result = await pool.query(
      `INSERT INTO buckets (user_id, name, description, type, icon, color, monthly_target_cents, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [request.userId, input.name, input.description ?? null, input.type, input.icon, input.color, input.monthlyTargetCents ?? null, order.rows[0]!.next],
    );
    return reply.code(201).send({ id: result.rows[0]!.id });
  });

  app.patch('/api/buckets/:id', { preHandler: requireAuth }, async (request, reply) => {
    const bucketId = id.parse((request.params as { id: string }).id);
    const input = bucketInput.parse(request.body);
    const result = await pool.query(
      `UPDATE buckets SET name=$1, description=$2, type=$3, icon=$4, color=$5, monthly_target_cents=$6, updated_at=now()
       WHERE id=$7 AND user_id=$8 AND archived_at IS NULL RETURNING id`,
      [input.name, input.description ?? null, input.type, input.icon, input.color, input.monthlyTargetCents ?? null, bucketId, request.userId],
    );
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'BUCKET_NOT_FOUND' });
  });

  app.patch('/api/buckets/:id/total-visibility', { preHandler: requireAuth }, async (request, reply) => {
    const bucketId = id.parse((request.params as { id: string }).id);
    const input = totalVisibility.parse(request.body);
    const result = await pool.query(
      `UPDATE buckets SET include_in_total=$1, updated_at=now()
       WHERE id=$2 AND user_id=$3 AND archived_at IS NULL RETURNING id`,
      [input.includeInTotal, bucketId, request.userId],
    );
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'BUCKET_NOT_FOUND' });
  });

  app.delete('/api/buckets/:id', { preHandler: requireAuth }, async (request, reply) => {
    const bucketId = id.parse((request.params as { id: string }).id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bucket = await client.query<{ balanceCents: string; hasActivePlannedExpenses: boolean }>(
        `SELECT b.balance_cents::text AS "balanceCents",
                EXISTS(
                  SELECT 1 FROM planned_expenses p
                  WHERE p.user_id=b.user_id AND p.bucket_id=b.id AND p.archived_at IS NULL
                    AND (
                      EXISTS(
                        SELECT 1 FROM planned_expense_occurrences o
                        WHERE o.planned_expense_id=p.id AND o.user_id=p.user_id AND o.status='open'
                      )
                      OR (p.frequency='monthly' AND (
                        p.duration_months IS NULL
                        OR (p.start_month + (p.duration_months || ' months')::interval)::date
                           > date_trunc('month',now() AT TIME ZONE 'Europe/Rome')::date
                      ))
                      OR p.frequency IN ('bimonthly','quarterly','semiannual','annual')
                      OR (p.frequency='once' AND NOT EXISTS(
                        SELECT 1 FROM planned_expense_occurrences o
                        WHERE o.planned_expense_id=p.id AND o.user_id=p.user_id AND o.status='completed'
                      ))
                    )
                ) AS "hasActivePlannedExpenses"
         FROM buckets b
         WHERE b.id=$1 AND b.user_id=$2 AND b.archived_at IS NULL
         FOR UPDATE`,
        [bucketId, request.userId],
      );
      const current = bucket.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'BUCKET_NOT_FOUND' });
      }
      if (BigInt(current.balanceCents) !== 0n) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'BUCKET_MUST_BE_EMPTY' });
      }
      if (current.hasActivePlannedExpenses) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'BUCKET_HAS_ACTIVE_PLANNED_EXPENSES' });
      }
      await client.query('UPDATE buckets SET archived_at=now(),updated_at=now() WHERE id=$1', [bucketId]);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.put('/api/buckets/order', { preHandler: requireAuth }, async (request, reply) => {
    const ids = z.object({ ids: z.array(id).min(1).max(500) }).parse(request.body).ids;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query<{ id: string }>('SELECT id FROM buckets WHERE user_id=$1 AND archived_at IS NULL FOR UPDATE', [request.userId]);
      const ownedIds = owned.rows.map((row) => row.id);
      if (ownedIds.length !== ids.length || !ownedIds.every((value) => ids.includes(value))) throw new Error('INVALID_BUCKET_ORDER');
      for (const [index, bucketId] of ids.entries()) await client.query('UPDATE buckets SET sort_order=$1 WHERE id=$2', [index, bucketId]);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      return sendDomainError(reply, error);
    } finally { client.release(); }
  });

  app.post('/api/buckets/:id/adjust', { preHandler: requireAuth }, async (request, reply) => {
    const bucketId = id.parse((request.params as { id: string }).id);
    const input = adjustment.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ balance_cents: string }>('SELECT balance_cents::text FROM buckets WHERE id=$1 AND user_id=$2 AND archived_at IS NULL FOR UPDATE', [bucketId, request.userId]);
      if (!current.rows[0]) throw new Error('BUCKET_NOT_FOUND');
      const amount = BigInt(input.amountCents);
      const delta = input.mode === 'set' ? amount - BigInt(current.rows[0].balance_cents) : input.mode === 'add' ? amount : -amount;
      if (delta === 0n) throw new Error('AMOUNT_MUST_BE_POSITIVE');
      const operationId = await recordOperation(client, request.userId, 'adjustment', [{ bucketId, amountCents: delta.toString() }], input.note, input.idempotencyKey);
      await client.query('COMMIT');
      return reply.code(201).send({ operationId });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') return reply.code(200).send({ duplicate: true });
      return sendDomainError(reply, error);
    } finally { client.release(); }
  });
}
