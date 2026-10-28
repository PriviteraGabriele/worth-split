import type { PoolClient } from 'pg';

export type DataResetMode = 'partial' | 'total';

/**
 * Resets only the authenticated user's financial data. The caller owns the
 * transaction so failures can always be rolled back without partial deletion.
 */
export async function resetUserData(client: PoolClient, userId: string, mode: DataResetMode): Promise<void> {
  // Operations already lock their buckets before changing a balance. Taking
  // the same locks makes a reset wait for in-flight balance changes.
  await client.query('SELECT id FROM buckets WHERE user_id=$1 ORDER BY id FOR UPDATE', [userId]);

  if (mode === 'total') {
    await client.query('DELETE FROM planned_expense_payments WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM planned_expense_occurrences WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM planned_expenses WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM templates WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM operations WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM buckets WHERE user_id=$1', [userId]);
    return;
  }

  // Clear each monthly state while retaining the recurring-spending
  // definitions. Payments are removed explicitly before their occurrences.
  await client.query('DELETE FROM planned_expense_payments WHERE user_id=$1', [userId]);
  await client.query('DELETE FROM planned_expense_occurrences WHERE user_id=$1', [userId]);
  await client.query('DELETE FROM operations WHERE user_id=$1', [userId]);
  await client.query('UPDATE buckets SET balance_cents=0,updated_at=now() WHERE user_id=$1', [userId]);
}
