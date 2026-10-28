import Fastify from 'fastify';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ZodError } from 'zod';

const { clientQueryMock,connectMock,poolQueryMock,rebalanceEntriesMock,recordOperationMock }=vi.hoisted(()=>({
  clientQueryMock:vi.fn(),connectMock:vi.fn(),poolQueryMock:vi.fn(),rebalanceEntriesMock:vi.fn(),recordOperationMock:vi.fn(),
}));

vi.mock('../src/db/pool.js',()=>({pool:{connect:connectMock,query:poolQueryMock}}));
vi.mock('../src/auth.js',()=>({
  requireAuth:async(request:{userId:string})=>{request.userId='00000000-0000-4000-8000-000000000001';},
}));
vi.mock('../src/services/ledger.js',()=>({
  rebalanceEntries:rebalanceEntriesMock,recordOperation:recordOperationMock,transferEntries:vi.fn(),validateDistribution:vi.fn(),
}));

import { registerOperationRoutes } from '../src/routes/operations.js';

const userId='00000000-0000-4000-8000-000000000001';
const bucketId='00000000-0000-4000-8000-000000000002';
const secondBucketId='00000000-0000-4000-8000-000000000003';
const idempotencyKey='00000000-0000-4000-8000-000000000004';

async function testApp(){
  const app=Fastify();
  app.setErrorHandler((error,_request,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:'VALIDATION_ERROR'});
    return reply.code(500).send({error:'INTERNAL_ERROR'});
  });
  registerOperationRoutes(app);
  await app.ready();
  return app;
}

describe('rebalance route',()=>{
  beforeEach(()=>{
    clientQueryMock.mockReset();
    connectMock.mockReset();
    poolQueryMock.mockReset();
    rebalanceEntriesMock.mockReset();
    recordOperationMock.mockReset();
    connectMock.mockResolvedValue({query:clientQueryMock,release:vi.fn()});
  });

  it('includes bucket descriptions in the dashboard response',async()=>{
    const app=await testApp();
    poolQueryMock.mockResolvedValue({rows:[{
      id:bucketId,name:'Accantonamenti',description:'Assicurazione e bollo auto',type:'saving',
      balanceCents:'120000',currency:'EUR',icon:'piggy-bank',color:'#7c5ce0',monthlyTargetCents:null,
      sortOrder:0,includeInTotal:true,monthlyChangeCents:'0',plannedExpenseCents:'45000',
    }]});

    const response=await app.inject({method:'GET',url:'/api/dashboard'});

    expect(response.statusCode).toBe(200);
    expect(response.json().buckets[0].description).toBe('Assicurazione e bollo auto');
    expect(response.json().buckets[0].plannedExpenseCents).toBe('45000');
    expect(poolQueryMock.mock.calls[0]?.[0]).toContain('b.description');
    expect(poolQueryMock.mock.calls[0]?.[0]).toContain('planned_expense_payments');
    expect(poolQueryMock.mock.calls[0]?.[0]).toContain('GREATEST');
    expect(poolQueryMock.mock.calls[0]?.[0]).toContain("COALESCE(o.status,'open')='open'");
    await app.close();
  });

  it('accepts an ordered single-bucket payload without a priority field',async()=>{
    const app=await testApp();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:bucketId,balanceCents:'5000'}],rowCount:1})
      .mockResolvedValueOnce({rows:[]});
    rebalanceEntriesMock.mockReturnValue([{bucketId,amountCents:'-1000'}]);
    recordOperationMock.mockResolvedValue('00000000-0000-4000-8000-000000000005');

    const response=await app.inject({method:'POST',url:'/api/rebalances',payload:{bucketIds:[bucketId],targetTotalCents:'4000',idempotencyKey}});

    expect(response.statusCode).toBe(201);
    expect(rebalanceEntriesMock).toHaveBeenCalledWith([{id:bucketId,balanceCents:'5000'}],'4000');
    expect(recordOperationMock).toHaveBeenCalledWith(expect.anything(),userId,'rebalance',[{bucketId,amountCents:'-1000'}],'Ribilanciamento smart',idempotencyKey);
    await app.close();
  });

  it('records a positive entry when the real total is higher',async()=>{
    const app=await testApp();
    clientQueryMock
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:bucketId,balanceCents:'5000'}],rowCount:1})
      .mockResolvedValueOnce({rows:[]});
    rebalanceEntriesMock.mockReturnValue([{bucketId,amountCents:'1000'}]);
    recordOperationMock.mockResolvedValue('00000000-0000-4000-8000-000000000005');

    const response=await app.inject({method:'POST',url:'/api/rebalances',payload:{bucketIds:[bucketId],targetTotalCents:'6000',idempotencyKey}});

    expect(response.statusCode).toBe(201);
    expect(rebalanceEntriesMock).toHaveBeenCalledWith([{id:bucketId,balanceCents:'5000'}],'6000');
    expect(recordOperationMock).toHaveBeenCalledWith(expect.anything(),userId,'rebalance',[{bucketId,amountCents:'1000'}],'Ribilanciamento smart',idempotencyKey);
    await app.close();
  });

  it('rejects duplicate bucket ids before opening a database transaction',async()=>{
    const app=await testApp();
    const response=await app.inject({method:'POST',url:'/api/rebalances',payload:{bucketIds:[bucketId,bucketId],targetTotalCents:'4000',idempotencyKey}});

    expect(response.statusCode).toBe(400);
    expect(connectMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects buckets that are not active for the account',async()=>{
    const app=await testApp();
    clientQueryMock.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:bucketId,balanceCents:'5000'}],rowCount:1}).mockResolvedValueOnce({rows:[]});

    const response=await app.inject({method:'POST',url:'/api/rebalances',payload:{bucketIds:[bucketId,secondBucketId],targetTotalCents:'4000',idempotencyKey}});

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({error:'BUCKET_NOT_FOUND'});
    await app.close();
  });
});
