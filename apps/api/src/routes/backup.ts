import { randomUUID } from 'node:crypto';
import type { FastifyInstance,FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { pool } from '../db/pool.js';
import { parseBackup,summarizeBackup } from '../services/backupFormat.js';
import { resetUserData } from '../services/dataReset.js';

const resetSchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('partial'),confirmation:z.literal('RESET_PARTIAL')}),
  z.object({mode:z.literal('total'),confirmation:z.literal('RESET_TOTAL')}),
]);

// The client encrypts protected backups itself and only tells the server so
// the export log can say which files need a password.
const exportQuery=z.object({protected:z.enum(['true','false']).optional()});
const EXPORT_HISTORY_LIMIT=20;

// Inserts every row of one table in a single statement. The SQL is a literal
// of the caller; rows travel as one JSON parameter typed by the table itself.
async function insertRows(client:PoolClient,sql:string,rows:Array<Record<string,unknown>>):Promise<void>{
  if(rows.length)await client.query(sql,[JSON.stringify(rows)]);
}

// Reads every table of the backup on one connection and in one consistent
// snapshot, instead of eight connections taken from the shared pool at once.
async function readSnapshot(client:PoolClient,userId:string){
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const buckets=await client.query(
      `SELECT id AS "legacyId",name,description,type,balance_cents::text AS "balanceCents",currency,icon,color,
              monthly_target_cents::text AS "monthlyTargetCents",sort_order AS "sortOrder",include_in_total AS "includeInTotal",
              archived_at AS "archivedAt",created_at AS "createdAt",updated_at AS "updatedAt"
       FROM buckets WHERE user_id=$1 ORDER BY archived_at NULLS FIRST,sort_order,created_at`,
      [userId],
    );
    const operations=await client.query(
      `SELECT o.id AS "legacyId",o.kind,o.note,o.idempotency_key AS "idempotencyKey",o.occurred_at AS "occurredAt",o.created_at AS "createdAt",
              json_agg(json_build_object('bucketLegacyId',e.bucket_id,'amountCents',e.amount_cents::text,'balanceAfterCents',e.balance_after_cents::text) ORDER BY e.id) AS entries
       FROM operations o JOIN operation_entries e ON e.operation_id=o.id
       WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.occurred_at,o.id`,
      [userId],
    );
    const templates=await client.query(
      `SELECT t.id AS "legacyId",t.name,t.allocation_mode AS mode,t.created_at AS "createdAt",t.updated_at AS "updatedAt",
              COALESCE(json_agg(json_build_object('bucketLegacyId',i.bucket_id,'amountCents',i.amount_cents::text,
                'percentageBasisPoints',i.percentage_basis_points,'sortOrder',i.sort_order) ORDER BY i.sort_order)
                FILTER (WHERE i.id IS NOT NULL),'[]') AS items
       FROM templates t LEFT JOIN template_items i ON i.template_id=t.id
       WHERE t.user_id=$1 GROUP BY t.id ORDER BY t.created_at,t.id`,
      [userId],
    );
    const plannedExpenses=await client.query(
      `SELECT p.id AS "legacyId",p.bucket_id AS "bucketLegacyId",p.name,p.description,p.amount_cents::text AS "amountCents",
              p.category,p.amount_mode AS "amountMode",p.frequency,p.due_rule AS "dueRule",p.due_day AS "dueDay",
              p.due_date::text AS "dueDate",p.start_month::text AS "startMonth",p.duration_months AS "durationMonths",
              p.archived_at AS "archivedAt",p.created_at AS "createdAt",p.updated_at AS "updatedAt"
       FROM planned_expenses p WHERE p.user_id=$1 ORDER BY p.archived_at NULLS FIRST,p.start_month,p.created_at,p.id`,
      [userId],
    );
    const plannedExpenseOccurrences=await client.query(
      `SELECT o.id AS "legacyId",o.planned_expense_id AS "plannedExpenseLegacyId",o.period::text AS period,
              o.amount_cents::text AS "amountCents",o.due_date::text AS "dueDate",o.status,o.completed_at AS "completedAt",
              o.created_at AS "createdAt",o.updated_at AS "updatedAt"
       FROM planned_expense_occurrences o WHERE o.user_id=$1 ORDER BY o.period,o.created_at,o.id`,
      [userId],
    );
    const plannedExpensePayments=await client.query(
      `SELECT p.id AS "legacyId",p.occurrence_id AS "occurrenceLegacyId",p.operation_id AS "operationLegacyId",
              p.amount_cents::text AS "amountCents",p.note,p.idempotency_key AS "idempotencyKey",p.created_at AS "createdAt"
       FROM planned_expense_payments p WHERE p.user_id=$1 ORDER BY p.created_at,p.id`,
      [userId],
    );
    const plannedExpenseEstimatedTotalVisibility=await client.query(
      `SELECT v.id AS "legacyId",v.planned_expense_id AS "plannedExpenseLegacyId",v.effective_month::text AS "effectiveMonth",
              v.included_in_estimated_total AS "includedInEstimatedTotal",v.created_at AS "createdAt",v.updated_at AS "updatedAt"
       FROM planned_expense_estimated_total_visibility v WHERE v.user_id=$1 ORDER BY v.effective_month,v.created_at,v.id`,
      [userId],
    );
    const settings=await client.query(
      `SELECT currency,locale,theme,hide_amounts AS "hideAmounts",quick_amounts_cents::text[] AS "quickAmountsCents",updated_at AS "updatedAt"
       FROM user_settings WHERE user_id=$1`,
      [userId],
    );
    await client.query('COMMIT');
    return {buckets,operations,templates,plannedExpenses,plannedExpenseOccurrences,plannedExpensePayments,plannedExpenseEstimatedTotalVisibility,settings};
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }
}

export function registerBackupRoutes(app:FastifyInstance):void{
  // One backup job per user at a time: export, import and reset each hold a
  // database connection, so parallel requests cannot occupy the shared pool.
  const runningJobs=new Set<string>();
  const exclusive=async(userId:string,reply:FastifyReply,job:()=>Promise<unknown>)=>{
    if(runningJobs.has(userId))return reply.code(409).send({error:'BACKUP_IN_PROGRESS'});
    runningJobs.add(userId);
    try{return await job()}finally{runningJobs.delete(userId)}
  };
  app.get('/api/backup/exports',{preHandler:requireAuth},async request=>{
    const result=await pool.query(
      `SELECT id,created_at AS "createdAt",protected,size_bytes AS "sizeBytes",bucket_count AS "bucketCount",
              operation_count AS "operationCount",planned_expense_count AS "plannedExpenseCount",template_count AS "templateCount"
       FROM backup_exports WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 10`,
      [request.userId],
    );
    return {exports:result.rows};
  });

  app.get('/api/backup/export',{preHandler:requireAuth,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>exclusive(request.userId,reply,async()=>{
    const query=exportQuery.parse(request.query??{});
    const client=await pool.connect();
    const {buckets,operations,templates,plannedExpenses,plannedExpenseOccurrences,plannedExpensePayments,plannedExpenseEstimatedTotalVisibility,settings}=await readSnapshot(client,request.userId).finally(()=>client.release());
    const userSettings=settings.rows[0]??{
      currency:'EUR',locale:'it-IT',theme:'system',hideAmounts:false,
      quickAmountsCents:['5000','10000','15000','25000','45000'],updatedAt:new Date(),
    };
    const backup={
      format:'worth-split-backup',
      exportedAt:new Date().toISOString(),
      buckets:buckets.rows,
      operations:operations.rows,
      templates:templates.rows,
      plannedExpenses:plannedExpenses.rows,
      plannedExpenseOccurrences:plannedExpenseOccurrences.rows,
      plannedExpensePayments:plannedExpensePayments.rows,
      plannedExpenseEstimatedTotalVisibility:plannedExpenseEstimatedTotalVisibility.rows,
      settings:userSettings,
    };
    // Serialized once: the same text is measured for the log and sent.
    const body=JSON.stringify(backup);
    // Keep only the most recent entries; the new row is not visible to the
    // DELETE's snapshot, so the older ones are capped at LIMIT-1.
    await pool.query(
      `WITH inserted AS (
         INSERT INTO backup_exports(user_id,protected,size_bytes,bucket_count,operation_count,planned_expense_count,template_count)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id
       )
       DELETE FROM backup_exports WHERE user_id=$1
         AND id NOT IN (SELECT id FROM inserted)
         AND id NOT IN (SELECT id FROM backup_exports WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $8)`,
      [request.userId,query.protected==='true',Buffer.byteLength(body),
        buckets.rows.filter(row=>!row.archivedAt).length,operations.rows.length,
        plannedExpenses.rows.filter(row=>!row.archivedAt).length,templates.rows.length,EXPORT_HISTORY_LIMIT-1],
    );
    return reply.type('application/json; charset=utf-8').send(body);
  }));

  app.post('/api/backup/validate',{preHandler:requireAuth,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request=>{
    const backup=parseBackup(request.body);
    return {valid:true,summary:summarizeBackup(backup)};
  });

  app.post('/api/backup/reset',{preHandler:requireAuth,config:{rateLimit:{max:3,timeWindow:'1 minute'}}},async(request,reply)=>{
    const input=resetSchema.parse(request.body);
    return exclusive(request.userId,reply,async()=>{
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await resetUserData(client,request.userId,input.mode);
        await client.query('COMMIT');
        return reply.code(204).send();
      }catch(error){
        await client.query('ROLLBACK');
        throw error;
      }finally{client.release()}
    });
  });

  // Import is replace-all and transactional. Credentials and sessions remain intact.
  app.post('/api/backup/import',{preHandler:requireAuth,config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(request,reply)=>{
    const backup=parseBackup(request.body);
    return exclusive(request.userId,reply,async()=>{
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        // Ledger operations of the same user wait until the replacement is done.
        await client.query('SELECT id FROM buckets WHERE user_id=$1 FOR UPDATE',[request.userId]);
        await client.query('DELETE FROM planned_expense_payments WHERE user_id=$1',[request.userId]);
        await client.query('DELETE FROM planned_expense_occurrences WHERE user_id=$1',[request.userId]);
        await client.query('DELETE FROM planned_expenses WHERE user_id=$1',[request.userId]);
        await client.query('DELETE FROM templates WHERE user_id=$1',[request.userId]);
        await client.query('DELETE FROM operations WHERE user_id=$1',[request.userId]);
        await client.query('DELETE FROM buckets WHERE user_id=$1',[request.userId]);

        // Rows are inserted per table in one statement each: a 2 MiB backup no
        // longer turns into thousands of round trips holding a shared connection.
        // New ids are generated here, so references are remapped before insert
        // and no id from the file ever reaches the database.
        const bucketIds=new Map(backup.buckets.map(bucket=>[bucket.legacyId,randomUUID()]));
        const operationIds=new Map(backup.operations.map(operation=>[operation.legacyId,randomUUID()]));
        const plannedExpenseIds=new Map(backup.plannedExpenses.map(expense=>[expense.legacyId,randomUUID()]));
        const occurrenceIds=new Map(backup.plannedExpenseOccurrences.map(occurrence=>[occurrence.legacyId,randomUUID()]));
        const userId=request.userId;

        await insertRows(client,`INSERT INTO buckets(id,user_id,name,description,type,balance_cents,currency,icon,color,monthly_target_cents,
             sort_order,include_in_total,archived_at,created_at,updated_at)
           SELECT id,user_id,name,description,type,balance_cents,currency,icon,color,monthly_target_cents,
             sort_order,include_in_total,archived_at,created_at,updated_at
           FROM jsonb_populate_recordset(NULL::buckets,$1::jsonb)`,
          backup.buckets.map(bucket=>({id:bucketIds.get(bucket.legacyId),user_id:userId,name:bucket.name,description:bucket.description,
            type:bucket.type,balance_cents:bucket.balanceCents,currency:bucket.currency,icon:bucket.icon,color:bucket.color,
            monthly_target_cents:bucket.monthlyTargetCents,sort_order:bucket.sortOrder,include_in_total:bucket.includeInTotal,
            archived_at:bucket.archivedAt,created_at:bucket.createdAt,updated_at:bucket.updatedAt})));

        await insertRows(client,`INSERT INTO operations(id,user_id,kind,note,idempotency_key,occurred_at,created_at)
           SELECT id,user_id,kind,note,idempotency_key,occurred_at,created_at
           FROM jsonb_populate_recordset(NULL::operations,$1::jsonb)`,
          backup.operations.map(operation=>({id:operationIds.get(operation.legacyId),user_id:userId,kind:operation.kind,note:operation.note,
            idempotency_key:operation.idempotencyKey,occurred_at:operation.occurredAt,created_at:operation.createdAt})));

        await insertRows(client,`INSERT INTO operation_entries(operation_id,bucket_id,amount_cents,balance_after_cents)
           SELECT operation_id,bucket_id,amount_cents,balance_after_cents
           FROM jsonb_populate_recordset(NULL::operation_entries,$1::jsonb)`,
          backup.operations.flatMap(operation=>operation.entries.map(entry=>({operation_id:operationIds.get(operation.legacyId),
            bucket_id:bucketIds.get(entry.bucketLegacyId),amount_cents:entry.amountCents,balance_after_cents:entry.balanceAfterCents}))));

        const templateIds=backup.templates.map(()=>randomUUID());
        await insertRows(client,`INSERT INTO templates(id,user_id,name,allocation_mode,created_at,updated_at)
           SELECT id,user_id,name,allocation_mode,created_at,updated_at
           FROM jsonb_populate_recordset(NULL::templates,$1::jsonb)`,
          backup.templates.map((template,index)=>({id:templateIds[index],user_id:userId,name:template.name,allocation_mode:template.mode,
            created_at:template.createdAt,updated_at:template.updatedAt})));

        await insertRows(client,`INSERT INTO template_items(template_id,bucket_id,amount_cents,percentage_basis_points,sort_order)
           SELECT template_id,bucket_id,amount_cents,percentage_basis_points,sort_order
           FROM jsonb_populate_recordset(NULL::template_items,$1::jsonb)`,
          backup.templates.flatMap((template,index)=>template.items.map(item=>({template_id:templateIds[index],
            bucket_id:bucketIds.get(item.bucketLegacyId),amount_cents:item.amountCents??null,
            percentage_basis_points:item.percentageBasisPoints??null,sort_order:item.sortOrder}))));

        await insertRows(client,`INSERT INTO planned_expenses(id,user_id,bucket_id,name,description,category,amount_cents,amount_mode,frequency,
             due_rule,due_day,due_date,start_month,duration_months,archived_at,created_at,updated_at)
           SELECT id,user_id,bucket_id,name,description,category,amount_cents,amount_mode,frequency,
             due_rule,due_day,due_date,start_month,duration_months,archived_at,created_at,updated_at
           FROM jsonb_populate_recordset(NULL::planned_expenses,$1::jsonb)`,
          backup.plannedExpenses.map(expense=>({id:plannedExpenseIds.get(expense.legacyId),user_id:userId,
            bucket_id:bucketIds.get(expense.bucketLegacyId),name:expense.name,description:expense.description,category:expense.category,
            amount_cents:expense.amountCents,amount_mode:expense.amountMode,frequency:expense.frequency,due_rule:expense.dueRule,
            due_day:expense.dueDay,due_date:expense.dueDate,start_month:expense.startMonth,duration_months:expense.durationMonths,
            archived_at:expense.archivedAt,created_at:expense.createdAt,updated_at:expense.updatedAt})));

        await insertRows(client,`INSERT INTO planned_expense_occurrences(id,planned_expense_id,user_id,period,amount_cents,due_date,status,
             completed_at,created_at,updated_at)
           SELECT id,planned_expense_id,user_id,period,amount_cents,due_date,status,completed_at,created_at,updated_at
           FROM jsonb_populate_recordset(NULL::planned_expense_occurrences,$1::jsonb)`,
          backup.plannedExpenseOccurrences.map(occurrence=>({id:occurrenceIds.get(occurrence.legacyId),
            planned_expense_id:plannedExpenseIds.get(occurrence.plannedExpenseLegacyId),user_id:userId,period:occurrence.period,
            amount_cents:occurrence.amountCents,due_date:occurrence.dueDate,status:occurrence.status,completed_at:occurrence.completedAt,
            created_at:occurrence.createdAt,updated_at:occurrence.updatedAt})));

        await insertRows(client,`INSERT INTO planned_expense_payments(occurrence_id,user_id,operation_id,amount_cents,note,idempotency_key,created_at)
           SELECT occurrence_id,user_id,operation_id,amount_cents,note,idempotency_key,created_at
           FROM jsonb_populate_recordset(NULL::planned_expense_payments,$1::jsonb)`,
          backup.plannedExpensePayments.map(payment=>({occurrence_id:occurrenceIds.get(payment.occurrenceLegacyId),user_id:userId,
            operation_id:operationIds.get(payment.operationLegacyId),amount_cents:payment.amountCents,note:payment.note,
            idempotency_key:payment.idempotencyKey,created_at:payment.createdAt})));

        await insertRows(client,`INSERT INTO planned_expense_estimated_total_visibility(planned_expense_id,user_id,effective_month,
             included_in_estimated_total,created_at,updated_at)
           SELECT planned_expense_id,user_id,effective_month,included_in_estimated_total,created_at,updated_at
           FROM jsonb_populate_recordset(NULL::planned_expense_estimated_total_visibility,$1::jsonb)`,
          backup.plannedExpenseEstimatedTotalVisibility.map(visibility=>({
            planned_expense_id:plannedExpenseIds.get(visibility.plannedExpenseLegacyId),user_id:userId,
            effective_month:visibility.effectiveMonth,included_in_estimated_total:visibility.includedInEstimatedTotal,
            created_at:visibility.createdAt,updated_at:visibility.updatedAt})));

        const settings=backup.settings;
        await client.query(
          `INSERT INTO user_settings(user_id,currency,locale,theme,hide_amounts,quick_amounts_cents,updated_at)
           VALUES($1,$2,$3,$4,$5,$6::bigint[],$7)
           ON CONFLICT(user_id) DO UPDATE SET currency=EXCLUDED.currency,locale=EXCLUDED.locale,theme=EXCLUDED.theme,
             hide_amounts=EXCLUDED.hide_amounts,quick_amounts_cents=EXCLUDED.quick_amounts_cents,updated_at=EXCLUDED.updated_at`,
          [request.userId,settings.currency,settings.locale,settings.theme,settings.hideAmounts,settings.quickAmountsCents,settings.updatedAt],
        );

        await client.query('COMMIT');
        return reply.code(204).send();
      }catch(error){
        await client.query('ROLLBACK');
        throw error;
      }finally{client.release()}
    });
  });
}
