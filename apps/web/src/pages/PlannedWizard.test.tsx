// @vitest-environment jsdom

import { cleanup,fireEvent,screen,waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Dashboard } from '../types';
import { renderPage } from '../test/renderPage';
import { PlannedWizard } from './PlannedWizard';

const bucketId='00000000-0000-4000-8000-000000000001';
const dashboard:Dashboard={totalCents:'0',monthlyChangeCents:'0',buckets:[
  {id:bucketId,name:'Spese correnti',type:'spending',balanceCents:'0',monthlyChangeCents:'0',currency:'EUR',icon:'wallet',color:'#3B82F6',monthlyTargetCents:null,sortOrder:0,includeInTotal:true},
]};

const {apiMock}=vi.hoisted(()=>({apiMock:vi.fn()}));
vi.mock('../lib/api',()=>({api:apiMock}));

describe('PlannedWizard',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    apiMock.mockImplementation((path:string)=>path==='/dashboard'?Promise.resolve(dashboard):Promise.resolve({id:'new'}));
  });

  afterEach(cleanup);

  it('creates an estimated bimonthly expense in three steps',async()=>{
    renderPage({path:'/previsioni/nuova?mese=2026-11',routes:{'/previsioni/nuova':<PlannedWizard/>,'/previsioni':<p>Elenco</p>}});

    fireEvent.click(await screen.findByRole('button',{name:'Continua'}));
    expect(screen.getByText('Inserisci un nome per la spesa.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Nome della spesa'),{target:{value:'Bolletta gas'}});
    fireEvent.click(screen.getByRole('button',{name:'Continua'}));

    expect(screen.getByRole('heading',{name:'Quanto e ogni quanto?'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Stimato'}));
    fireEvent.change(screen.getByLabelText('Importo stimato'),{target:{value:'60'}});
    fireEvent.click(screen.getByRole('button',{name:/Bimestrale/}));
    fireEvent.click(screen.getByRole('button',{name:/Scadenza/}));
    fireEvent.click(screen.getByRole('button',{name:/Data precisa/}));
    fireEvent.change(screen.getByLabelText('Giorno del mese'),{target:{value:'16'}});
    fireEvent.click(screen.getByRole('button',{name:'Fatto'}));
    fireEvent.click(screen.getByRole('button',{name:'Continua'}));

    fireEvent.click(screen.getByRole('button',{name:'Crea spesa'}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/planned-expenses',{method:'POST',body:JSON.stringify({
      name:'Bolletta gas',description:null,category:'other',bucketId,amountCents:'6000',amountMode:'estimated',frequency:'bimonthly',dueRule:'exact',dueDay:16,dueDate:null,startMonth:'2026-11',durationMonths:null,
    })}));
    expect(await screen.findByText('Elenco')).toBeInTheDocument();
  });
});
