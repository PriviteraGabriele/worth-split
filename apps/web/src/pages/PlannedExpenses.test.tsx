// @vitest-environment jsdom

import { cleanup,fireEvent,screen,waitFor,within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Dashboard,PlannedExpensesResponse } from '../types';
import { renderPage } from '../test/renderPage';
import { PlannedExpenses } from './PlannedExpenses';
import { PlannedPayment } from './PlannedPayment';

const bucketId='00000000-0000-4000-8000-000000000001';
const plannedExpenseId='00000000-0000-4000-8000-000000000010';
const fuelId='00000000-0000-4000-8000-000000000014';
const dashboard:Dashboard={
  totalCents:'100000',monthlyChangeCents:'0',
  buckets:[{id:bucketId,name:'Conto spese',type:'spending',balanceCents:'100000',monthlyChangeCents:'0',currency:'EUR',icon:'wallet',color:'#FF826F',monthlyTargetCents:null,sortOrder:0,includeInTotal:true}],
};
const plannedExpenses:PlannedExpensesResponse={
  expenses:[
    {id:plannedExpenseId,name:'Palestra',description:null,category:'subscription',bucketId,bucketName:'Conto spese',bucketIcon:'wallet',bucketType:'spending',bucketColor:'#FF826F',amountCents:'4500',configuredAmountCents:'5000',amountMode:'fixed',frequency:'monthly',dueRule:'exact',dueDay:5,dueDate:null,startMonth:'2026-01',durationMonths:null,archivedAt:null,includedInEstimatedTotal:true,period:'2026-08',status:'open',actualAmountCents:'0',paymentCount:0,completedAt:null},
    {id:fuelId,name:'Carburante',description:null,category:'other',bucketId,bucketName:'Conto spese',bucketIcon:'wallet',bucketType:'spending',bucketColor:'#FF826F',amountCents:'10000',configuredAmountCents:'10000',amountMode:'estimated',frequency:'monthly',dueRule:'month',dueDay:null,dueDate:null,startMonth:'2026-01',durationMonths:null,archivedAt:null,includedInEstimatedTotal:true,period:'2026-08',status:'open',actualAmountCents:'0',paymentCount:0,completedAt:null},
    {id:'00000000-0000-4000-8000-000000000013',name:'Assicurazione auto',description:null,category:'other',bucketId,bucketName:'Conto spese',bucketIcon:'wallet',bucketType:'spending',bucketColor:'#FF826F',amountCents:'12000',configuredAmountCents:'12000',amountMode:'fixed',frequency:'monthly',dueRule:'end',dueDay:null,dueDate:null,startMonth:'2026-01',durationMonths:null,archivedAt:null,includedInEstimatedTotal:true,period:'2026-08',status:'open',actualAmountCents:'0',paymentCount:0,completedAt:null},
    {id:'00000000-0000-4000-8000-000000000011',name:'Streaming',description:null,category:'subscription',bucketId,bucketName:'Conto spese',bucketIcon:'wallet',bucketType:'spending',bucketColor:'#FF826F',amountCents:'999',configuredAmountCents:'999',amountMode:'estimated',frequency:'monthly',dueRule:'start',dueDay:null,dueDate:null,startMonth:'2026-01',durationMonths:null,archivedAt:null,includedInEstimatedTotal:true,period:'2026-08',status:'completed',actualAmountCents:'850',paymentCount:1,completedAt:'2026-08-03T12:00:00.000Z'},
  ],
  endedExpenses:[{id:'00000000-0000-4000-8000-000000000012',name:'Rata conclusa',description:null,category:'installment',bucketId,bucketName:'Conto spese',bucketIcon:'wallet',bucketType:'spending',bucketColor:'#FF826F',amountCents:'12000',configuredAmountCents:'12000',amountMode:'fixed',frequency:'monthly',dueRule:'end',dueDay:null,dueDate:null,startMonth:'2025-01',durationMonths:12,archivedAt:null,includedInEstimatedTotal:true,endedReason:'expired'}],
};

const {apiMock,newKeyMock}=vi.hoisted(()=>({apiMock:vi.fn(),newKeyMock:vi.fn(()=> '00000000-0000-4000-8000-000000000099')}));
vi.mock('../lib/api',()=>({api:apiMock,newKey:newKeyMock}));

function withExpenses(response:PlannedExpensesResponse,extra?:(path:string,init?:RequestInit)=>unknown){
  apiMock.mockImplementation((path:string,init?:RequestInit)=>{
    if(path.startsWith('/planned-expenses?'))return Promise.resolve(response);
    if(path==='/dashboard')return Promise.resolve(dashboard);
    const result=extra?.(path,init);
    if(result!==undefined)return Promise.resolve(result);
    throw new Error(`Unexpected API request: ${path}`);
  });
}
function renderPlanned(path='/previsioni'){
  return renderPage({path,routes:{'/previsioni':<PlannedExpenses/>,'/previsioni/:id/pagamento':<PlannedPayment/>}});
}
function patch(name:string,changes:Partial<PlannedExpensesResponse['expenses'][number]>):PlannedExpensesResponse{
  return {...plannedExpenses,expenses:plannedExpenses.expenses.map(expense=>expense.name===name?{...expense,...changes}:expense)};
}

describe('PlannedExpenses',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    newKeyMock.mockClear();
    withExpenses(plannedExpenses,(path,init)=>{
      if(path===`/planned-expenses/${plannedExpenseId}/payments`&&init?.method==='POST')return {operationId:'operation-1',paymentId:'payment-1'};
      if(path===`/planned-expenses/${plannedExpenseId}/estimated-total-visibility`&&init?.method==='POST')return {includedInEstimatedTotal:true};
      return undefined;
    });
  });

  afterEach(cleanup);

  it('lists open expenses by residual, keeps paid ones apart and hides ended plans',async()=>{
    renderPlanned();

    const summary=await screen.findByLabelText('Riepilogo del mese');
    expect(summary).toHaveTextContent('€265,00');
    expect(summary).toHaveTextContent('3 spese da pagare');
    expect(screen.getAllByRole('heading',{level:3}).map(heading=>heading.textContent)).toEqual(['Assicurazione auto','Carburante','Palestra']);
    expect(screen.queryByText('Rata conclusa')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'Pagate 1'}));
    const streaming=screen.getByText('Streaming').closest('article');
    expect(within(streaming!).getByText('€8,50')).toBeInTheDocument();
    expect(screen.queryByText('wallet')).not.toBeInTheDocument();
  });

  it('shows details and records a fixed payment as complete from the payment screen',async()=>{
    renderPlanned();

    fireEvent.click(await screen.findByRole('button',{name:'Dettagli Palestra'}));
    expect(await screen.findByText('Movimenti storici')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Chiudi'}));

    fireEvent.click(screen.getByRole('link',{name:'Salda Palestra'}));
    expect(await screen.findByLabelText('Importo da addebitare')).toHaveValue('45');
    fireEvent.click(screen.getByRole('button',{name:'Salda €45,00'}));

    await waitFor(()=>{
      const call=apiMock.mock.calls.find(call=>call[0]===`/planned-expenses/${plannedExpenseId}/payments`);
      expect(call).toBeDefined();
      const body=JSON.parse(String((call?.[1] as RequestInit|undefined)?.body));
      expect(body).toMatchObject({amountCents:'4500',complete:true,idempotencyKey:'00000000-0000-4000-8000-000000000099'});
      expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    });
    expect(await screen.findByLabelText('Riepilogo del mese')).toBeInTheDocument();
  });

  it('leaves the estimated payment amount blank',async()=>{
    renderPlanned();

    fireEvent.click(await screen.findByRole('link',{name:'Registra importo reale per Carburante'}));

    expect(await screen.findByLabelText('Importo reale')).toHaveValue('');
    expect(screen.queryByRole('button',{name:'Chiudi senza nuovo addebito'})).not.toBeInTheDocument();
  });

  it('closes an estimate without a new charge and refreshes the home dashboard',async()=>{
    withExpenses(patch('Carburante',{actualAmountCents:'12000',paymentCount:1}),(path,init)=>path===`/planned-expenses/${fuelId}/complete`&&init?.method==='POST'?{status:'completed'}:undefined);
    const {client}=renderPlanned(`/previsioni/${fuelId}/pagamento`);
    client.setQueryData(['dashboard'],dashboard);

    fireEvent.click(await screen.findByRole('button',{name:'Chiudi senza nuovo addebito'}));

    await waitFor(()=>expect(client.getQueryState(['dashboard'])?.isInvalidated).toBe(true));
  });

  it('updates the fixed payment CTA with the typed or keyed amount',async()=>{
    renderPlanned(`/previsioni/${plannedExpenseId}/pagamento`);

    const amount=await screen.findByLabelText('Importo da addebitare');
    fireEvent.change(amount,{target:{value:'30'}});
    expect(screen.getByRole('button',{name:'Salda €30,00'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'5'}));
    fireEvent.click(screen.getByRole('button',{name:'Cancella'}));
    fireEvent.click(screen.getByRole('button',{name:'Salda €30,00'}));

    await waitFor(()=>{
      const call=apiMock.mock.calls.find(call=>call[0]===`/planned-expenses/${plannedExpenseId}/payments`);
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({amountCents:'3000',complete:true});
    });
  });

  it('keeps the fixed payment CTA generic and validates an invalid amount',async()=>{
    renderPlanned(`/previsioni/${plannedExpenseId}/pagamento`);

    fireEvent.change(await screen.findByLabelText('Importo da addebitare'),{target:{value:'0'}});
    fireEvent.click(screen.getByRole('button',{name:'Salda'}));

    expect(await screen.findByText('L’importo deve essere maggiore di zero.')).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(`/planned-expenses/${plannedExpenseId}/payments`,expect.anything());
  });

  it('moves between months and back to the current one',async()=>{
    renderPlanned();

    fireEvent.click(await screen.findByRole('button',{name:'Mese successivo'}));
    const today=await screen.findByRole('button',{name:'Oggi'});
    fireEvent.click(today);
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Oggi'})).not.toBeInTheDocument());
  });

  it('opens separate bucket details for pending and registered totals',async()=>{
    renderPlanned();

    fireEvent.click(await screen.findByRole('button',{name:/^Da pagare/}));
    expect(await screen.findByRole('heading',{name:'Da pagare per bucket'})).toBeInTheDocument();
    const pendingDialog=screen.getByRole('dialog');
    expect(within(pendingDialog).getByText('Conto spese')).toBeInTheDocument();
    expect(within(pendingDialog).getByText('Palestra')).toBeInTheDocument();
    expect(within(pendingDialog).getByText('Totale ancora da pagare')).toBeInTheDocument();
    expect(within(pendingDialog).getByLabelText('Riepilogo totale')).toHaveTextContent('3 spese');
    expect(within(pendingDialog).getByLabelText('Riepilogo totale')).toHaveTextContent('1 bucket');
    fireEvent.click(screen.getByRole('button',{name:'Chiudi'}));

    fireEvent.click(screen.getByRole('button',{name:/^Registrato/}));
    expect(await screen.findByRole('heading',{name:'Già registrato per bucket'})).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Streaming')).toBeInTheDocument();
  });

  it('excludes hidden expenses from the pending total and its breakdown',async()=>{
    withExpenses({...plannedExpenses,expenses:plannedExpenses.expenses.map(expense=>expense.id===plannedExpenseId?{...expense,includedInEstimatedTotal:false}:expense)});
    renderPlanned();

    fireEvent.click(await screen.findByRole('button',{name:/^Da pagare/}));
    const dialog=screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Riepilogo totale')).toHaveTextContent('€220,00');
    expect(within(dialog).queryByText('Palestra')).not.toBeInTheDocument();
  });

  it('subtracts recorded estimated payments from the amount still due',async()=>{
    withExpenses(patch('Carburante',{actualAmountCents:'7500',paymentCount:1}));
    renderPlanned();

    expect(await screen.findByLabelText('Riepilogo del mese')).toHaveTextContent('€190,00');
    const fuel=screen.getByText('Carburante').closest('article');
    expect(within(fuel!).getByLabelText(/€25,00 da pagare, €75,00 già registrati/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:/^Da pagare/}));
    expect(await screen.findByLabelText('Riepilogo totale')).toHaveTextContent('€190,00');
    expect(within(screen.getByRole('dialog')).getByText('€25,00')).toBeInTheDocument();
  });

  it('keeps an excluded expense visible and lets the user include it again',async()=>{
    withExpenses({...plannedExpenses,expenses:plannedExpenses.expenses.map(expense=>expense.id===plannedExpenseId?{...expense,includedInEstimatedTotal:false}:expense)},(path,init)=>path===`/planned-expenses/${plannedExpenseId}/estimated-total-visibility`&&init?.method==='POST'?{includedInEstimatedTotal:true}:undefined);
    renderPlanned();

    const excludedCard=(await screen.findByText('Palestra')).closest('article');
    expect(excludedCard).toHaveClass('is-excluded');
    expect(within(excludedCard!).queryByRole('link')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'Dettagli Palestra'}));
    expect(screen.getByText('La spesa è esclusa dal totale previsto. Per registrare un pagamento devi prima riattivarla.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Includi'}));

    await waitFor(()=>{
      const call=apiMock.mock.calls.find(call=>call[0]===`/planned-expenses/${plannedExpenseId}/estimated-total-visibility`);
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({includedInEstimatedTotal:true,scope:'from_month'});
    });
  });

  it('does not offer estimated-total visibility for an expense with payment records',async()=>{
    withExpenses({...plannedExpenses,expenses:plannedExpenses.expenses.map(expense=>expense.id===plannedExpenseId?{...expense,paymentCount:1}:expense)});
    renderPlanned();

    fireEvent.click(await screen.findByRole('button',{name:'Dettagli Palestra'}));
    expect(screen.queryByRole('button',{name:'Nascondi dal previsto'})).not.toBeInTheDocument();
  });
});
