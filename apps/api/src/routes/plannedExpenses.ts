import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { pool } from '../db/pool.js';
import { sendDomainError } from '../http/errors.js';
import { monthSchema, positiveCentsSchema } from '../http/validation.js';
import { recordOperation } from '../services/ledger.js';

const id = z.string().uuid();
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const dateSchema = z.string().regex(datePattern).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid date');

const plannedExpenseInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).nullable().optional().transform((value) => value || null),
  category: z.enum(['subscription', 'installment', 'one_time', 'other']).default('other'),
  bucketId: id,
  amountCents: positiveCentsSchema,
  amountMode: z.enum(['fixed', 'estimated']),
  frequency: z.enum(['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'once']),
  dueRule: z.enum(['month', 'exact', 'start', 'mid', 'end']).default('month'),
  dueDay: z.number().int().min(1).max(31).nullable().default(null),
  dueDate: dateSchema.nullable().default(null),
  startMonth: monthSchema,
  durationMonths: z.number().int().min(1).max(1200).nullable().default(null),
}).superRefine((input, context) => {
  if (input.frequency !== 'monthly' && input.durationMonths !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['durationMonths'], message: 'Only monthly expenses can have a duration' });
  }
  if (input.dueRule === 'exact' && input.frequency !== 'once') {
    if (input.dueDay === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDay'], message: 'A recurring exact due day is required' });
    if (input.dueDate !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'A recurring expense uses dueDay' });
  }
  if (input.dueRule === 'exact' && input.frequency === 'once') {
    if (input.dueDate === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'A one-off exact due date is required' });
    if (input.dueDay !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDay'], message: 'A one-off expense does not use dueDay' });
    if (input.dueDate !== null && input.dueDate.slice(0, 7) !== input.startMonth) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'dueDate must fall in startMonth' });
    }
  }
  if (input.dueRule !== 'exact' && (input.dueDay !== null || input.dueDate !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only exact due rules use a due date or day' });
  }
});

const paymentInput = z.object({
  month: monthSchema,
  amountCents: positiveCentsSchema,
  note: z.string().trim().max(300).optional(),
  complete: z.boolean(),
  idempotencyKey: z.string().uuid(),
});
const occurrenceActionInput = z.object({ month: monthSchema });
const correctionInput = occurrenceActionInput.extend({
  actualTotalCents: positiveCentsSchema,
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().uuid(),
});
const cancellationInput = occurrenceActionInput.extend({ idempotencyKey: z.string().uuid() });
const estimatedTotalVisibilityInput = z.object({
  month: monthSchema,
  includedInEstimatedTotal: z.boolean(),
  scope: z.enum(['month', 'from_month']),
});

type PlanForPayment = {
  id: string;
  name: string;
  bucketId: string;
  amountCents: string;
  frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual' | 'once';
  dueRule: 'month' | 'exact' | 'start' | 'mid' | 'end';
  dueDay: number | null;
  dueDate: string | null;
  startMonth: string;
  durationMonths: number | null;
  archivedAt: string | null;
};

type ActiveExpenseRow = {
  id: string;
  name: string;
  description: string | null;
  category: 'subscription' | 'installment' | 'one_time' | 'other';
  bucketId: string;
  bucketName: string;
  bucketIcon: string;
  bucketColor: string;
  bucketType: 'spending' | 'saving' | 'investment' | 'other';
  amountCents: string;
  occurrenceAmountCents: string | null;
  occurrenceDueDate: string | null;
  amountMode: 'fixed' | 'estimated';
  frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual' | 'once';
  dueRule: 'month' | 'exact' | 'start' | 'mid' | 'end';
  dueDay: number | null;
  dueDate: string | null;
  startMonth: string;
  durationMonths: number | null;
  status: 'open' | 'completed';
  actualAmountCents: string;
  paymentCount: number;
  completedAt: string | null;
  includedInEstimatedTotal: boolean;
};

type EndedExpenseRow = Omit<ActiveExpenseRow, 'occurrenceAmountCents' | 'occurrenceDueDate' | 'status' | 'actualAmountCents' | 'paymentCount' | 'completedAt'> & {
  archivedAt: string | null;
  endedReason: 'archived' | 'expired';
};

type ManagedExpenseRow = Omit<EndedExpenseRow, 'endedReason'>;

type ExistingPayment = {
  paymentId: string;
  operationId: string;
  plannedExpenseId: string;
  period: string;
};

type OccurrenceForAction = { id: string; status: 'open' | 'completed'; amountMode: 'fixed' | 'estimated' };
type OccurrenceTotal = { actualAmountCents: string; paymentCount: number };

function monthStart(month: string): string {
  return `${month}-01`;
}

function monthAfter(month: string, offset: number): string {
  const [year, value] = month.split('-').map(Number) as [number, number];
  const result = new Date(Date.UTC(year, value - 1 + offset, 1));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthlyDueDate(month: string, dueRule: PlanForPayment['dueRule'], dueDay: number | null): string {
  const [year, value] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, value, 0)).getUTCDate();
  const day = dueRule === 'month' || dueRule === 'start' ? 1 : dueRule === 'mid' ? 15 : dueRule === 'end' ? lastDay : Math.min(dueDay ?? 1, lastDay);
  return `${month}-${String(day).padStart(2, '0')}`;
}

function dueDateFor(plan: PlanForPayment, month: string): string {
  if (plan.frequency === 'once' && plan.dueRule === 'exact') return plan.dueDate!;
  return monthlyDueDate(month, plan.dueRule, plan.dueDay);
}

function monthsBetween(startMonth: string, month: string): number {
  const [startYear, startValue] = startMonth.split('-').map(Number) as [number, number];
  const [year, value] = month.split('-').map(Number) as [number, number];
  return (year - startYear) * 12 + value - startValue;
}

function recurrenceInterval(frequency: PlanForPayment['frequency']): number {
  return ({ monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12, once: 0 })[frequency];
}

function isActiveInMonth(plan: Pick<PlanForPayment, 'frequency' | 'startMonth' | 'durationMonths'>, month: string): boolean {
  if (plan.frequency === 'once') return plan.startMonth === month;
  if (plan.startMonth > month) return false;
  if (monthsBetween(plan.startMonth, month) % recurrenceInterval(plan.frequency) !== 0) return false;
  return plan.durationMonths === null || monthAfter(plan.startMonth, plan.durationMonths) > month;
}

async function isIncludedInEstimatedTotal(client: { query: <T>(query: string, values: unknown[]) => Promise<{ rows: T[] }> }, plannedExpenseId: string, userId: string, month: string): Promise<boolean> {
  const result = await client.query<{ includedInEstimatedTotal: boolean }>(
    `SELECT COALESCE((
       SELECT included_in_estimated_total
       FROM planned_expense_estimated_total_visibility
       WHERE planned_expense_id=$1 AND user_id=$2 AND effective_month <= $3::date
       ORDER BY effective_month DESC LIMIT 1
     ),true) AS "includedInEstimatedTotal"`,
    [plannedExpenseId, userId, monthStart(month)],
  );
  return result.rows[0]?.includedInEstimatedTotal ?? true;
}

function hasFutureOccurrence(plan: Pick<PlanForPayment, 'frequency' | 'startMonth' | 'durationMonths'>, completedMonth: string): boolean {
  if (plan.frequency === 'once') return false;
  if (plan.frequency !== 'monthly' || plan.durationMonths === null) return true;
  return isActiveInMonth(plan, monthAfter(completedMonth, 1));
}

async function archiveIfFinalOccurrence(client: { query: (query: string, values: unknown[]) => Promise<unknown> }, plan: Pick<PlanForPayment, 'id' | 'frequency' | 'startMonth' | 'durationMonths'>, userId: string, completedMonth: string): Promise<void> {
  if (hasFutureOccurrence(plan, completedMonth)) return;
  await client.query(
    `UPDATE planned_expenses SET archived_at=now(),updated_at=now()
     WHERE id=$1 AND user_id=$2 AND archived_at IS NULL`,
    [plan.id, userId],
  );
}

async function archiveFinishedPlans(userId: string): Promise<void> {
  // This also catches plans that ended before automatic archival was added.
  // A plan only becomes expired after its final scheduled month has passed;
  // completing its final occurrence archives it immediately instead.
  await pool.query(
    `UPDATE planned_expenses p SET archived_at=now(),updated_at=now()
     WHERE p.user_id=$1 AND p.archived_at IS NULL AND (
       (p.frequency='once' AND (
         p.start_month < date_trunc('month',CURRENT_DATE)::date
         OR EXISTS(
           SELECT 1 FROM planned_expense_occurrences o
           WHERE o.planned_expense_id=p.id AND o.user_id=p.user_id AND o.status='completed'
         )
       ))
       OR (p.frequency='monthly' AND p.duration_months IS NOT NULL AND (
         (p.start_month + (p.duration_months || ' months')::interval)::date <= date_trunc('month',CURRENT_DATE)::date
         OR EXISTS(
           SELECT 1 FROM planned_expense_occurrences o
           WHERE o.planned_expense_id=p.id AND o.user_id=p.user_id
             AND o.period=(p.start_month + ((p.duration_months - 1) || ' months')::interval)::date
             AND o.status='completed'
         )
         OR (p.amount_mode='fixed' AND (
           SELECT COUNT(*) FROM planned_expense_occurrences o
           WHERE o.planned_expense_id=p.id AND o.user_id=p.user_id AND o.status='completed'
         ) >= p.duration_months)
       ))
     )`,
    [userId],
  );
}

async function findPaymentByKey(client: { query: (query: string, values: unknown[]) => Promise<{ rows: ExistingPayment[] }> }, userId: string, idempotencyKey: string): Promise<ExistingPayment | undefined> {
  const result = await client.query(
    `SELECT pp.id AS "paymentId",pp.operation_id AS "operationId",o.planned_expense_id AS "plannedExpenseId",
            to_char(o.period,'YYYY-MM-DD') AS period
     FROM planned_expense_payments pp
     JOIN planned_expense_occurrences o ON o.id=pp.occurrence_id
     WHERE pp.user_id=$1 AND pp.idempotency_key=$2`,
    [userId, idempotencyKey],
  );
  return result.rows[0];
}

function isMatchingPayment(payment: ExistingPayment, plannedExpenseId: string, period: string): boolean {
  return payment.plannedExpenseId === plannedExpenseId && payment.period === period;
}

async function findOccurrenceForAction(client: { query: (query: string, values: unknown[]) => Promise<{ rows: OccurrenceForAction[] }> }, plannedExpenseId: string, userId: string, period: string): Promise<OccurrenceForAction | undefined> {
  const result = await client.query(
    `SELECT o.id,o.status,p.amount_mode AS "amountMode"
     FROM planned_expense_occurrences o
     JOIN planned_expenses p ON p.id=o.planned_expense_id AND p.user_id=o.user_id
     WHERE o.planned_expense_id=$1 AND o.user_id=$2 AND o.period=$3::date FOR UPDATE OF o`,
    [plannedExpenseId, userId, period],
  );
  return result.rows[0];
}

async function occurrenceTotal(client: { query: (query: string, values: unknown[]) => Promise<{ rows: OccurrenceTotal[] }> }, occurrenceId: string): Promise<OccurrenceTotal> {
  const result = await client.query(
    `SELECT COALESCE(SUM(amount_cents),0)::text AS "actualAmountCents",
            COUNT(id)::integer AS "paymentCount"
     FROM planned_expense_payments WHERE occurrence_id=$1`,
    [occurrenceId],
  );
  return result.rows[0] ?? { actualAmountCents: '0', paymentCount: 0 };
}

function endedExpense(row: EndedExpenseRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    bucketId: row.bucketId,
    bucketName: row.bucketName,
    bucketIcon: row.bucketIcon,
    bucketColor: row.bucketColor,
    bucketType: row.bucketType,
    amountCents: row.amountCents,
    configuredAmountCents: row.amountCents,
    amountMode: row.amountMode,
    frequency: row.frequency,
    dueRule: row.dueRule,
    dueDay: row.dueDay,
    dueDate: row.dueDate,
    startMonth: row.startMonth,
    durationMonths: row.durationMonths,
    archivedAt: row.archivedAt,
    endedReason: row.endedReason,
  };
}

export function registerPlannedExpenseRoutes(app: FastifyInstance): void {
  app.get('/api/planned-expenses/manage', { preHandler: requireAuth }, async (request) => {
    await archiveFinishedPlans(request.userId);
    const result = await pool.query<ManagedExpenseRow>(
      `SELECT p.id,p.name,p.description,p.bucket_id AS "bucketId",b.name AS "bucketName",b.icon AS "bucketIcon",b.color AS "bucketColor",b.type AS "bucketType",
              p.amount_cents::text AS "amountCents",p.category,p.amount_mode AS "amountMode",p.frequency,
              p.due_rule AS "dueRule",p.due_day AS "dueDay",to_char(p.due_date,'YYYY-MM-DD') AS "dueDate",
              to_char(p.start_month,'YYYY-MM') AS "startMonth",p.duration_months AS "durationMonths",p.archived_at AS "archivedAt"
       FROM planned_expenses p
       JOIN buckets b ON b.id=p.bucket_id AND b.user_id=p.user_id
       WHERE p.user_id=$1
       ORDER BY p.archived_at NULLS FIRST,p.start_month DESC,p.name,p.id`,
      [request.userId],
    );
    return { expenses: result.rows.map((row) => ({ ...endedExpense({ ...row, endedReason: 'archived' }), archivedAt: row.archivedAt })) };
  });

  app.get('/api/planned-expenses', { preHandler: requireAuth }, async (request) => {
    const { month } = z.object({ month: monthSchema }).parse(request.query);
    const period = monthStart(month);
    await archiveFinishedPlans(request.userId);
    const [active, ended] = await Promise.all([
      pool.query<ActiveExpenseRow>(
        `SELECT p.id,p.name,p.description,p.bucket_id AS "bucketId",b.name AS "bucketName",b.icon AS "bucketIcon",b.color AS "bucketColor",b.type AS "bucketType",
              p.amount_cents::text AS "amountCents",p.category,o.amount_cents::text AS "occurrenceAmountCents",to_char(o.due_date,'YYYY-MM-DD') AS "occurrenceDueDate",p.amount_mode AS "amountMode",
              p.frequency,p.due_rule AS "dueRule",p.due_day AS "dueDay",to_char(p.due_date,'YYYY-MM-DD') AS "dueDate",
              to_char(p.start_month,'YYYY-MM') AS "startMonth",p.duration_months AS "durationMonths",
              COALESCE(o.status,'open') AS status,COALESCE(SUM(pp.amount_cents),0)::text AS "actualAmountCents",
                COUNT(pp.id)::integer AS "paymentCount",o.completed_at AS "completedAt",
                COALESCE(v.included_in_estimated_total,true) AS "includedInEstimatedTotal"
         FROM planned_expenses p
         JOIN buckets b ON b.id=p.bucket_id AND b.user_id=p.user_id
         LEFT JOIN planned_expense_occurrences o ON o.planned_expense_id=p.id AND o.user_id=p.user_id AND o.period=$2::date
         LEFT JOIN planned_expense_payments pp ON pp.occurrence_id=o.id AND pp.user_id=p.user_id
         LEFT JOIN LATERAL (
           SELECT included_in_estimated_total
           FROM planned_expense_estimated_total_visibility
           WHERE planned_expense_id=p.id AND user_id=p.user_id AND effective_month <= $2::date
           ORDER BY effective_month DESC LIMIT 1
         ) v ON TRUE
         WHERE p.user_id=$1 AND (
           -- Keep a materialized occurrence visible even after its plan is
           -- archived, so its payment can still be corrected or cancelled.
           o.id IS NOT NULL
           OR (p.archived_at IS NULL AND (
             (p.frequency='monthly' AND p.start_month <= $2::date
               AND (p.duration_months IS NULL OR (p.start_month + (p.duration_months || ' months')::interval)::date > $2::date))
             OR (p.frequency IN ('bimonthly','quarterly','semiannual','annual') AND p.start_month <= $2::date
               AND (
                 (EXTRACT(YEAR FROM $2::date)::integer*12 + EXTRACT(MONTH FROM $2::date)::integer)
                 - (EXTRACT(YEAR FROM p.start_month)::integer*12 + EXTRACT(MONTH FROM p.start_month)::integer)
               ) % CASE p.frequency WHEN 'bimonthly' THEN 2 WHEN 'quarterly' THEN 3 WHEN 'semiannual' THEN 6 ELSE 12 END = 0)
             OR (p.frequency='once' AND p.start_month=$2::date)
           ))
         )
         GROUP BY p.id,b.id,o.id,v.included_in_estimated_total
         ORDER BY p.name,p.id`,
        [request.userId, period],
      ),
      pool.query<EndedExpenseRow>(
        `SELECT p.id,p.name,p.description,p.bucket_id AS "bucketId",b.name AS "bucketName",b.icon AS "bucketIcon",b.color AS "bucketColor",b.type AS "bucketType",
              p.amount_cents::text AS "amountCents",p.category,p.amount_mode AS "amountMode",p.frequency,
                p.due_rule AS "dueRule",p.due_day AS "dueDay",p.due_date AS "dueDate",
                to_char(p.start_month,'YYYY-MM') AS "startMonth",p.duration_months AS "durationMonths",
                p.archived_at AS "archivedAt",
                CASE WHEN p.archived_at IS NOT NULL THEN 'archived' ELSE 'expired' END AS "endedReason"
         FROM planned_expenses p
         JOIN buckets b ON b.id=p.bucket_id AND b.user_id=p.user_id
         WHERE p.user_id=$1 AND (
           p.archived_at IS NOT NULL
           OR (p.frequency='once' AND p.start_month < $2::date)
           OR (p.frequency='monthly' AND p.duration_months IS NOT NULL
               AND (p.start_month + (p.duration_months || ' months')::interval)::date <= $2::date)
         )
         ORDER BY p.archived_at DESC NULLS LAST,p.name,p.id`,
        [request.userId, period],
      ),
    ]);
    const expenses = active.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      bucketId: row.bucketId,
      bucketName: row.bucketName,
      bucketIcon: row.bucketIcon,
      bucketColor: row.bucketColor,
      bucketType: row.bucketType,
      amountCents: row.occurrenceAmountCents ?? row.amountCents,
      configuredAmountCents: row.amountCents,
      amountMode: row.amountMode,
      frequency: row.frequency,
      dueRule: row.dueRule,
      dueDay: row.dueDay,
      dueDate: row.occurrenceDueDate ?? row.dueDate,
      startMonth: row.startMonth,
      durationMonths: row.durationMonths,
      period: month,
      status: row.status,
      actualAmountCents: row.actualAmountCents,
      paymentCount: row.paymentCount,
      completedAt: row.completedAt,
      archivedAt: null,
      includedInEstimatedTotal: row.includedInEstimatedTotal,
      scheduledDate: row.occurrenceDueDate ?? dueDateFor({
        id: row.id,
        name: row.name,
        bucketId: row.bucketId,
        amountCents: row.amountCents,
        frequency: row.frequency,
        dueRule: row.dueRule,
        dueDay: row.dueDay,
        dueDate: row.dueDate,
        startMonth: row.startMonth,
        durationMonths: row.durationMonths,
        archivedAt: null,
      }, month),
    }));
    expenses.sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.name.localeCompare(right.name));
    return {
      expenses,
      endedExpenses: ended.rows.map(endedExpense),
    };
  });

  app.post('/api/planned-expenses', { preHandler: requireAuth }, async (request, reply) => {
    const input = plannedExpenseInput.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bucket = await client.query<{ id: string }>(
        'SELECT id FROM buckets WHERE id=$1 AND user_id=$2 AND archived_at IS NULL FOR KEY SHARE',
        [input.bucketId, request.userId],
      );
      if (!bucket.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'BUCKET_NOT_FOUND' });
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO planned_expenses(
           user_id,bucket_id,name,description,category,amount_cents,amount_mode,frequency,due_rule,due_day,due_date,start_month,duration_months
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13) RETURNING id`,
        [
          request.userId, input.bucketId, input.name, input.description, input.category, input.amountCents, input.amountMode,
          input.frequency, input.dueRule, input.dueDay, input.dueDate, monthStart(input.startMonth), input.durationMonths,
        ],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ id: result.rows[0]!.id });
    } catch (error) {
      await client.query('ROLLBACK');
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.patch('/api/planned-expenses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const input = plannedExpenseInput.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bucket = await client.query<{ id: string }>(
        'SELECT id FROM buckets WHERE id=$1 AND user_id=$2 AND archived_at IS NULL FOR KEY SHARE',
        [input.bucketId, request.userId],
      );
      if (!bucket.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'BUCKET_NOT_FOUND' });
      }
      const result = await client.query<{ id: string }>(
        `UPDATE planned_expenses
         SET bucket_id=$1,name=$2,description=$3,category=$4,amount_cents=$5,amount_mode=$6,frequency=$7,due_rule=$8,due_day=$9,due_date=$10,
             start_month=$11::date,duration_months=$12,updated_at=now()
         WHERE id=$13 AND user_id=$14 AND archived_at IS NULL
         RETURNING id`,
        [
          input.bucketId, input.name, input.description, input.category, input.amountCents, input.amountMode, input.frequency,
          input.dueRule, input.dueDay, input.dueDate, monthStart(input.startMonth), input.durationMonths, plannedExpenseId, request.userId,
        ],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_NOT_FOUND' });
      }
      await client.query('COMMIT');
      return { id: plannedExpenseId };
    } catch (error) {
      await client.query('ROLLBACK');
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.post('/api/planned-expenses/:id/estimated-total-visibility', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const input = estimatedTotalVisibilityInput.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planResult = await client.query<PlanForPayment>(
        `SELECT id,name,bucket_id AS "bucketId",amount_cents::text AS "amountCents",frequency,due_rule AS "dueRule",
                due_day AS "dueDay",due_date AS "dueDate",to_char(start_month,'YYYY-MM') AS "startMonth",
                duration_months AS "durationMonths",archived_at AS "archivedAt"
         FROM planned_expenses WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [plannedExpenseId, request.userId],
      );
      const plan = planResult.rows[0];
      if (!plan || plan.archivedAt || !isActiveInMonth(plan, input.month)) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_NOT_FOUND' });
      }
      const total = await client.query<{ actualAmountCents: string; paymentCount: number }>(
        `SELECT COALESCE(SUM(pp.amount_cents),0)::text AS "actualAmountCents",COUNT(pp.id)::integer AS "paymentCount"
         FROM planned_expense_occurrences o
         LEFT JOIN planned_expense_payments pp ON pp.occurrence_id=o.id AND pp.user_id=o.user_id
         WHERE o.planned_expense_id=$1 AND o.user_id=$2 AND o.period=$3::date`,
        [plannedExpenseId, request.userId, monthStart(input.month)],
      );
      if ((total.rows[0]?.paymentCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_HAS_PAYMENTS' });
      }
      const effectiveMonth = monthStart(input.month);
      const nextMonth = monthAfter(input.month, 1);
      let nextRuleExists = true;
      let nextIncluded = true;
      if (input.scope === 'month') {
        const nextRule = await client.query<{ id: string }>(
          `SELECT id FROM planned_expense_estimated_total_visibility
           WHERE planned_expense_id=$1 AND user_id=$2 AND effective_month=$3::date`,
          [plannedExpenseId, request.userId, monthStart(nextMonth)],
        );
        nextRuleExists = Boolean(nextRule.rows[0]);
        if (!nextRuleExists) nextIncluded = await isIncludedInEstimatedTotal(client, plannedExpenseId, request.userId, nextMonth);
      }
      if (input.scope === 'from_month') {
        await client.query(
          `DELETE FROM planned_expense_estimated_total_visibility
           WHERE planned_expense_id=$1 AND user_id=$2 AND effective_month > $3::date`,
          [plannedExpenseId, request.userId, effectiveMonth],
        );
      }
      await client.query(
        `INSERT INTO planned_expense_estimated_total_visibility(planned_expense_id,user_id,effective_month,included_in_estimated_total)
         VALUES($1,$2,$3::date,$4)
         ON CONFLICT(planned_expense_id,effective_month) DO UPDATE
           SET included_in_estimated_total=EXCLUDED.included_in_estimated_total,updated_at=now()`,
        [plannedExpenseId, request.userId, effectiveMonth, input.includedInEstimatedTotal],
      );
      if (input.scope === 'month') {
        if (!nextRuleExists) {
          await client.query(
            `INSERT INTO planned_expense_estimated_total_visibility(planned_expense_id,user_id,effective_month,included_in_estimated_total)
             VALUES($1,$2,$3::date,$4)`,
            [plannedExpenseId, request.userId, monthStart(nextMonth), nextIncluded],
          );
        }
      }
      await client.query('COMMIT');
      return { includedInEstimatedTotal: input.includedInEstimatedTotal };
    } catch (error) {
      await client.query('ROLLBACK');
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.delete('/api/planned-expenses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const result = await pool.query<{ id: string }>(
      `UPDATE planned_expenses SET archived_at=now(),updated_at=now()
       WHERE id=$1 AND user_id=$2 AND archived_at IS NULL RETURNING id`,
      [plannedExpenseId, request.userId],
    );
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'PLANNED_EXPENSE_NOT_FOUND' });
  });

  // A permanent removal is deliberately limited to already archived plans.
  // Cascading removes their planning-only occurrences and payment links; the
  // immutable ledger operations stay in the financial history.
  app.delete('/api/planned-expenses/:id/permanent', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const result = await pool.query<{ id: string }>(
      `DELETE FROM planned_expenses
       WHERE id=$1 AND user_id=$2 AND archived_at IS NOT NULL
       RETURNING id`,
      [plannedExpenseId, request.userId],
    );
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'ARCHIVED_PLANNED_EXPENSE_NOT_FOUND' });
  });

  app.post('/api/planned-expenses/:id/complete', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const { month } = occurrenceActionInput.parse(request.body);
    const period = monthStart(month);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planResult = await client.query<PlanForPayment>(
        `SELECT id,name,bucket_id AS "bucketId",amount_cents::text AS "amountCents",frequency,due_rule AS "dueRule",
                due_day AS "dueDay",due_date AS "dueDate",to_char(start_month,'YYYY-MM') AS "startMonth",
                duration_months AS "durationMonths",archived_at AS "archivedAt"
         FROM planned_expenses WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [plannedExpenseId, request.userId],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_NOT_FOUND' });
      }
      if (!await isIncludedInEstimatedTotal(client, plannedExpenseId, request.userId, month)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_EXCLUDED_FROM_ESTIMATED_TOTAL' });
      }
      const occurrence = await findOccurrenceForAction(client, plannedExpenseId, request.userId, period);
      if (!occurrence) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_OCCURRENCE_NOT_FOUND' });
      }
      if (occurrence.status === 'completed') {
        await client.query('COMMIT');
        return { status: 'completed', duplicate: true };
      }
      if (occurrence.amountMode !== 'estimated') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_NOT_ESTIMATED' });
      }
      const total = await occurrenceTotal(client, occurrence.id);
      if (BigInt(total.actualAmountCents) <= 0n || total.paymentCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_HAS_NO_PAYMENTS' });
      }
      await client.query(
        `UPDATE planned_expense_occurrences
         SET status='completed',completed_at=now(),updated_at=now() WHERE id=$1`,
        [occurrence.id],
      );
      await archiveIfFinalOccurrence(client, plan, request.userId, month);
      await client.query('COMMIT');
      return { status: 'completed' };
    } catch (error) {
      await client.query('ROLLBACK');
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.post('/api/planned-expenses/:id/reopen', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const { month } = occurrenceActionInput.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const occurrence = await findOccurrenceForAction(client, plannedExpenseId, request.userId, monthStart(month));
      if (!occurrence) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_OCCURRENCE_NOT_FOUND' });
      }
      if (occurrence.status === 'open') {
        await client.query('COMMIT');
        return { status: 'open', duplicate: true };
      }
      await client.query(
        `UPDATE planned_expense_occurrences
         SET status='open',completed_at=NULL,updated_at=now() WHERE id=$1`,
        [occurrence.id],
      );
      await client.query(
        `UPDATE planned_expenses SET archived_at=NULL,updated_at=now()
         WHERE id=$1 AND user_id=$2`,
        [plannedExpenseId, request.userId],
      );
      await client.query('COMMIT');
      return { status: 'open' };
    } catch (error) {
      await client.query('ROLLBACK');
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.post('/api/planned-expenses/:id/correct', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const input = correctionInput.parse(request.body);
    const period = monthStart(input.month);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planResult = await client.query<PlanForPayment>(
        `SELECT id,name,bucket_id AS "bucketId",amount_cents::text AS "amountCents",frequency,due_rule AS "dueRule",
                due_day AS "dueDay",due_date AS "dueDate",to_char(start_month,'YYYY-MM') AS "startMonth",
                duration_months AS "durationMonths",archived_at AS "archivedAt"
         FROM planned_expenses WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [plannedExpenseId, request.userId],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_NOT_FOUND' });
      }
      const existing = await findPaymentByKey(client, request.userId, input.idempotencyKey);
      if (existing) {
        await client.query('COMMIT');
        if (!isMatchingPayment(existing, plannedExpenseId, period)) return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
        return { paymentId: existing.paymentId, operationId: existing.operationId, status: 'completed', duplicate: true };
      }
      const occurrence = await findOccurrenceForAction(client, plan.id, request.userId, period);
      if (!occurrence) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_OCCURRENCE_NOT_FOUND' });
      }
      if (occurrence.status !== 'completed') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_NOT_COMPLETED' });
      }
      const total = await occurrenceTotal(client, occurrence.id);
      const delta = BigInt(input.actualTotalCents) - BigInt(total.actualAmountCents);
      if (delta === 0n) {
        await client.query('COMMIT');
        return { status: 'completed', duplicate: true };
      }
      const operationId = await recordOperation(
        client,
        request.userId,
        'adjustment',
        [{ bucketId: plan.bucketId, amountCents: (-delta).toString() }],
        input.note || `Rettifica spesa prevista: ${plan.name}`,
        input.idempotencyKey,
      );
      const payment = await client.query<{ id: string }>(
        `INSERT INTO planned_expense_payments(occurrence_id,user_id,operation_id,amount_cents,note,idempotency_key)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [occurrence.id, request.userId, operationId, delta.toString(), input.note || null, input.idempotencyKey],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ paymentId: payment.rows[0]!.id, operationId, status: 'completed' });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        const existing = await findPaymentByKey(pool, request.userId, input.idempotencyKey);
        if (existing && isMatchingPayment(existing, plannedExpenseId, period)) return { paymentId: existing.paymentId, operationId: existing.operationId, status: 'completed', duplicate: true };
        return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
      }
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.post('/api/planned-expenses/:id/cancel-payments', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const input = cancellationInput.parse(request.body);
    const period = monthStart(input.month);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planResult = await client.query<PlanForPayment>(
        `SELECT id,name,bucket_id AS "bucketId",amount_cents::text AS "amountCents",frequency,due_rule AS "dueRule",
                due_day AS "dueDay",due_date AS "dueDate",to_char(start_month,'YYYY-MM') AS "startMonth",
                duration_months AS "durationMonths",archived_at AS "archivedAt"
         FROM planned_expenses WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [plannedExpenseId, request.userId],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_NOT_FOUND' });
      }
      const existing = await findPaymentByKey(client, request.userId, input.idempotencyKey);
      if (existing) {
        await client.query('COMMIT');
        if (!isMatchingPayment(existing, plannedExpenseId, period)) return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
        return { paymentId: existing.paymentId, operationId: existing.operationId, status: 'open', duplicate: true };
      }
      const occurrence = await findOccurrenceForAction(client, plan.id, request.userId, period);
      if (!occurrence) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_OCCURRENCE_NOT_FOUND' });
      }
      if (occurrence.status !== 'completed') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_NOT_COMPLETED' });
      }
      const total = await occurrenceTotal(client, occurrence.id);
      const amount = BigInt(total.actualAmountCents);
      if (amount <= 0n) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_HAS_NO_PAYMENTS' });
      }
      const operationId = await recordOperation(
        client,
        request.userId,
        'adjustment',
        [{ bucketId: plan.bucketId, amountCents: amount.toString() }],
        `Annullamento spesa prevista: ${plan.name}`,
        input.idempotencyKey,
      );
      const payment = await client.query<{ id: string }>(
        `INSERT INTO planned_expense_payments(occurrence_id,user_id,operation_id,amount_cents,note,idempotency_key)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [occurrence.id, request.userId, operationId, (-amount).toString(), 'Annullamento completo', input.idempotencyKey],
      );
      await client.query(
        `UPDATE planned_expense_occurrences
         SET status='open',completed_at=NULL,updated_at=now() WHERE id=$1`,
        [occurrence.id],
      );
      await client.query(
        `UPDATE planned_expenses SET archived_at=NULL,updated_at=now()
         WHERE id=$1 AND user_id=$2`,
        [plannedExpenseId, request.userId],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ paymentId: payment.rows[0]!.id, operationId, status: 'open' });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        const existing = await findPaymentByKey(pool, request.userId, input.idempotencyKey);
        if (existing && isMatchingPayment(existing, plannedExpenseId, period)) return { paymentId: existing.paymentId, operationId: existing.operationId, status: 'open', duplicate: true };
        return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
      }
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });

  app.post('/api/planned-expenses/:id/payments', { preHandler: requireAuth }, async (request, reply) => {
    const plannedExpenseId = id.parse((request.params as { id: string }).id);
    const input = paymentInput.parse(request.body);
    const period = monthStart(input.month);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planResult = await client.query<PlanForPayment>(
        `SELECT id,name,bucket_id AS "bucketId",amount_cents::text AS "amountCents",frequency,due_rule AS "dueRule",
                due_day AS "dueDay",due_date AS "dueDate",to_char(start_month,'YYYY-MM') AS "startMonth",
                duration_months AS "durationMonths",archived_at AS "archivedAt"
         FROM planned_expenses WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [plannedExpenseId, request.userId],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'PLANNED_EXPENSE_NOT_FOUND' });
      }
      const existing = await findPaymentByKey(client, request.userId, input.idempotencyKey);
      if (existing) {
        await client.query('COMMIT');
        if (!isMatchingPayment(existing, plannedExpenseId, period)) return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
        return reply.code(200).send({ paymentId: existing.paymentId, operationId: existing.operationId, duplicate: true });
      }
      if (!await isIncludedInEstimatedTotal(client, plannedExpenseId, request.userId, input.month)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_EXCLUDED_FROM_ESTIMATED_TOTAL' });
      }
      if (plan.archivedAt || !isActiveInMonth(plan, input.month)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_INACTIVE' });
      }
      const dueDate = dueDateFor(plan, input.month);
      await client.query(
        `INSERT INTO planned_expense_occurrences(planned_expense_id,user_id,period,amount_cents,due_date)
         VALUES($1,$2,$3::date,$4,$5::date)
         ON CONFLICT(planned_expense_id,period) DO NOTHING`,
        [plan.id, request.userId, period, plan.amountCents, dueDate],
      );
      const occurrenceResult = await client.query<{ id: string; status: 'open' | 'completed' }>(
        `SELECT id,status FROM planned_expense_occurrences
         WHERE planned_expense_id=$1 AND user_id=$2 AND period=$3::date FOR UPDATE`,
        [plan.id, request.userId, period],
      );
      const occurrence = occurrenceResult.rows[0];
      if (!occurrence) throw new Error('PLANNED_EXPENSE_OCCURRENCE_NOT_FOUND');
      if (occurrence.status === 'completed') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'PLANNED_EXPENSE_COMPLETED' });
      }
      const operationId = await recordOperation(
        client,
        request.userId,
        'adjustment',
        [{ bucketId: plan.bucketId, amountCents: `-${input.amountCents}` }],
        input.note || `Spesa prevista: ${plan.name}`,
        input.idempotencyKey,
      );
      const payment = await client.query<{ id: string }>(
        `INSERT INTO planned_expense_payments(occurrence_id,user_id,operation_id,amount_cents,note,idempotency_key)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [occurrence.id, request.userId, operationId, input.amountCents, input.note || null, input.idempotencyKey],
      );
      if (input.complete) {
        await client.query(
          `UPDATE planned_expense_occurrences
           SET status='completed',completed_at=now(),updated_at=now()
           WHERE id=$1`,
          [occurrence.id],
        );
        await archiveIfFinalOccurrence(client, plan, request.userId, input.month);
      }
      await client.query('COMMIT');
      return reply.code(201).send({ paymentId: payment.rows[0]!.id, operationId, status: input.complete ? 'completed' : 'open' });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        const existing = await findPaymentByKey(pool, request.userId, input.idempotencyKey);
        if (existing && isMatchingPayment(existing, plannedExpenseId, period)) {
          return reply.code(200).send({ paymentId: existing.paymentId, operationId: existing.operationId, duplicate: true });
        }
        return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
      }
      return sendDomainError(reply, error);
    } finally {
      client.release();
    }
  });
}
