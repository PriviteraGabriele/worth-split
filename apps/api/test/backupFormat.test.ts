import { describe,expect,it } from 'vitest';
import { parseBackup,summarizeBackup } from '../src/services/backupFormat.js';

const bucketId='00000000-0000-4000-8000-000000000001';
const otherBucketId='00000000-0000-4000-8000-000000000002';
const operationId='00000000-0000-4000-8000-000000000003';
const templateId='00000000-0000-4000-8000-000000000004';
const plannedExpenseId='00000000-0000-4000-8000-000000000005';
const occurrenceId='00000000-0000-4000-8000-000000000006';
const paymentId='00000000-0000-4000-8000-000000000007';
const paymentKey='00000000-0000-4000-8000-000000000008';
const timestamp='2026-08-22T08:00:00.000Z';

const bucket={
  legacyId:bucketId,
  name:'Risparmio',
  description:null,
  type:'saving' as const,
  balanceCents:'0',
  currency:'EUR' as const,
  icon:'piggy-bank',
  color:'#8B5CF6',
  monthlyTargetCents:null,
  sortOrder:0,
  includeInTotal:false,
  archivedAt:timestamp,
  createdAt:timestamp,
  updatedAt:timestamp,
};
const settings={
  currency:'EUR' as const,locale:'it-IT',theme:'dark' as const,hideAmounts:true,
  quickAmountsCents:['5000','10000'],updatedAt:timestamp,
};
const plannedExpense={
  legacyId:plannedExpenseId,
  bucketLegacyId:bucketId,
  name:'Carburante',
  amountCents:'10000',
  amountMode:'estimated' as const,
  frequency:'monthly' as const,
  dueRule:'end' as const,
  dueDay:null,
  dueDate:null,
  startMonth:'2026-08-01',
  durationMonths:null,
  archivedAt:null,
  createdAt:timestamp,
  updatedAt:timestamp,
};
const occurrence={
  legacyId:occurrenceId,
  plannedExpenseLegacyId:plannedExpenseId,
  period:'2026-08-01',
  amountCents:'10000',
  dueDate:'2026-08-31',
  status:'completed' as const,
  completedAt:timestamp,
  createdAt:timestamp,
  updatedAt:timestamp,
};
const payment={
  legacyId:paymentId,
  occurrenceLegacyId:occurrenceId,
  operationLegacyId:operationId,
  amountCents:'10300',
  note:'Rifornimento',
  idempotencyKey:paymentKey,
  createdAt:timestamp,
};

describe('complete backup format',()=>{
  it('captures archived buckets, templates, operations, planned expenses and settings',()=>{
    const backup=parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[{
        legacyId:operationId,
        kind:'adjustment',
        note:null,
        idempotencyKey:null,
        occurredAt:timestamp,
        createdAt:timestamp,
        entries:[{bucketLegacyId:bucketId,amountCents:'100',balanceAfterCents:'100'}],
      }],
      templates:[{
        legacyId:templateId,
        name:'Percentuali',
        mode:'percentage',
        createdAt:timestamp,
        updatedAt:timestamp,
        items:[{bucketLegacyId:bucketId,amountCents:null,percentageBasisPoints:10000,sortOrder:0}],
      }],
      plannedExpenses:[plannedExpense],
      plannedExpenseOccurrences:[occurrence],
      plannedExpensePayments:[payment],
      settings,
    });

    expect(backup.format).toBe('worth-split-backup');
    expect(backup.settings.hideAmounts).toBe(true);
    expect(summarizeBackup(backup)).toMatchObject({
      buckets:1,archivedBuckets:1,operations:1,templates:1,
      plannedExpenses:1,plannedExpenseOccurrences:1,plannedExpensePayments:1,
    });
  });

  it('includes rebalance operations and fixed templates in the same format',()=>{
    const backup=parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[{
        legacyId:operationId,
        kind:'rebalance',
        note:'Ribilanciamento',
        idempotencyKey:null,
        occurredAt:timestamp,
        createdAt:timestamp,
        entries:[{bucketLegacyId:bucketId,amountCents:'-100',balanceAfterCents:'0'}],
      }],
      templates:[{
        legacyId:templateId,
        name:'Mensile',
        mode:'fixed',
        createdAt:timestamp,
        updatedAt:timestamp,
        items:[{bucketLegacyId:bucketId,amountCents:'100',percentageBasisPoints:null,sortOrder:0}],
      }],
      settings,
    });

    expect(backup.operations[0]?.kind).toBe('rebalance');
    expect(backup.templates[0]?.mode).toBe('fixed');
    expect(backup.plannedExpenses).toEqual([]);
    expect(backup.plannedExpenseOccurrences).toEqual([]);
    expect(backup.plannedExpensePayments).toEqual([]);
  });

  it('accepts annual planned expenses for costs such as insurance',()=>{
    const backup=parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[],
      templates:[],
      plannedExpenses:[{...plannedExpense,name:'Assicurazione auto',frequency:'annual',dueRule:'exact',dueDay:15,startMonth:'2026-09-01'}],
      settings,
    });

    expect(backup.plannedExpenses[0]?.frequency).toBe('annual');
  });

  it('accepts recurring expenses at two-, three-, and six-month intervals',()=>{
    const backup=parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[],
      templates:[],
      plannedExpenses:[
        {...plannedExpense,name:'Bolletta',frequency:'bimonthly',startMonth:'2026-09-01'},
        {...plannedExpense,legacyId:'00000000-0000-4000-8000-000000000009',name:'Condominio',frequency:'quarterly',startMonth:'2026-09-01'},
        {...plannedExpense,legacyId:'00000000-0000-4000-8000-000000000010',name:'Assicurazione',frequency:'semiannual',startMonth:'2026-09-01'},
      ],
      settings,
    });

    expect(backup.plannedExpenses.map(expense=>expense.frequency)).toEqual(['bimonthly','quarterly','semiannual']);
  });

  it('uses empty planned-expense collections for legacy backups',()=>{
    const backup=parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[],
      operations:[],
      templates:[],
      settings,
    });

    expect(backup.plannedExpenses).toEqual([]);
    expect(backup.plannedExpenseOccurrences).toEqual([]);
    expect(backup.plannedExpensePayments).toEqual([]);
  });

  it('preserves signed corrective planned-expense payments',()=>{
    const backup=parseBackup({
      format:'worth-split-backup',exportedAt:timestamp,buckets:[bucket],
      operations:[{
        legacyId:operationId,kind:'adjustment',note:'Rettifica',idempotencyKey:paymentKey,occurredAt:timestamp,createdAt:timestamp,
        entries:[{bucketLegacyId:bucketId,amountCents:'300',balanceAfterCents:'300'}],
      }],templates:[],plannedExpenses:[plannedExpense],plannedExpenseOccurrences:[occurrence],
      plannedExpensePayments:[{...payment,amountCents:'-300'}],settings,
    });

    expect(backup.plannedExpensePayments[0]?.amountCents).toBe('-300');
  });

  it('rejects references to buckets that are not present in the backup',()=>{
    expect(()=>parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[{
        legacyId:operationId,
        kind:'transfer',
        note:null,
        idempotencyKey:null,
        occurredAt:timestamp,
        createdAt:timestamp,
        entries:[{bucketLegacyId:otherBucketId,amountCents:'100',balanceAfterCents:'100'}],
      }],
      templates:[],
      settings,
    })).toThrow(/Operation references a missing bucket/);
  });

  it('rejects planned-expense references that are not present in the backup',()=>{
    expect(()=>parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[],
      templates:[],
      plannedExpenses:[{...plannedExpense,bucketLegacyId:otherBucketId}],
      plannedExpenseOccurrences:[occurrence],
      plannedExpensePayments:[payment],
      settings,
    })).toThrow(/Planned expense references a missing bucket/);

    expect(()=>parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[],
      templates:[],
      plannedExpenses:[plannedExpense],
      plannedExpenseOccurrences:[{...occurrence,plannedExpenseLegacyId:templateId}],
      plannedExpensePayments:[],
      settings,
    })).toThrow(/Planned expense occurrence references a missing planned expense/);

    expect(()=>parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[{
        legacyId:operationId,kind:'adjustment',note:null,idempotencyKey:null,occurredAt:timestamp,createdAt:timestamp,
        entries:[{bucketLegacyId:bucketId,amountCents:'100',balanceAfterCents:'100'}],
      }],
      templates:[],
      plannedExpenses:[plannedExpense],
      plannedExpenseOccurrences:[],
      plannedExpensePayments:[payment],
      settings,
    })).toThrow(/Planned expense payment references a missing occurrence/);

    expect(()=>parseBackup({
      format:'worth-split-backup',
      exportedAt:timestamp,
      buckets:[bucket],
      operations:[],
      templates:[],
      plannedExpenses:[plannedExpense],
      plannedExpenseOccurrences:[occurrence],
      plannedExpensePayments:[payment],
      settings,
    })).toThrow(/Planned expense payment references a missing operation/);
  });

  it('rejects planned schedules that would violate database date constraints',()=>{
    expect(()=>parseBackup({
      format:'worth-split-backup',exportedAt:timestamp,buckets:[bucket],operations:[],templates:[],
      plannedExpenses:[{...plannedExpense,startMonth:'2026-08-02'}],
      plannedExpenseOccurrences:[],plannedExpensePayments:[],settings,
    })).toThrow();

    expect(()=>parseBackup({
      format:'worth-split-backup',exportedAt:timestamp,buckets:[bucket],operations:[],templates:[],
      plannedExpenses:[{
        ...plannedExpense,frequency:'once',dueRule:'exact',dueDay:null,dueDate:'2026-09-01',durationMonths:null,
      }],
      plannedExpenseOccurrences:[],plannedExpensePayments:[],settings,
    })).toThrow(/One-time exact due date must fall in start month/);
  });

  it('rejects values the database could not store before the import starts',()=>{
    const backupWith=(overrides:{bucket?:object;settings?:object;plannedExpense?:object})=>({
      format:'worth-split-backup',exportedAt:timestamp,
      buckets:[{...bucket,...overrides.bucket}],operations:[],templates:[],
      plannedExpenses:overrides.plannedExpense?[{...plannedExpense,...overrides.plannedExpense}]:[],
      settings:{...settings,...overrides.settings},
    });
    expect(()=>parseBackup(backupWith({}))).not.toThrow();
    expect(()=>parseBackup(backupWith({bucket:{balanceCents:'9'.repeat(20)}}))).toThrow();
    expect(()=>parseBackup(backupWith({bucket:{createdAt:'not a timestamp'}}))).toThrow(/Invalid timestamp/);
    expect(()=>parseBackup(backupWith({bucket:{description:'x'.repeat(301)}}))).toThrow();
    expect(()=>parseBackup(backupWith({settings:{quickAmountsCents:['1'.repeat(16)]}}))).toThrow();
    expect(()=>parseBackup(backupWith({plannedExpense:{startMonth:'0000-01-01'}}))).toThrow();
    expect(()=>parseBackup(backupWith({plannedExpense:{durationMonths:2_000_000_000}}))).toThrow();
  });

  it('rejects two records with the same legacy id',()=>{
    const backup={format:'worth-split-backup',exportedAt:timestamp,buckets:[bucket,{...bucket,name:'Copia'}],operations:[],templates:[],settings};
    expect(()=>parseBackup(backup)).toThrow(/Duplicate legacy id/);
  });
});
