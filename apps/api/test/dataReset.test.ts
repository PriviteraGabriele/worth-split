import type { PoolClient } from 'pg';
import { describe,expect,it,vi } from 'vitest';
import { resetUserData } from '../src/services/dataReset.js';

function queryRecorder() {
  const query=vi.fn().mockResolvedValue({rows:[],rowCount:0});
  return {client:{query} as unknown as PoolClient,query};
}

describe('resetUserData',()=>{
  it('keeps buckets, templates and planned-expense definitions during a partial reset',async()=>{
    const {client,query}=queryRecorder();

    await resetUserData(client,'user-1','partial');

    expect(query.mock.calls.map(([sql])=>sql)).toEqual([
      'SELECT id FROM buckets WHERE user_id=$1 ORDER BY id FOR UPDATE',
      'DELETE FROM planned_expense_payments WHERE user_id=$1',
      'DELETE FROM planned_expense_occurrences WHERE user_id=$1',
      'DELETE FROM operations WHERE user_id=$1',
      'UPDATE buckets SET balance_cents=0,updated_at=now() WHERE user_id=$1',
    ]);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM templates'),expect.anything());
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM planned_expenses'),expect.anything());
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM buckets'),expect.anything());
  });

  it('deletes planned expenses, templates, operations and buckets in safe order during a total reset',async()=>{
    const {client,query}=queryRecorder();

    await resetUserData(client,'user-1','total');

    expect(query.mock.calls.map(([sql])=>sql)).toEqual([
      'SELECT id FROM buckets WHERE user_id=$1 ORDER BY id FOR UPDATE',
      'DELETE FROM planned_expense_payments WHERE user_id=$1',
      'DELETE FROM planned_expense_occurrences WHERE user_id=$1',
      'DELETE FROM planned_expenses WHERE user_id=$1',
      'DELETE FROM templates WHERE user_id=$1',
      'DELETE FROM operations WHERE user_id=$1',
      'DELETE FROM buckets WHERE user_id=$1',
    ]);
  });
});
