import { pool } from './pool.js';

if (process.env.NODE_ENV !== 'development') throw new Error('Il seed demo è consentito solo con NODE_ENV=development.');

type Bucket = { id: string; name: string; type: 'spending' | 'saving' | 'investment' | 'other' };
type Change = { bucketId: string; amountCents: bigint };

const firstOffset = -35;
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const users = await client.query<{ id: string }>('SELECT id FROM users ORDER BY created_at');
  if (users.rowCount !== 1) throw new Error('Il seed demo richiede esattamente un account.');
  const userId = users.rows[0]!.id;
  const result = await client.query<Bucket>('SELECT id,name,type FROM buckets WHERE user_id=$1 AND archived_at IS NULL ORDER BY sort_order', [userId]);
  if (!result.rowCount) throw new Error('Crea almeno un bucket prima di usare il seed demo.');
  const buckets = result.rows;
  const balances = new Map(buckets.map((bucket) => [bucket.id, 0n]));

  function startOffset(bucket: Bucket, index: number) { return bucket.type === 'investment' ? -30 : bucket.type === 'other' ? -20 : Math.min(firstOffset + index, -31); }
  function monthDate(offset: number, day: number, hour: number) { const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() + offset); date.setDate(day); date.setHours(hour, 0, 0, 0); return date; }
  function initialAmount(bucket: Bucket) { return bucket.type === 'investment' ? 1_500_00n : bucket.type === 'saving' ? 2_000_00n : bucket.type === 'spending' ? 750_00n : 300_00n; }
  function monthlyIncome(bucket: Bucket) { return bucket.type === 'investment' ? 250_00n : bucket.type === 'saving' ? 450_00n : bucket.type === 'spending' ? 1_250_00n : 120_00n; }

  // Preserve planned-expense definitions but reset their monthly state before
  // rebuilding the operation ledger used by the demo.
  await client.query('DELETE FROM planned_expense_payments WHERE user_id=$1', [userId]);
  await client.query('DELETE FROM planned_expense_occurrences WHERE user_id=$1', [userId]);
  await client.query('DELETE FROM operations WHERE user_id=$1', [userId]);
  await client.query('UPDATE buckets SET balance_cents=0,updated_at=now() WHERE user_id=$1 AND archived_at IS NULL', [userId]);
  for (const [index, bucket] of buckets.entries()) await client.query('UPDATE buckets SET created_at=$1,updated_at=now() WHERE id=$2', [monthDate(startOffset(bucket, index), 1, 8), bucket.id]);

  async function record(kind: 'adjustment' | 'transfer' | 'distribution', occurredAt: Date, note: string, changes: Change[]) {
    if (!changes.length) return;
    const operation = await client.query<{ id: string }>('INSERT INTO operations(user_id,kind,note,occurred_at) VALUES($1,$2,$3,$4) RETURNING id', [userId, kind, note, occurredAt]);
    for (const change of changes) {
      const next = (balances.get(change.bucketId) ?? 0n) + change.amountCents;
      if (next < 0n) throw new Error('Il seed demo ha generato un saldo negativo.');
      balances.set(change.bucketId, next);
      await client.query('INSERT INTO operation_entries(operation_id,bucket_id,amount_cents,balance_after_cents) VALUES($1,$2,$3,$4)', [operation.rows[0]!.id, change.bucketId, change.amountCents.toString(), next.toString()]);
    }
  }

  for (let offset = firstOffset; offset <= 0; offset++) {
    const active = buckets.filter((bucket, index) => startOffset(bucket, index) <= offset);
    const newBuckets = active.filter((bucket) => startOffset(bucket, buckets.indexOf(bucket)) === offset);
    await record('distribution', monthDate(offset, 3, 9), 'Versamento iniziale', newBuckets.map((bucket) => ({ bucketId: bucket.id, amountCents: initialAmount(bucket) })));
    await record('distribution', monthDate(offset, 5, 9), 'Stipendio', active.map((bucket) => ({ bucketId: bucket.id, amountCents: monthlyIncome(bucket) })));
    const spending = active.find((bucket) => bucket.type === 'spending');
    const saving = active.find((bucket) => bucket.type === 'saving');
    const investment = active.find((bucket) => bucket.type === 'investment');
    if (spending) {
      const monthlyExpense = 980_00n + BigInt((offset - firstOffset) % 4) * 80_00n;
      await record('adjustment', monthDate(offset, 12, 18), 'Spese del mese', [{ bucketId: spending.id, amountCents: -monthlyExpense }]);
      if (saving) await record('transfer', monthDate(offset, 18, 18), 'Accantonamento', [{ bucketId: spending.id, amountCents: -100_00n }, { bucketId: saving.id, amountCents: 100_00n }]);
    }
    if (saving && investment) await record('transfer', monthDate(offset, 22, 18), 'Investimento mensile', [{ bucketId: saving.id, amountCents: -100_00n }, { bucketId: investment.id, amountCents: 100_00n }]);
    if ((offset - firstOffset) % 6 === 4 && saving) await record('adjustment', monthDate(offset, 27, 12), 'Spesa straordinaria', [{ bucketId: saving.id, amountCents: -350_00n }]);
  }
  for (const [bucketId, balance] of balances) await client.query('UPDATE buckets SET balance_cents=$1,updated_at=now() WHERE id=$2', [balance.toString(), bucketId]);
  await client.query('COMMIT');
  console.info(`Seed demo completato: ${buckets.length} bucket e 36 mesi di operazioni.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
