import { z } from 'zod';
import { centsSchema,positiveCentsSchema,signedCentsSchema } from '../http/validation.js';

const timestamp=z.string().min(1).max(40).refine(value=>!Number.isNaN(Date.parse(value)),'Invalid timestamp');
const date=z.string().regex(/^(19|20|21)\d{2}-\d{2}-\d{2}$/).refine(value=>{
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
},'Invalid date');
const monthDate=z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])-01$/);
const uuid=z.string().uuid();
const cents=centsSchema;
const positiveCents=positiveCentsSchema;
const signedCents=signedCentsSchema;

const templateItemSchema=z.object({
  bucketLegacyId:uuid,
  amountCents:positiveCents.nullish(),
  percentageBasisPoints:z.number().int().min(1).max(10000).nullish(),
  sortOrder:z.number().int(),
});
const templateSchema=z.object({
  legacyId:uuid,
  name:z.string().min(1).max(60),
  mode:z.enum(['fixed','percentage']),
  items:z.array(templateItemSchema),
  createdAt:timestamp,
  updatedAt:timestamp,
}).superRefine((template,context)=>{
  const fixed=template.mode==='fixed';
  if(template.items.some(item=>fixed?!item.amountCents||item.percentageBasisPoints!=null:!item.percentageBasisPoints||item.amountCents!=null)){
    context.addIssue({code:'custom',message:'Invalid template items'});
  }
  if(!fixed&&template.items.reduce((sum,item)=>sum+(item.percentageBasisPoints??0),0)!==10000){
    context.addIssue({code:'custom',message:'Percentages must total 100%'});
  }
});

const bucketSchema=z.object({
  legacyId:uuid,
  name:z.string().min(1).max(60),
  description:z.string().max(300).nullable(),
  type:z.enum(['spending','saving','investment','other']),
  balanceCents:cents,
  currency:z.literal('EUR'),
  icon:z.string().min(1).max(30),
  color:z.string().regex(/^#[0-9a-fA-F]{6}$/),
  monthlyTargetCents:cents.nullable(),
  sortOrder:z.number().int(),
  includeInTotal:z.boolean(),
  archivedAt:timestamp.nullable(),
  createdAt:timestamp,
  updatedAt:timestamp,
});

const operationSchema=z.object({
  legacyId:uuid,
  kind:z.enum(['adjustment','transfer','distribution','rebalance']),
  note:z.string().max(300).nullable(),
  idempotencyKey:uuid.nullable(),
  occurredAt:timestamp,
  createdAt:timestamp,
  entries:z.array(z.object({
    bucketLegacyId:uuid,
    amountCents:signedCents,
    balanceAfterCents:cents,
  })).min(1),
});

const settingsSchema=z.object({
  currency:z.literal('EUR'),
  locale:z.string().min(1).max(35),
  theme:z.enum(['light','dark','system']),
  hideAmounts:z.boolean(),
  quickAmountsCents:z.array(positiveCents).min(1).max(8),
  updatedAt:timestamp,
});

const plannedExpenseSchema=z.object({
  legacyId:uuid,
  bucketLegacyId:uuid,
  name:z.string().min(1).max(120),
  description:z.string().max(300).nullable().default(null),
  category:z.enum(['subscription','installment','one_time','other']).default('other'),
  amountCents:positiveCents,
  amountMode:z.enum(['fixed','estimated']),
  frequency:z.enum(['monthly','bimonthly','quarterly','semiannual','annual','once']),
  dueRule:z.enum(['month','exact','start','mid','end']).default('month'),
  dueDay:z.number().int().min(1).max(31).nullable(),
  dueDate:date.nullable(),
  startMonth:monthDate,
  durationMonths:z.number().int().positive().max(1200).nullable(),
  archivedAt:timestamp.nullable(),
  createdAt:timestamp,
  updatedAt:timestamp,
}).superRefine((expense,context)=>{
  if(expense.frequency!=='once'){
    if(expense.dueDate!==null)context.addIssue({code:'custom',message:'Monthly planned expenses cannot have an exact due date',path:['dueDate']});
    if(expense.dueRule==='exact'&&expense.dueDay===null)context.addIssue({code:'custom',message:'Monthly exact due dates require a day',path:['dueDay']});
    if(expense.dueRule!=='exact'&&expense.dueDay!==null)context.addIssue({code:'custom',message:'Approximate due dates cannot have a day',path:['dueDay']});
    if(expense.frequency!=='monthly'&&expense.durationMonths!==null)context.addIssue({code:'custom',message:'Only monthly planned expenses can have a duration',path:['durationMonths']});
    return;
  }
  if(expense.durationMonths!==null)context.addIssue({code:'custom',message:'One-time planned expenses cannot have a duration',path:['durationMonths']});
  if(expense.dueRule==='exact'&&expense.dueDate===null)context.addIssue({code:'custom',message:'One-time exact due dates require a date',path:['dueDate']});
  if(expense.dueRule==='exact'&&expense.dueDate!==null&&expense.dueDate.slice(0,7)!==expense.startMonth.slice(0,7)){
    context.addIssue({code:'custom',message:'One-time exact due date must fall in start month',path:['dueDate']});
  }
  if(expense.dueRule!=='exact'&&(expense.dueDay!==null||expense.dueDate!==null)){
    context.addIssue({code:'custom',message:'Approximate due dates cannot have exact date data'});
  }
  if(expense.dueDay!==null)context.addIssue({code:'custom',message:'One-time planned expenses cannot have a due day',path:['dueDay']});
});

const plannedExpenseOccurrenceSchema=z.object({
  legacyId:uuid,
  plannedExpenseLegacyId:uuid,
  period:monthDate,
  amountCents:positiveCents,
  dueDate:date,
  status:z.enum(['open','completed']),
  completedAt:timestamp.nullable(),
  createdAt:timestamp,
  updatedAt:timestamp,
}).superRefine((occurrence,context)=>{
  if(occurrence.status==='completed'&&occurrence.completedAt===null){
    context.addIssue({code:'custom',message:'Completed occurrences require a completion timestamp',path:['completedAt']});
  }
  if(occurrence.status==='open'&&occurrence.completedAt!==null){
    context.addIssue({code:'custom',message:'Open occurrences cannot have a completion timestamp',path:['completedAt']});
  }
});

const plannedExpensePaymentSchema=z.object({
  legacyId:uuid,
  occurrenceLegacyId:uuid,
  operationLegacyId:uuid,
  amountCents:signedCents,
  note:z.string().max(300).nullable(),
  idempotencyKey:uuid,
  createdAt:timestamp,
});

const plannedExpenseEstimatedTotalVisibilitySchema=z.object({
  legacyId:uuid,
  plannedExpenseLegacyId:uuid,
  effectiveMonth:monthDate,
  includedInEstimatedTotal:z.boolean(),
  createdAt:timestamp,
  updatedAt:timestamp,
});

const backupSchema=z.object({
  format:z.literal('worth-split-backup'),
  exportedAt:timestamp,
  buckets:z.array(bucketSchema),
  operations:z.array(operationSchema),
  templates:z.array(templateSchema),
  // These defaults keep backups created before planned expenses importable.
  plannedExpenses:z.array(plannedExpenseSchema).default([]),
  plannedExpenseOccurrences:z.array(plannedExpenseOccurrenceSchema).default([]),
  plannedExpensePayments:z.array(plannedExpensePaymentSchema).default([]),
  plannedExpenseEstimatedTotalVisibility:z.array(plannedExpenseEstimatedTotalVisibilitySchema).default([]),
  settings:settingsSchema,
}).superRefine((backup,context)=>{
  // Each legacy id names exactly one row: references could not be remapped otherwise.
  const unique=(collection:'buckets'|'operations'|'plannedExpenses'|'plannedExpenseOccurrences',items:Array<{legacyId:string}>)=>{
    const seen=new Set<string>();
    for(const [index,item] of items.entries()){
      if(seen.has(item.legacyId))context.addIssue({code:'custom',message:'Duplicate legacy id',path:[collection,index,'legacyId']});
      seen.add(item.legacyId);
    }
  };
  unique('buckets',backup.buckets);
  unique('operations',backup.operations);
  unique('plannedExpenses',backup.plannedExpenses);
  unique('plannedExpenseOccurrences',backup.plannedExpenseOccurrences);
  const bucketIds=new Set(backup.buckets.map(bucket=>bucket.legacyId));
  const operationIds=new Set(backup.operations.map(operation=>operation.legacyId));
  const plannedExpenseIds=new Set(backup.plannedExpenses.map(expense=>expense.legacyId));
  const occurrenceIds=new Set(backup.plannedExpenseOccurrences.map(occurrence=>occurrence.legacyId));
  for(const [operationIndex,operation] of backup.operations.entries()){
    for(const [entryIndex,entry] of operation.entries.entries()){
      if(!bucketIds.has(entry.bucketLegacyId))context.addIssue({code:'custom',message:'Operation references a missing bucket',path:['operations',operationIndex,'entries',entryIndex,'bucketLegacyId']});
    }
  }
  for(const [templateIndex,template] of backup.templates.entries()){
    for(const [itemIndex,item] of template.items.entries()){
      if(!bucketIds.has(item.bucketLegacyId))context.addIssue({code:'custom',message:'Template references a missing bucket',path:['templates',templateIndex,'items',itemIndex,'bucketLegacyId']});
    }
  }
  for(const [expenseIndex,expense] of backup.plannedExpenses.entries()){
    if(!bucketIds.has(expense.bucketLegacyId))context.addIssue({code:'custom',message:'Planned expense references a missing bucket',path:['plannedExpenses',expenseIndex,'bucketLegacyId']});
  }
  for(const [occurrenceIndex,occurrence] of backup.plannedExpenseOccurrences.entries()){
    if(!plannedExpenseIds.has(occurrence.plannedExpenseLegacyId)){
      context.addIssue({code:'custom',message:'Planned expense occurrence references a missing planned expense',path:['plannedExpenseOccurrences',occurrenceIndex,'plannedExpenseLegacyId']});
    }
  }
  for(const [paymentIndex,payment] of backup.plannedExpensePayments.entries()){
    if(!occurrenceIds.has(payment.occurrenceLegacyId)){
      context.addIssue({code:'custom',message:'Planned expense payment references a missing occurrence',path:['plannedExpensePayments',paymentIndex,'occurrenceLegacyId']});
    }
    if(!operationIds.has(payment.operationLegacyId)){
      context.addIssue({code:'custom',message:'Planned expense payment references a missing operation',path:['plannedExpensePayments',paymentIndex,'operationLegacyId']});
    }
  }
  for(const [visibilityIndex,visibility] of backup.plannedExpenseEstimatedTotalVisibility.entries()){
    if(!plannedExpenseIds.has(visibility.plannedExpenseLegacyId)){
      context.addIssue({code:'custom',message:'Planned expense visibility references a missing planned expense',path:['plannedExpenseEstimatedTotalVisibility',visibilityIndex,'plannedExpenseLegacyId']});
    }
  }
});

export type Backup=z.infer<typeof backupSchema>;

export function parseBackup(value:unknown):Backup{return backupSchema.parse(value)}

export function summarizeBackup(backup:Backup){
  return {
    buckets:backup.buckets.length,
    archivedBuckets:backup.buckets.filter(bucket=>bucket.archivedAt!==null).length,
    operations:backup.operations.length,
    templates:backup.templates.length,
    plannedExpenses:backup.plannedExpenses.length,
    plannedExpenseOccurrences:backup.plannedExpenseOccurrences.length,
    plannedExpensePayments:backup.plannedExpensePayments.length,
    exportedAt:backup.exportedAt,
  };
}
