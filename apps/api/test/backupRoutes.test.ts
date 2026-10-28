import Fastify from 'fastify';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { parseBackup } from '../src/services/backupFormat.js';

const {queryMock,connectMock}=vi.hoisted(()=>({queryMock:vi.fn(),connectMock:vi.fn()}));
vi.mock('../src/db/pool.js',()=>({pool:{query:queryMock,connect:connectMock}}));
vi.mock('../src/auth.js',()=>({
  requireAuth:async(request:{userId:string})=>{request.userId='00000000-0000-4000-8000-000000000099'},
}));

import { registerBackupRoutes } from '../src/routes/backup.js';

describe('backup export route',()=>{
  let app=Fastify();

  beforeEach(async()=>{
    queryMock.mockReset();
    connectMock.mockReset();
    app=Fastify();
    registerBackupRoutes(app);
    await app.ready();
  });

  afterEach(async()=>{await app.close()});

  // The snapshot is read on one connection; pool.query only writes the export log.
  const snapshotClient=(results:Array<{rows:unknown[]}>)=>{
    const query=vi.fn<(sql:string,params?:unknown[])=>Promise<{rows:unknown[]}>>(async(sql)=>/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)?{rows:[]}:results.shift()??{rows:[]});
    const release=vi.fn();
    connectMock.mockResolvedValue({query,release});
    return {query,release};
  };

  it('exports the complete snapshot including archived buckets, planned expenses and settings',async()=>{
    const timestamp='2026-08-22T08:00:00.000Z';
    const client=snapshotClient([{rows:[{
        legacyId:'00000000-0000-4000-8000-000000000001',name:'Archivio',description:null,type:'saving',
        balanceCents:'0',currency:'EUR',icon:'piggy-bank',color:'#8B5CF6',monthlyTargetCents:null,sortOrder:0,
        includeInTotal:false,archivedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,
      }]},{rows:[{
        legacyId:'00000000-0000-4000-8000-000000000003',kind:'adjustment',note:'Rifornimento',idempotencyKey:null,
        occurredAt:timestamp,createdAt:timestamp,
        entries:[{bucketLegacyId:'00000000-0000-4000-8000-000000000001',amountCents:'-10300',balanceAfterCents:'0'}],
      }]},{rows:[]},{rows:[{
        legacyId:'00000000-0000-4000-8000-000000000005',bucketLegacyId:'00000000-0000-4000-8000-000000000001',
        name:'Carburante',amountCents:'10000',amountMode:'estimated',frequency:'monthly',dueRule:'end',dueDay:null,dueDate:null,
        startMonth:'2026-08-01',durationMonths:null,archivedAt:null,createdAt:timestamp,updatedAt:timestamp,
      }]},{rows:[{
        legacyId:'00000000-0000-4000-8000-000000000006',plannedExpenseLegacyId:'00000000-0000-4000-8000-000000000005',
        period:'2026-08-01',amountCents:'10000',dueDate:'2026-08-31',status:'completed',completedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,
      }]},{rows:[{
        legacyId:'00000000-0000-4000-8000-000000000007',occurrenceLegacyId:'00000000-0000-4000-8000-000000000006',
        operationLegacyId:'00000000-0000-4000-8000-000000000003',amountCents:'10300',note:'Rifornimento',
        idempotencyKey:'00000000-0000-4000-8000-000000000008',createdAt:timestamp,
      }]},{rows:[{
        legacyId:'00000000-0000-4000-8000-000000000009',plannedExpenseLegacyId:'00000000-0000-4000-8000-000000000005',
        effectiveMonth:'2026-08-01',includedInEstimatedTotal:false,createdAt:timestamp,updatedAt:timestamp,
      }]},{rows:[{
        currency:'EUR',locale:'it-IT',theme:'dark',hideAmounts:true,quickAmountsCents:['5000'],updatedAt:timestamp,
      }]}]);
    queryMock.mockResolvedValue({rows:[]});

    const response=await app.inject({method:'GET',url:'/api/backup/export'});
    const backup=parseBackup(response.json());

    expect(response.statusCode).toBe(200);
    expect(backup.format).toBe('worth-split-backup');
    expect(backup.buckets[0]?.archivedAt).toBe(timestamp);
    expect(backup.settings.hideAmounts).toBe(true);
    expect(backup.plannedExpenses[0]?.name).toBe('Carburante');
    expect(backup.plannedExpenseOccurrences[0]?.status).toBe('completed');
    expect(backup.plannedExpensePayments[0]?.operationLegacyId).toBe('00000000-0000-4000-8000-000000000003');
    expect(backup.plannedExpenseEstimatedTotalVisibility[0]?.includedInEstimatedTotal).toBe(false);
    expect(client.query.mock.calls[0]?.[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(String(client.query.mock.calls[1]?.[0])).not.toContain('archived_at IS NULL');
    expect(client.query.mock.calls.slice(1,9).every(([,params])=>JSON.stringify(params)==='["00000000-0000-4000-8000-000000000099"]')).toBe(true);
    expect(connectMock).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenCalledOnce();
    const log=queryMock.mock.calls[0];
    expect(String(log?.[0])).toContain('INSERT INTO backup_exports');
    expect(log?.[1]).toEqual(['00000000-0000-4000-8000-000000000099',false,Buffer.byteLength(response.body),0,1,1,0,19]);
  });

  it('marks password-protected exports in the export log',async()=>{
    snapshotClient([]);
    queryMock.mockResolvedValue({rows:[]});

    const response=await app.inject({method:'GET',url:'/api/backup/export?protected=true'});

    expect(response.statusCode).toBe(200);
    const log=queryMock.mock.calls.find(([sql])=>String(sql).includes('INSERT INTO backup_exports'));
    expect(log?.[1]?.[1]).toBe(true);
  });

  it('lists only the requester\'s recent exports',async()=>{
    const row={id:'00000000-0000-4000-8000-0000000000e1',createdAt:'2026-10-12T16:42:00.000Z',protected:true,sizeBytes:421000,bucketCount:7,operationCount:1284,plannedExpenseCount:6,templateCount:2};
    queryMock.mockResolvedValueOnce({rows:[row]});

    const response=await app.inject({method:'GET',url:'/api/backup/exports'});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({exports:[row]});
    expect(queryMock.mock.calls[0]?.[1]).toEqual(['00000000-0000-4000-8000-000000000099']);
    expect(String(queryMock.mock.calls[0]?.[0])).toContain('WHERE user_id=$1');
  });

  it('imports planned expenses after their buckets and operations, preserving all legacy links',async()=>{
    const timestamp='2026-08-22T08:00:00.000Z';
    const clientQuery=vi.fn<(...args:unknown[])=>Promise<{rows:unknown[];rowCount:number}>>(async()=>({rows:[],rowCount:0}));
    const release=vi.fn();
    connectMock.mockResolvedValue({query:clientQuery,release});

    const response=await app.inject({
      method:'POST',url:'/api/backup/import',body:{
        format:'worth-split-backup',exportedAt:timestamp,
        buckets:[{
          legacyId:'00000000-0000-4000-8000-000000000001',name:'Spese',description:null,type:'spending',balanceCents:'0',
          currency:'EUR',icon:'wallet',color:'#8B5CF6',monthlyTargetCents:null,sortOrder:0,includeInTotal:true,
          archivedAt:null,createdAt:timestamp,updatedAt:timestamp,
        }],
        operations:[{
          legacyId:'00000000-0000-4000-8000-000000000003',kind:'adjustment',note:'Rifornimento',idempotencyKey:null,
          occurredAt:timestamp,createdAt:timestamp,
          entries:[{bucketLegacyId:'00000000-0000-4000-8000-000000000001',amountCents:'-10300',balanceAfterCents:'0'}],
        }],
        templates:[],
        plannedExpenses:[{
          legacyId:'00000000-0000-4000-8000-000000000005',bucketLegacyId:'00000000-0000-4000-8000-000000000001',
          name:'Carburante',amountCents:'10000',amountMode:'estimated',frequency:'monthly',dueRule:'end',dueDay:null,dueDate:null,
          startMonth:'2026-08-01',durationMonths:null,archivedAt:null,createdAt:timestamp,updatedAt:timestamp,
        }],
        plannedExpenseOccurrences:[{
          legacyId:'00000000-0000-4000-8000-000000000006',plannedExpenseLegacyId:'00000000-0000-4000-8000-000000000005',
          period:'2026-08-01',amountCents:'10000',dueDate:'2026-08-31',status:'completed',completedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,
        }],
        plannedExpensePayments:[{
          legacyId:'00000000-0000-4000-8000-000000000007',occurrenceLegacyId:'00000000-0000-4000-8000-000000000006',
          operationLegacyId:'00000000-0000-4000-8000-000000000003',amountCents:'10300',note:'Rifornimento',
          idempotencyKey:'00000000-0000-4000-8000-000000000008',createdAt:timestamp,
        }],
        plannedExpenseEstimatedTotalVisibility:[{
          legacyId:'00000000-0000-4000-8000-000000000009',plannedExpenseLegacyId:'00000000-0000-4000-8000-000000000005',
          effectiveMonth:'2026-08-01',includedInEstimatedTotal:false,createdAt:timestamp,updatedAt:timestamp,
        }],
        settings:{currency:'EUR',locale:'it-IT',theme:'dark',hideAmounts:false,quickAmountsCents:['5000'],updatedAt:timestamp},
      },
    });

    const sqls=clientQuery.mock.calls.map(([sql])=>String(sql));
    const position=(fragment:string)=>sqls.findIndex(sql=>sql.includes(fragment));
    const rows=(table:string)=>JSON.parse(String((clientQuery.mock.calls.find(([sql])=>String(sql).includes(`INSERT INTO ${table}(`))?.[1] as unknown[]|undefined)?.[0])) as Array<Record<string,unknown>>;
    expect(response.statusCode).toBe(204);
    expect(position('FOR UPDATE')).toBeLessThan(position('DELETE FROM'));
    expect(position('DELETE FROM planned_expense_payments')).toBeLessThan(position('DELETE FROM operations'));
    expect(position('INSERT INTO buckets')).toBeLessThan(position('INSERT INTO planned_expenses'));
    expect(position('INSERT INTO operations')).toBeLessThan(position('INSERT INTO planned_expense_payments'));
    expect(position('INSERT INTO planned_expenses')).toBeLessThan(position('INSERT INTO planned_expense_occurrences'));
    expect(position('INSERT INTO planned_expense_occurrences')).toBeLessThan(position('INSERT INTO planned_expense_payments'));
    const [bucket]=rows('buckets');const [operation]=rows('operations');const [expense]=rows('planned_expenses');
    const [occurrence]=rows('planned_expense_occurrences');
    // Every reference points at a row created for the caller, never at an id from the file.
    expect(bucket?.id).not.toBe('00000000-0000-4000-8000-000000000001');
    expect(rows('operation_entries')).toEqual([{operation_id:operation?.id,bucket_id:bucket?.id,amount_cents:'-10300',balance_after_cents:'0'}]);
    expect(expense?.bucket_id).toBe(bucket?.id);
    expect(occurrence?.planned_expense_id).toBe(expense?.id);
    expect(rows('planned_expense_payments')).toEqual([{
      occurrence_id:occurrence?.id,user_id:'00000000-0000-4000-8000-000000000099',operation_id:operation?.id,amount_cents:'10300',
      note:'Rifornimento',idempotency_key:'00000000-0000-4000-8000-000000000008',created_at:timestamp,
    }]);
    expect(rows('planned_expense_estimated_total_visibility')).toEqual([{
      planned_expense_id:expense?.id,user_id:'00000000-0000-4000-8000-000000000099',effective_month:'2026-08-01',
      included_in_estimated_total:false,created_at:timestamp,updated_at:timestamp,
    }]);
    for(const table of ['buckets','operations','planned_expenses','planned_expense_occurrences'])expect(rows(table).every(row=>row.user_id==='00000000-0000-4000-8000-000000000099')).toBe(true);
    const legacyIds=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006'];
    expect(clientQuery.mock.calls.some(([,params])=>legacyIds.some(id=>JSON.stringify(params??null).includes(id)))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
  it('runs one statement per table however many records the backup holds',async()=>{
    const timestamp='2026-08-22T08:00:00.000Z';
    const clientQuery=vi.fn<(...args:unknown[])=>Promise<{rows:unknown[];rowCount:number}>>(async()=>({rows:[],rowCount:0}));
    connectMock.mockResolvedValue({query:clientQuery,release:vi.fn()});
    const bucket={legacyId:'00000000-0000-4000-8000-000000000001',name:'Spese',description:null,type:'spending',balanceCents:'0',
      currency:'EUR',icon:'wallet',color:'#8B5CF6',monthlyTargetCents:null,sortOrder:0,includeInTotal:true,archivedAt:null,createdAt:timestamp,updatedAt:timestamp};
    const operations=Array.from({length:500},(_,index)=>({legacyId:`00000000-0000-4000-8000-${String(index+100).padStart(12,'0')}`,
      kind:'adjustment',note:null,idempotencyKey:null,occurredAt:timestamp,createdAt:timestamp,
      entries:[{bucketLegacyId:bucket.legacyId,amountCents:'100',balanceAfterCents:'100'}]}));

    const response=await app.inject({method:'POST',url:'/api/backup/import',body:{
      format:'worth-split-backup',exportedAt:timestamp,buckets:[bucket],operations,templates:[],
      settings:{currency:'EUR',locale:'it-IT',theme:'dark',hideAmounts:false,quickAmountsCents:['5000'],updatedAt:timestamp},
    }});

    expect(response.statusCode).toBe(204);
    expect(clientQuery.mock.calls.length).toBeLessThan(20);
    expect(JSON.parse(String((clientQuery.mock.calls.find(([sql])=>String(sql).includes('INSERT INTO operation_entries('))?.[1] as unknown[]|undefined)?.[0]))).toHaveLength(500);
  });

  it('refuses a second backup job of the same user while one is running',async()=>{
    let finish:()=>void=()=>{};
    const query=vi.fn(async(sql:string)=>{
      if(sql.startsWith('BEGIN'))await new Promise<void>(resolve=>{finish=resolve});
      return {rows:[]};
    });
    connectMock.mockResolvedValue({query,release:vi.fn()});
    queryMock.mockResolvedValue({rows:[]});

    const first=app.inject({method:'GET',url:'/api/backup/export'});
    await vi.waitFor(()=>expect(query).toHaveBeenCalled());
    const second=await app.inject({method:'POST',url:'/api/backup/reset',payload:{mode:'partial',confirmation:'RESET_PARTIAL'}});
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({error:'BACKUP_IN_PROGRESS'});

    finish();
    expect((await first).statusCode).toBe(200);
    // The guard is released when the job ends, so the next one runs normally.
    const third=app.inject({method:'GET',url:'/api/backup/export'});
    await vi.waitFor(()=>expect(query.mock.calls.filter(([sql])=>sql.startsWith('BEGIN'))).toHaveLength(2));
    finish();
    expect((await third).statusCode).toBe(200);
  });
});
