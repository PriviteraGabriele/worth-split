// @vitest-environment jsdom

import { cleanup,fireEvent,screen,waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Dashboard } from '../types';
import { renderPage } from '../test/renderPage';
import { BucketDetail } from './BucketDetail';

const bucketId='00000000-0000-4000-8000-000000000001';
const dashboard:Dashboard={totalCents:'40000',monthlyChangeCents:'0',buckets:[
  {id:bucketId,name:'Spese correnti',type:'spending',balanceCents:'214000',monthlyChangeCents:'0',plannedExpenseCents:'83789',currency:'EUR',icon:'wallet',color:'#3B82F6',monthlyTargetCents:null,sortOrder:0,includeInTotal:true},
]};

const {apiMock}=vi.hoisted(()=>({apiMock:vi.fn()}));
vi.mock('../lib/api',()=>({api:apiMock,newKey:()=> '00000000-0000-4000-8000-000000000004'}));

function renderBucket(){
  return renderPage({path:`/bucket/${bucketId}`,routes:{'/bucket/:id':<BucketDetail/>,'/':<p>Home</p>}});
}

describe('BucketDetail',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    apiMock.mockImplementation((path:string)=>path==='/dashboard'?Promise.resolve(dashboard):Promise.resolve({operationId:'op'}));
  });

  afterEach(cleanup);

  it('shows the balance after the open planned expenses and adds money',async()=>{
    renderBucket();

    expect(await screen.findByText('Previste −837,89')).toBeInTheDocument();
    expect(screen.getByText('Dopo €1.302,11')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'2'}));
    fireEvent.click(screen.getByRole('button',{name:'5'}));
    fireEvent.click(screen.getByRole('button',{name:'0'}));
    expect(screen.getByText('€2.390,00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nota'),{target:{value:'Rimborso'}});
    fireEvent.click(screen.getByRole('button',{name:'Aggiungi €250,00'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(`/buckets/${bucketId}/adjust`,{method:'POST',body:JSON.stringify({mode:'add',amountCents:'25000',note:'Rimborso',idempotencyKey:'00000000-0000-4000-8000-000000000004'})}));
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('sets an exact balance through the server-side "set" mode',async()=>{
    renderBucket();

    fireEvent.click(await screen.findByRole('button',{name:'Imposta'}));
    fireEvent.change(screen.getByLabelText('Nuovo saldo'),{target:{value:'2000'}});
    fireEvent.click(screen.getByRole('button',{name:'Imposta €2.000,00'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(`/buckets/${bucketId}/adjust`,expect.objectContaining({body:expect.stringContaining('"mode":"set","amountCents":"200000"')})));
  });

  it('does not let a subtraction take the balance below zero',async()=>{
    renderBucket();

    fireEvent.click(await screen.findByRole('button',{name:'Sottrai'}));
    fireEvent.change(screen.getByLabelText('Importo'),{target:{value:'3000'}});
    fireEvent.click(screen.getByRole('button',{name:'Sottrai €3.000,00'}));

    expect(await screen.findByText('Il saldo non può diventare negativo.')).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(`/buckets/${bucketId}/adjust`,expect.anything());
  });

  it('excludes the bucket from the total from the actions sheet',async()=>{
    renderBucket();

    fireEvent.click(await screen.findByRole('button',{name:/Altre azioni/}));
    fireEvent.click(screen.getByRole('button',{name:/Escludi dal patrimonio/}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(`/buckets/${bucketId}/total-visibility`,{method:'PATCH',body:JSON.stringify({includeInTotal:false})}));
  });
});
