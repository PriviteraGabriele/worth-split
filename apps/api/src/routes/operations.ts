import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { pool } from '../db/pool.js';
import { rebalanceEntries, recordOperation, transferEntries, validateDistribution } from '../services/ledger.js';
import { sendDomainError } from '../http/errors.js';
import { centsSchema } from '../http/validation.js';

const common = { note: z.string().max(300).optional(), idempotencyKey: z.string().uuid() };
const transferSchema = z.object({ fromBucketId: z.string().uuid(), toBucketId: z.string().uuid(), amountCents: centsSchema, ...common });
const distributionSchema = z.object({ totalCents: centsSchema, entries: z.array(z.object({ bucketId: z.string().uuid(), amountCents: centsSchema })).max(200), ...common });
const rebalanceSchema = z.object({
  bucketIds: z.array(z.string().uuid()).min(1).max(200), targetTotalCents: centsSchema, ...common,
}).refine((input) => new Set(input.bucketIds).size === input.bucketIds.length, 'Invalid rebalance buckets');

async function transact(request: any, reply: any, kind: 'transfer' | 'distribution', entries: any[], note: string | undefined, key: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const operationId = await recordOperation(client, request.userId, kind, entries, note, key);
    await client.query('COMMIT');
    return reply.code(201).send({ operationId });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return reply.code(200).send({ duplicate: true });
    return sendDomainError(reply, error);
  } finally { client.release(); }
}

export function registerOperationRoutes(app: FastifyInstance): void {
  app.post('/api/transfers', { preHandler: requireAuth }, async (request, reply) => {
    const input = transferSchema.parse(request.body);
    return transact(request, reply, 'transfer', transferEntries(input.fromBucketId, input.toBucketId, input.amountCents), input.note, input.idempotencyKey);
  });
  app.post('/api/distributions', { preHandler: requireAuth }, async (request, reply) => {
    const input = distributionSchema.parse(request.body);
    return transact(request, reply, 'distribution', validateDistribution(input.entries, input.totalCents), input.note, input.idempotencyKey);
  });
  app.post('/api/rebalances', { preHandler: requireAuth }, async (request, reply) => {
    const input = rebalanceSchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; balanceCents: string }>(
        `SELECT id,balance_cents::text AS "balanceCents" FROM buckets
         WHERE user_id=$1 AND archived_at IS NULL AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
        [request.userId, input.bucketIds],
      );
      if (result.rowCount !== input.bucketIds.length) throw new Error('BUCKET_NOT_FOUND');
      const byId = new Map(result.rows.map((bucket) => [bucket.id, bucket]));
      const buckets = input.bucketIds.map((bucketId) => byId.get(bucketId)!);
      const entries = rebalanceEntries(buckets, input.targetTotalCents);
      const operationId = await recordOperation(client, request.userId, 'rebalance', entries, input.note ?? 'Ribilanciamento smart', input.idempotencyKey);
      await client.query('COMMIT');
      return reply.code(201).send({ operationId });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') return reply.code(200).send({ duplicate: true });
      return sendDomainError(reply, error);
    } finally { client.release(); }
  });
  app.get('/api/operations', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ bucketId: z.string().uuid().optional(), year: z.coerce.number().int().min(2000).max(9999).optional(), month: z.coerce.number().int().min(1).max(12).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const [result, years] = await Promise.all([
      pool.query(
      `SELECT o.id, o.kind, o.note, o.occurred_at AS "occurredAt",
        json_agg(json_build_object('bucketId', b.id, 'bucketName', b.name, 'bucketIcon', b.icon, 'bucketType', b.type,
          'amountCents', e.amount_cents::text, 'balanceAfterCents', e.balance_after_cents::text) ORDER BY e.id) AS entries
       FROM operations o JOIN operation_entries e ON e.operation_id=o.id JOIN buckets b ON b.id=e.bucket_id
       WHERE o.user_id=$1 AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM operation_entries x WHERE x.operation_id=o.id AND x.bucket_id=$2))
         AND ($3::integer IS NULL OR EXTRACT(YEAR FROM o.occurred_at AT TIME ZONE 'Europe/Rome') = $3)
         AND ($4::integer IS NULL OR EXTRACT(MONTH FROM o.occurred_at AT TIME ZONE 'Europe/Rome') = $4)
       GROUP BY o.id ORDER BY o.occurred_at DESC, o.id DESC LIMIT $5 OFFSET $6`, [request.userId, query.bucketId ?? null, query.year ?? null, query.month ?? null, query.limit + 1, query.offset],
      ),
      pool.query<{ year: number }>(
        `SELECT DISTINCT EXTRACT(YEAR FROM occurred_at AT TIME ZONE 'Europe/Rome')::integer AS year
         FROM operations WHERE user_id=$1 ORDER BY year DESC`, [request.userId],
      ),
    ]);
    return { operations: result.rows.slice(0, query.limit), hasMore: result.rows.length > query.limit, availableYears: years.rows.map((row) => row.year) };
  });
  app.get('/api/trends', { preHandler: requireAuth }, async (request) => {
    const result = await pool.query<{ month: string; buckets: any[] }>(
      `WITH first_month AS (
         SELECT date_trunc('month', MIN(occurred_at)) AS value FROM operations WHERE user_id=$1
       ), months AS (
         SELECT generate_series(
           GREATEST((SELECT value FROM first_month), date_trunc('month', now()) - interval '35 months'),
           date_trunc('month', now()), interval '1 month'
         ) AS month_start
       )
       SELECT to_char(months.month_start, 'YYYY-MM') AS month,
              COALESCE(json_agg(json_build_object(
                'id', b.id, 'name', b.name, 'type', b.type, 'color', b.color,
                'includeInTotal', b.include_in_total,
                'balanceCents', (b.balance_cents - COALESCE((
                  SELECT SUM(e.amount_cents)
                  FROM operation_entries e JOIN operations o ON o.id=e.operation_id
                  WHERE e.bucket_id=b.id AND o.user_id=$1
                    AND o.occurred_at >= months.month_start + interval '1 month'
                ), 0))::text
              ) ORDER BY b.sort_order) FILTER (WHERE b.id IS NOT NULL), '[]') AS buckets
       FROM months LEFT JOIN buckets b ON b.user_id=$1 AND b.archived_at IS NULL
         AND b.created_at < months.month_start + interval '1 month'
       GROUP BY months.month_start ORDER BY months.month_start`,
      [request.userId],
    );
    return { months: result.rows.map((row) => ({
      month: row.month,
      buckets: row.buckets,
      totalCents: row.buckets.filter((bucket) => bucket.includeInTotal).reduce((sum, bucket) => sum + BigInt(bucket.balanceCents), 0n).toString(),
    })) };
  });
  app.get('/api/dashboard', { preHandler: requireAuth }, async (request) => {
    const buckets = await pool.query(
      `WITH current_month AS (
         SELECT date_trunc('month',now() AT TIME ZONE 'Europe/Rome')::date AS value
       )
       SELECT b.id,b.name,b.description,b.type,b.balance_cents::text AS "balanceCents",b.currency,b.icon,b.color,
              b.monthly_target_cents::text AS "monthlyTargetCents",b.sort_order AS "sortOrder",
              b.include_in_total AS "includeInTotal",
              COALESCE((SELECT SUM(e.amount_cents) FROM operation_entries e JOIN operations o ON o.id=e.operation_id
                        WHERE e.bucket_id=b.id AND o.occurred_at >= date_trunc('month', now())),0)::text AS "monthlyChangeCents"
              ,COALESCE((
                SELECT SUM(GREATEST(COALESCE(o.amount_cents,p.amount_cents)-COALESCE(payments.amount_cents,0),0))
                FROM planned_expenses p
                LEFT JOIN planned_expense_occurrences o
                  ON o.planned_expense_id=p.id AND o.user_id=p.user_id AND o.period=current_month.value
                LEFT JOIN LATERAL (
                  SELECT COALESCE(SUM(pp.amount_cents),0) AS amount_cents
                  FROM planned_expense_payments pp WHERE pp.occurrence_id=o.id AND pp.user_id=p.user_id
                ) payments ON TRUE
                LEFT JOIN LATERAL (
                  SELECT included_in_estimated_total
                  FROM planned_expense_estimated_total_visibility
                  WHERE planned_expense_id=p.id AND user_id=p.user_id AND effective_month<=current_month.value
                  ORDER BY effective_month DESC LIMIT 1
                ) visibility ON TRUE
                WHERE p.user_id=b.user_id AND p.bucket_id=b.id AND p.archived_at IS NULL
                  AND COALESCE(visibility.included_in_estimated_total,true)
                  -- A closed occurrence has already affected the bucket balance
                  -- through its payments, so it must not reserve its estimate again.
                  AND COALESCE(o.status,'open')='open'
                  AND (
                    (p.frequency='monthly' AND p.start_month<=current_month.value
                      AND (p.duration_months IS NULL OR (p.start_month+(p.duration_months||' months')::interval)::date>current_month.value))
                    OR (p.frequency IN ('bimonthly','quarterly','semiannual','annual') AND p.start_month<=current_month.value
                      AND (
                        (EXTRACT(YEAR FROM current_month.value)::integer*12+EXTRACT(MONTH FROM current_month.value)::integer)
                        -(EXTRACT(YEAR FROM p.start_month)::integer*12+EXTRACT(MONTH FROM p.start_month)::integer)
                      )%CASE p.frequency WHEN 'bimonthly' THEN 2 WHEN 'quarterly' THEN 3 WHEN 'semiannual' THEN 6 ELSE 12 END=0)
                    OR (p.frequency='once' AND p.start_month=current_month.value)
                  )
              ),0)::text AS "plannedExpenseCents"
       FROM buckets b CROSS JOIN current_month WHERE b.user_id=$1 AND b.archived_at IS NULL ORDER BY b.sort_order`,
      [request.userId],
    );
    const totalCents = buckets.rows.reduce((sum: bigint, row: any) => row.includeInTotal ? sum + BigInt(row.balanceCents) : sum, 0n).toString();
    const monthlyChangeCents = buckets.rows.reduce((sum: bigint, row: any) => row.includeInTotal ? sum + BigInt(row.monthlyChangeCents) : sum, 0n).toString();
    return { totalCents, monthlyChangeCents, buckets: buckets.rows };
  });
}
