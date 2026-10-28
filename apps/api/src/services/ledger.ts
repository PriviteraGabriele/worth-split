import type { PoolClient } from 'pg';
import { applyDelta, requirePositive, total } from '../domain/money.js';

type LockedBucket = { id: string; balance_cents: string };
export type EntryInput = { bucketId: string; amountCents: string };
export type RebalanceBucket = { id: string; balanceCents: string };

async function lockBuckets(client: PoolClient, userId: string, ids: string[]): Promise<Map<string, bigint>> {
  const unique = [...new Set(ids)].sort();
  const result = await client.query<LockedBucket>(
    `SELECT id, balance_cents::text FROM buckets
     WHERE user_id = $1 AND archived_at IS NULL AND id = ANY($2::uuid[])
     ORDER BY id FOR UPDATE`,
    [userId, unique],
  );
  if (result.rowCount !== unique.length) throw new Error('BUCKET_NOT_FOUND');
  return new Map(result.rows.map((row) => [row.id, BigInt(row.balance_cents)]));
}

export async function recordOperation(
  client: PoolClient,
  userId: string,
  kind: 'adjustment' | 'transfer' | 'distribution' | 'rebalance',
  entries: EntryInput[],
  note?: string,
  idempotencyKey?: string,
): Promise<string> {
  const balances = await lockBuckets(client, userId, entries.map((entry) => entry.bucketId));
  const next = new Map(balances);
  for (const entry of entries) {
    const amount = BigInt(entry.amountCents);
    next.set(entry.bucketId, applyDelta(next.get(entry.bucketId) ?? 0n, amount));
  }
  const operation = await client.query<{ id: string }>(
    `INSERT INTO operations (user_id, kind, note, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, kind, note?.trim() || null, idempotencyKey ?? null],
  );
  const operationId = operation.rows[0]!.id;
  for (const entry of entries) {
    const balance = next.get(entry.bucketId)!;
    await client.query('UPDATE buckets SET balance_cents = $1, updated_at = now() WHERE id = $2', [balance.toString(), entry.bucketId]);
    await client.query(
      `INSERT INTO operation_entries (operation_id, bucket_id, amount_cents, balance_after_cents)
       VALUES ($1, $2, $3, $4)`,
      [operationId, entry.bucketId, entry.amountCents, balance.toString()],
    );
  }
  return operationId;
}

export function transferEntries(fromBucketId: string, toBucketId: string, amountCents: string): EntryInput[] {
  if (fromBucketId === toBucketId) throw new Error('SAME_BUCKET');
  const amount = requirePositive(amountCents);
  return [
    { bucketId: fromBucketId, amountCents: (-amount).toString() },
    { bucketId: toBucketId, amountCents: amount.toString() },
  ];
}

export function validateDistribution(entries: EntryInput[], expectedTotalCents: string): EntryInput[] {
  if (entries.length === 0 || new Set(entries.map((entry) => entry.bucketId)).size !== entries.length) throw new Error('INVALID_DISTRIBUTION');
  const normalized = entries.map((entry) => ({ ...entry, amountCents: requirePositive(entry.amountCents).toString() }));
  if (total(normalized.map((entry) => BigInt(entry.amountCents))) !== requirePositive(expectedTotalCents)) throw new Error('INVALID_DISTRIBUTION');
  return normalized;
}

export function rebalanceEntries(buckets: RebalanceBucket[], targetTotalCents: string): EntryInput[] {
  if (buckets.length < 1 || new Set(buckets.map((bucket) => bucket.id)).size !== buckets.length) throw new Error('INVALID_REBALANCE');
  const target = BigInt(targetTotalCents);
  const current = total(buckets.map((bucket) => BigInt(bucket.balanceCents)));
  if (target < 0n || target === current) throw new Error('INVALID_REBALANCE_TOTAL');
  if (target > current) return [{ bucketId: buckets[0]!.id, amountCents: (target - current).toString() }];
  let remaining = current - target;
  const entries: EntryInput[] = [];
  for (const bucket of buckets) {
    const reduction = remaining < BigInt(bucket.balanceCents) ? remaining : BigInt(bucket.balanceCents);
    if (reduction > 0n) entries.push({ bucketId: bucket.id, amountCents: (-reduction).toString() });
    remaining -= reduction;
    if (remaining === 0n) break;
  }
  if (remaining !== 0n) throw new Error('INVALID_REBALANCE_TOTAL');
  return entries;
}
