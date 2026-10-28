import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const { poolQueryMock, clientQueryMock, connectMock, recordOperationMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  clientQueryMock: vi.fn(),
  connectMock: vi.fn(),
  recordOperationMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({ pool: { query: poolQueryMock, connect: connectMock } }));
vi.mock('../src/auth.js', () => ({
  requireAuth: async (request: { userId: string }) => { request.userId = '00000000-0000-4000-8000-000000000001'; },
}));
vi.mock('../src/services/ledger.js', () => ({ recordOperation: recordOperationMock }));

import { registerPlannedExpenseRoutes } from '../src/routes/plannedExpenses.js';

const userId = '00000000-0000-4000-8000-000000000001';
const bucketId = '00000000-0000-4000-8000-000000000002';
const planId = '00000000-0000-4000-8000-000000000003';
const occurrenceId = '00000000-0000-4000-8000-000000000004';
const paymentId = '00000000-0000-4000-8000-000000000005';
const operationId = '00000000-0000-4000-8000-000000000006';
const idempotencyKey = '00000000-0000-4000-8000-000000000007';

const monthlyInput = {
  name: 'Palestra', description: 'Quota mensile', bucketId, amountCents: '4999', amountMode: 'fixed', frequency: 'monthly',
  dueRule: 'exact', dueDay: 31, dueDate: null, startMonth: '2026-01', durationMonths: null,
};
const bimonthlyInput = {
  ...monthlyInput, name: 'Bolletta', frequency: 'bimonthly' as const, startMonth: '2026-09', dueDay: 15,
};

async function testApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    return reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });
  registerPlannedExpenseRoutes(app);
  await app.ready();
  return app;
}

describe('planned expense routes', () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    clientQueryMock.mockReset();
    connectMock.mockReset();
    recordOperationMock.mockReset();
    connectMock.mockResolvedValue({ query: clientQueryMock, release: vi.fn() });
  });

  it('validates monthly exact schedules before opening a database transaction', async () => {
    const app = await testApp();
    const response = await app.inject({ method: 'POST', url: '/api/planned-expenses', payload: { ...monthlyInput, dueDay: null } });

    expect(response.statusCode).toBe(400);
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts bimonthly schedules and rejects a recurring duration before opening a database transaction', async () => {
    const app = await testApp();
    const invalid = await app.inject({ method: 'POST', url: '/api/planned-expenses', payload: { ...bimonthlyInput, durationMonths: 12 } });
    expect(invalid.statusCode).toBe(400);
    expect(connectMock).not.toHaveBeenCalled();

    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: bucketId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: planId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    const valid = await app.inject({ method: 'POST', url: '/api/planned-expenses', payload: bimonthlyInput });
    expect(valid.statusCode).toBe(201);
    await app.close();
  });

  it('creates an owned planned expense with normalized start month', async () => {
    const app = await testApp();
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: bucketId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: planId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({ method: 'POST', url: '/api/planned-expenses', payload: monthlyInput });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: planId });
    expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain('INSERT INTO planned_expenses');
    expect(clientQueryMock.mock.calls[2]?.[1]).toEqual(expect.arrayContaining([userId, bucketId, 'Quota mensile', '2026-01-01']));
    await app.close();
  });

  it('excludes one month from the estimate and restores the previous visibility in the following month', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Abbonamento', bucketId, amountCents: '1000', frequency: 'monthly' as const, dueRule: 'month' as const,
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ actualAmountCents: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ includedInEstimatedTotal: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/estimated-total-visibility`,
      payload: { month: '2026-02', includedInEstimatedTotal: false, scope: 'month' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ includedInEstimatedTotal: false });
    expect(clientQueryMock.mock.calls[5]?.[1]).toEqual([planId, userId, '2026-02-01', false]);
    expect(clientQueryMock.mock.calls[6]?.[1]).toEqual([planId, userId, '2026-03-01', true]);
    await app.close();
  });

  it('refuses a payment while the planned expense is excluded from the estimate', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Abbonamento', bucketId, amountCents: '1000', frequency: 'monthly' as const, dueRule: 'month' as const,
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ includedInEstimatedTotal: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/payments`,
      payload: { month: '2026-02', amountCents: '1000', complete: false, idempotencyKey },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'PLANNED_EXPENSE_EXCLUDED_FROM_ESTIMATED_TOTAL' });
    expect(recordOperationMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not hide an open expense that already has payment records', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Abbonamento', bucketId, amountCents: '1000', frequency: 'monthly' as const, dueRule: 'month' as const,
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ actualAmountCents: '0', paymentCount: 2 }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/estimated-total-visibility`,
      payload: { month: '2026-02', includedInEstimatedTotal: false, scope: 'from_month' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'PLANNED_EXPENSE_HAS_PAYMENTS' });
    expect(clientQueryMock.mock.calls.some(([sql])=>String(sql).includes('INSERT INTO planned_expense_estimated_total_visibility'))).toBe(false);
    await app.close();
  });

  it('returns the occurrence snapshot for display and the configured amount for later edits', async () => {
    const app = await testApp();
    poolQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: planId, name: 'Carburante', bucketId, bucketName: 'Conto spese', bucketIcon: 'wallet', bucketColor: '#FF826F', bucketType: 'spending',
        amountCents: '10000', occurrenceAmountCents: '8500', occurrenceDueDate: '2026-02-27', amountMode: 'estimated', frequency: 'monthly', dueRule: 'end',
        dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, status: 'open', actualAmountCents: '4500', paymentCount: 1, completedAt: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({ method: 'GET', url: '/api/planned-expenses?month=2026-02' });

    expect(response.statusCode).toBe(200);
    expect(response.json().expenses).toEqual([expect.objectContaining({
      id: planId, amountCents: '8500', configuredAmountCents: '10000', bucketType: 'spending', period: '2026-02', dueDate: '2026-02-27', scheduledDate: '2026-02-27',
    })]);
    expect(String(poolQueryMock.mock.calls[1]?.[0])).toContain('o.id IS NOT NULL');
    expect(String(poolQueryMock.mock.calls[1]?.[0])).toContain('p.archived_at IS NULL AND (');
    await app.close();
  });

  it('formats occurrence due dates in SQL so the list can always be ordered after a payment', async () => {
    const app = await testApp();
    poolQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: planId, name: 'Carburante', bucketId, bucketName: 'Conto spese', bucketIcon: 'wallet', bucketColor: '#FF826F', bucketType: 'spending',
        amountCents: '10000', occurrenceAmountCents: '10000', occurrenceDueDate: '2026-02-28', amountMode: 'estimated', frequency: 'monthly', dueRule: 'end',
        dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, status: 'completed', actualAmountCents: '10000', paymentCount: 1, completedAt: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({ method: 'GET', url: '/api/planned-expenses?month=2026-02' });

    expect(response.statusCode).toBe(200);
    expect(String(poolQueryMock.mock.calls[1]?.[0])).toContain("to_char(o.due_date,'YYYY-MM-DD') AS \"occurrenceDueDate\"");
    await app.close();
  });

  it('selects recurring expenses only on their scheduled intervals', async () => {
    const app = await testApp();
    poolQueryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({ method: 'GET', url: '/api/planned-expenses?month=2027-09' });

    expect(response.statusCode).toBe(200);
    expect(String(poolQueryMock.mock.calls[1]?.[0])).toContain("p.frequency IN ('bimonthly','quarterly','semiannual','annual')");
    expect(String(poolQueryMock.mock.calls[1]?.[0])).toContain("WHEN 'bimonthly' THEN 2 WHEN 'quarterly' THEN 3 WHEN 'semiannual' THEN 6 ELSE 12 END");
    await app.close();
  });

  it('archives completed final plans and expired plans before listing them', async () => {
    const app = await testApp();
    poolQueryMock.mockResolvedValue({ rows: [] });

    const response = await app.inject({ method: 'GET', url: '/api/planned-expenses/manage' });

    expect(response.statusCode).toBe(200);
    expect(String(poolQueryMock.mock.calls[0]?.[0])).toContain("o.status='completed'");
    expect(String(poolQueryMock.mock.calls[0]?.[0])).toContain('COUNT(*) FROM planned_expense_occurrences');
    expect(String(poolQueryMock.mock.calls[0]?.[0])).toContain('CURRENT_DATE');
    expect(poolQueryMock.mock.calls[0]?.[1]).toEqual([userId]);
    await app.close();
  });

  it('permanently deletes only an archived plan owned by the account', async () => {
    const app = await testApp();
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: planId }], rowCount: 1 });

    const response = await app.inject({ method: 'DELETE', url: `/api/planned-expenses/${planId}/permanent` });

    expect(response.statusCode).toBe(204);
    expect(String(poolQueryMock.mock.calls[0]?.[0])).toContain('archived_at IS NOT NULL');
    expect(poolQueryMock.mock.calls[0]?.[1]).toEqual([planId, userId]);
    await app.close();
  });

  it('records an estimated payment as a negative ledger adjustment and clamps day 31 in February', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Carburante', bucketId, amountCents: '10000', frequency: 'monthly', dueRule: 'exact',
      dueDay: 31, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ includedInEstimatedTotal: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'open', amountMode: 'estimated' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: paymentId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    recordOperationMock.mockResolvedValue(operationId);

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/payments`,
      payload: { month: '2026-02', amountCents: '4500', complete: false, idempotencyKey },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ paymentId, operationId, status: 'open' });
    expect(clientQueryMock.mock.calls[4]?.[1]).toEqual(expect.arrayContaining([planId, userId, '2026-02-01', '10000', '2026-02-28']));
    expect(recordOperationMock).toHaveBeenCalledWith(
      expect.anything(), userId, 'adjustment', [{ bucketId, amountCents: '-4500' }], 'Spesa prevista: Carburante', idempotencyKey,
    );
    await app.close();
  });

  it('records an annual expense in the same month of a later year', async () => {
    const app = await testApp();
    const annualPlan = {
      id: planId, name: 'Assicurazione auto', bucketId, amountCents: '120000', frequency: 'annual', dueRule: 'exact',
      dueDay: 31, dueDate: null, startMonth: '2026-02', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [annualPlan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ includedInEstimatedTotal: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'open' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: paymentId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    recordOperationMock.mockResolvedValue(operationId);

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/payments`,
      payload: { month: '2027-02', amountCents: '120000', complete: true, idempotencyKey },
    });

    expect(response.statusCode).toBe(201);
    expect(clientQueryMock.mock.calls[4]?.[1]).toEqual(expect.arrayContaining([planId, userId, '2027-02-01', '120000', '2027-02-28']));
    await app.close();
  });

  it('returns the original payment on an idempotent retry, even after completion', async () => {
    const app = await testApp();
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: planId, name: 'Palestra', bucketId, amountCents: '4999', frequency: 'monthly', dueRule: 'exact',
        dueDay: 1, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
      }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ paymentId, operationId, plannedExpenseId: planId, period: '2026-02-01' }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/payments`,
      payload: { month: '2026-02', amountCents: '4999', complete: true, idempotencyKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ paymentId, operationId, duplicate: true });
    expect(recordOperationMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('closes and archives the final estimated occurrence without creating a ledger operation', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Carburante', bucketId, amountCents: '10000', frequency: 'monthly' as const, dueRule: 'month' as const,
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: 2, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ includedInEstimatedTotal: true }] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'open', amountMode: 'estimated' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ actualAmountCents: '4500', paymentCount: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({ method: 'POST', url: `/api/planned-expenses/${planId}/complete`, payload: { month: '2026-02' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'completed' });
    expect(recordOperationMock).not.toHaveBeenCalled();
    expect(String(clientQueryMock.mock.calls[5]?.[0])).toContain("SET status='completed'");
    expect(String(clientQueryMock.mock.calls[6]?.[0])).toContain('UPDATE planned_expenses SET archived_at=now()');
    await app.close();
  });

  it('archives a finite plan when its final occurrence is paid and completed', async () => {
    const app = await testApp();
    const finalInstallment = {
      id: planId, name: 'Telefono', bucketId, amountCents: '30000', frequency: 'monthly' as const, dueRule: 'month' as const,
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: 2, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [finalInstallment], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ includedInEstimatedTotal: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'open' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: paymentId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    recordOperationMock.mockResolvedValue(operationId);

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/payments`,
      payload: { month: '2026-02', amountCents: '30000', complete: true, idempotencyKey },
    });

    expect(response.statusCode).toBe(201);
    expect(String(clientQueryMock.mock.calls[8]?.[0])).toContain('UPDATE planned_expenses SET archived_at=now()');
    expect(clientQueryMock.mock.calls[8]?.[1]).toEqual([planId, userId]);
    await app.close();
  });

  it('reopens a completed occurrence without changing the ledger', async () => {
    const app = await testApp();
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'completed' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({ method: 'POST', url: `/api/planned-expenses/${planId}/reopen`, payload: { month: '2026-02' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'open' });
    expect(recordOperationMock).not.toHaveBeenCalled();
    expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("SET status='open'");
    expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain('SET archived_at=NULL');
    await app.close();
  });

  it('records only the signed difference when correcting a completed total', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Carburante', bucketId, amountCents: '10000', frequency: 'monthly', dueRule: 'month',
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'completed' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ actualAmountCents: '4500', paymentCount: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: paymentId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    recordOperationMock.mockResolvedValue(operationId);

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/correct`,
      payload: { month: '2026-02', actualTotalCents: '6000', idempotencyKey },
    });

    expect(response.statusCode).toBe(201);
    expect(recordOperationMock).toHaveBeenCalledWith(
      expect.anything(), userId, 'adjustment', [{ bucketId, amountCents: '-1500' }], 'Rettifica spesa prevista: Carburante', idempotencyKey,
    );
    expect(clientQueryMock.mock.calls[5]?.[1]).toEqual([occurrenceId, userId, operationId, '1500', null, idempotencyKey]);
    await app.close();
  });

  it('records a positive ledger compensation when the corrected total is lower', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Carburante', bucketId, amountCents: '10000', frequency: 'monthly', dueRule: 'month',
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'completed' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ actualAmountCents: '6000', paymentCount: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: paymentId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    recordOperationMock.mockResolvedValue(operationId);

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/correct`,
      payload: { month: '2026-02', actualTotalCents: '4500', idempotencyKey },
    });

    expect(response.statusCode).toBe(201);
    expect(recordOperationMock).toHaveBeenCalledWith(
      expect.anything(), userId, 'adjustment', [{ bucketId, amountCents: '1500' }], 'Rettifica spesa prevista: Carburante', idempotencyKey,
    );
    expect(clientQueryMock.mock.calls[5]?.[1]).toEqual([occurrenceId, userId, operationId, '-1500', null, idempotencyKey]);
    await app.close();
  });

  it('compensates every payment before reopening a completed occurrence', async () => {
    const app = await testApp();
    const plan = {
      id: planId, name: 'Palestra', bucketId, amountCents: '4999', frequency: 'monthly', dueRule: 'month',
      dueDay: null, dueDate: null, startMonth: '2026-01', durationMonths: null, archivedAt: null,
    };
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [plan], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: occurrenceId, status: 'completed' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ actualAmountCents: '4999', paymentCount: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: paymentId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    recordOperationMock.mockResolvedValue(operationId);

    const response = await app.inject({
      method: 'POST', url: `/api/planned-expenses/${planId}/cancel-payments`,
      payload: { month: '2026-02', idempotencyKey },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ paymentId, operationId, status: 'open' });
    expect(recordOperationMock).toHaveBeenCalledWith(
      expect.anything(), userId, 'adjustment', [{ bucketId, amountCents: '4999' }], 'Annullamento spesa prevista: Palestra', idempotencyKey,
    );
    expect(clientQueryMock.mock.calls[5]?.[1]).toEqual([occurrenceId, userId, operationId, '-4999', 'Annullamento completo', idempotencyKey]);
    expect(String(clientQueryMock.mock.calls[6]?.[0])).toContain("SET status='open'");
    expect(String(clientQueryMock.mock.calls[7]?.[0])).toContain('SET archived_at=NULL');
    await app.close();
  });
});
