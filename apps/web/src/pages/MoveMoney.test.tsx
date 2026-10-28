// @vitest-environment jsdom

import { cleanup,fireEvent,screen,waitFor,within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Bucket,Dashboard } from '../types';
import { renderPage } from '../test/renderPage';
import { MoveMoney } from './MoveMoney';

const buckets:Bucket[]=[
  {id:'00000000-0000-4000-8000-000000000001',name:'Risparmi',type:'saving',balanceCents:'10000',monthlyChangeCents:'0',currency:'EUR',icon:'piggy-bank',color:'#B49CFF',monthlyTargetCents:null,sortOrder:0,includeInTotal:true},
  {id:'00000000-0000-4000-8000-000000000002',name:'Spese',type:'spending',balanceCents:'5000',monthlyChangeCents:'0',currency:'EUR',icon:'wallet',color:'#FF826F',monthlyTargetCents:null,sortOrder:1,includeInTotal:true},
  {id:'00000000-0000-4000-8000-000000000003',name:'Fondo accantonamenti',type:'other',balanceCents:'2500',monthlyChangeCents:'0',currency:'EUR',icon:'layers',color:'#E6A44A',monthlyTargetCents:null,sortOrder:2,includeInTotal:true},
];
const dashboard:Dashboard={totalCents:'17500',monthlyChangeCents:'0',buckets};
const key='00000000-0000-4000-8000-000000000004';

const {apiMock}=vi.hoisted(()=>({apiMock:vi.fn()}));
vi.mock('../lib/api',()=>({api:apiMock,newKey:()=> '00000000-0000-4000-8000-000000000004'}));

function renderMove(mode:string){
  return renderPage({path:`/sposta/${mode}`,routes:{'/sposta/:mode':<MoveMoney/>,'/':<p>Home</p>}});
}

describe('MoveMoney',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    apiMock.mockImplementation((path:string)=>{
      if(path==='/dashboard')return Promise.resolve(dashboard);
      if(path==='/templates')return Promise.resolve({templates:[{id:'t1',name:'Stipendio',mode:'percentage',items:[{bucketId:buckets[0]!.id,amountCents:null,percentageBasisPoints:3333},{bucketId:buckets[1]!.id,amountCents:null,percentageBasisPoints:6667}]}]});
      return Promise.resolve({operationId:'00000000-0000-4000-8000-000000000005'});
    });
  });

  afterEach(cleanup);

  it('transfers with the keypad and the share shortcuts, then returns home',async()=>{
    renderMove('trasferisci');

    expect(await screen.findByRole('button',{name:'Da: Risparmi'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'25%'}));
    expect(screen.getByRole('button',{name:'Trasferisci €25,00'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Cancella'}));
    fireEvent.click(screen.getByRole('button',{name:'Inverti origine e destinazione'}));
    expect(screen.getByRole('button',{name:'Da: Spese'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Trasferisci €2,00'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/transfers',{method:'POST',body:JSON.stringify({fromBucketId:buckets[1]!.id,toBucketId:buckets[0]!.id,amountCents:'200',note:'',idempotencyKey:key})}));
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('refuses a transfer larger than the source balance',async()=>{
    renderMove('trasferisci');

    fireEvent.change(await screen.findByLabelText('Importo'),{target:{value:'150'}});
    fireEvent.click(screen.getByRole('button',{name:'Trasferisci €150,00'}));

    expect(await screen.findByText('L’importo supera il saldo del bucket di origine.')).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith('/transfers',expect.anything());
  });

  it('applies a percentage template so the entries add up to the total exactly',async()=>{
    renderMove('distribuisci');

    fireEvent.change(await screen.findByLabelText('Totale da distribuire'),{target:{value:'100'}});
    fireEvent.click(await screen.findByRole('button',{name:'Stipendio'}));
    expect(screen.getByLabelText('Percentuale per Risparmi')).toHaveValue('33,33');
    fireEvent.click(screen.getByRole('button',{name:'Distribuisci €100,00'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/distributions',{method:'POST',body:JSON.stringify({totalCents:'10000',entries:[{bucketId:buckets[0]!.id,amountCents:'3333'},{bucketId:buckets[1]!.id,amountCents:'6667'}],note:'Template: Stipendio',idempotencyKey:key})}));
  });

  it('keeps the distribution disabled until every euro is assigned',async()=>{
    renderMove('distribuisci');

    fireEvent.change(await screen.findByLabelText('Totale da distribuire'),{target:{value:'50'}});
    fireEvent.change(screen.getByLabelText('Importo per Spese'),{target:{value:'20'}});
    expect(screen.getByText(/Rimanente €30,00/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Distribuisci €50,00'})).toBeDisabled();
  });

  it('numbers selected buckets in click order and renumbers them after removal',async()=>{
    renderMove('ribilancia');

    fireEvent.click(await screen.findByRole('button',{name:'Seleziona Risparmi'}));
    fireEvent.click(screen.getByRole('button',{name:'Seleziona Spese'}));
    expect(screen.getByRole('button',{name:'Risparmi, ordine 1'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Spese, ordine 2'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'Risparmi, ordine 1'}));
    expect(screen.getByRole('button',{name:'Spese, ordine 1'})).toBeInTheDocument();
  });

  it('previews an ordered reduction, including buckets left unchanged',async()=>{
    renderMove('ribilancia');

    fireEvent.click(await screen.findByRole('button',{name:'Seleziona Spese'}));
    fireEvent.click(screen.getByRole('button',{name:'Seleziona Risparmi'}));
    fireEvent.change(screen.getByLabelText('Totale reale'),{target:{value:'120'}});

    expect(screen.getByText('Differenza −€30,00')).toBeInTheDocument();
    const preview=screen.getByLabelText('Anteprima ribilanciamento');
    expect(within(preview).getByText('Spese')).toBeInTheDocument();
    expect(within(preview).getByText('€50,00')).toBeInTheDocument();
    expect(within(preview).getByText('€20,00')).toBeInTheDocument();
    expect(within(preview).getByText('−€30,00')).toBeInTheDocument();
    expect(within(preview).queryByText('Risparmi')).not.toBeInTheDocument();
  });

  it('credits the first bucket and submits the real total in the chosen order',async()=>{
    renderMove('ribilancia');

    fireEvent.click(await screen.findByRole('button',{name:'Seleziona Spese'}));
    fireEvent.click(screen.getByRole('button',{name:'Seleziona Risparmi'}));
    fireEvent.change(screen.getByLabelText('Totale reale'),{target:{value:'200'}});
    expect(screen.getByText('Differenza +€50,00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Ribilancia'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/rebalances',{method:'POST',body:JSON.stringify({bucketIds:[buckets[1]!.id,buckets[0]!.id],targetTotalCents:'20000',idempotencyKey:key})}));
  });

  it('explains that an unchanged total cannot be rebalanced',async()=>{
    renderMove('ribilancia');

    fireEvent.click(await screen.findByRole('button',{name:'Seleziona Risparmi'}));
    fireEvent.change(screen.getByLabelText('Totale reale'),{target:{value:'100'}});

    expect(screen.getAllByText('Totale già allineato').length).toBeGreaterThan(0);
    expect(screen.getByRole('button',{name:'Totale già allineato'})).toBeDisabled();
  });
});
