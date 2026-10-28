// @vitest-environment jsdom

import { cleanup,fireEvent,screen,waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Operation } from '../types';
import { renderPage } from '../test/renderPage';
import { History } from './History';

const {apiMock}=vi.hoisted(()=>({apiMock:vi.fn()}));
vi.mock('../lib/api',()=>({api:apiMock}));

class ImmediateIntersectionObserver {
  private connected=true;

  constructor(private readonly callback:IntersectionObserverCallback){}

  observe(){
    queueMicrotask(()=>{
      if(this.connected)this.callback([{isIntersecting:true} as IntersectionObserverEntry],this as unknown as IntersectionObserver);
    });
  }

  disconnect(){this.connected=false}
  unobserve(){}
  takeRecords(){return []}
}

const operations:Operation[]=[
  {id:'op-1',kind:'distribution',note:'Template: Stipendio',occurredAt:'2026-08-24T12:00:00.000Z',entries:[
    {bucketId:'bucket-1',bucketName:'Risparmi',bucketIcon:'',bucketType:'saving',amountCents:'75000',balanceAfterCents:'75000'},
    {bucketId:'bucket-2',bucketName:'Spese',bucketIcon:'',bucketType:'spending',amountCents:'15000',balanceAfterCents:'15000'},
  ]},
  {id:'op-2',kind:'transfer',note:'Weekend',occurredAt:'2026-08-20T12:00:00.000Z',entries:[
    {bucketId:'bucket-2',bucketName:'Spese',bucketIcon:'',bucketType:'spending',amountCents:'-5000',balanceAfterCents:'10000'},
    {bucketId:'bucket-1',bucketName:'Risparmi',bucketIcon:'',bucketType:'saving',amountCents:'5000',balanceAfterCents:'80000'},
  ]},
  {id:'op-3',kind:'adjustment',note:null,occurredAt:'2026-08-18T12:00:00.000Z',entries:[
    {bucketId:'bucket-2',bucketName:'Spese',bucketIcon:'',bucketType:'spending',amountCents:'-4500',balanceAfterCents:'5500'},
  ]},
];

function renderHistory(path='/storico'){return renderPage({path,routes:{'/storico':<History/>}})}

describe('History',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    vi.stubGlobal('IntersectionObserver',ImmediateIntersectionObserver);
  });

  afterEach(()=>{
    cleanup();
    vi.unstubAllGlobals();
  });

  it('stops automatic pagination after a failed next page and offers a manual retry',async()=>{
    let operationRequests=0;
    apiMock.mockImplementation((path:string)=>{
      if(path==='/dashboard')return Promise.resolve({totalCents:'0',monthlyChangeCents:'0',buckets:[]});
      if(path.startsWith('/operations?')){
        operationRequests+=1;
        if(operationRequests===1)return Promise.resolve({operations:[operations[2]],hasMore:true,availableYears:[2026]});
        return Promise.reject(new Error('NETWORK_ERROR'));
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderHistory();

    const retry=await screen.findByRole('button',{name:'Riprova a caricare'},{timeout:4000});
    expect(operationRequests).toBe(2);

    await new Promise(resolve=>setTimeout(resolve,25));
    expect(operationRequests).toBe(2);

    fireEvent.click(retry);
    await waitFor(()=>expect(operationRequests).toBe(3));
  });

  it('summarises each operation and filters them by kind and text',async()=>{
    apiMock.mockImplementation((path:string)=>{
      if(path==='/dashboard')return Promise.resolve({totalCents:'0',monthlyChangeCents:'0',buckets:[]});
      if(path.startsWith('/operations?'))return Promise.resolve({operations,hasMore:false,availableYears:[2026]});
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderHistory();

    expect(await screen.findByText('Distribuzione')).toBeInTheDocument();
    expect(screen.getByLabelText(/Bucket destinatari/)).toHaveAccessibleName(/Risparmi \+€750,00.*Spese \+€150,00/);
    expect(screen.getByText('+€900,00')).toBeInTheDocument();
    expect(screen.getByText('Spese → Risparmi · Weekend')).toBeInTheDocument();
    expect(screen.getByText('€50,00')).toBeInTheDocument();
    expect(screen.getByText('−€45,00')).toBeInTheDocument();
    expect(screen.getByText(/Tutti i movimenti · 3 operazioni/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'Trasferimenti'}));
    expect(screen.queryByText('Distribuzione')).not.toBeInTheDocument();
    expect(screen.getByText('Trasferimento')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button',{name:'Tutti'}));
    fireEvent.click(screen.getByRole('button',{name:'Cerca'}));
    fireEvent.change(screen.getByLabelText('Cerca nei movimenti'),{target:{value:'stipendio'}});
    expect(screen.getByText('Distribuzione')).toBeInTheDocument();
    expect(screen.queryByText('Trasferimento')).not.toBeInTheDocument();
  });

  it('starts filtered on the bucket opened from its detail page',async()=>{
    apiMock.mockImplementation((path:string)=>{
      if(path==='/dashboard')return Promise.resolve({totalCents:'0',monthlyChangeCents:'0',buckets:[]});
      if(path.startsWith('/operations?'))return Promise.resolve({operations:[],hasMore:false,availableYears:[]});
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderHistory('/storico?bucket=bucket-2');

    await waitFor(()=>expect(apiMock.mock.calls.some(([path])=>String(path).startsWith('/operations?')&&String(path).includes('bucketId=bucket-2'))).toBe(true));
  });

  it('paginates the history on desktop, loading more operations only when needed',async()=>{
    document.documentElement.dataset.mobileUi='false';
    const many=Array.from({length:45},(_,index):Operation=>({id:`op-${index+1}`,kind:'adjustment',note:`Voce ${index+1}`,occurredAt:'2026-08-18T12:00:00.000Z',entries:[{bucketId:'bucket-2',bucketName:'Spese',bucketIcon:'',bucketType:'spending',amountCents:'-100',balanceAfterCents:'0'}]}));
    const offsets:string[]=[];
    apiMock.mockImplementation((path:string)=>{
      if(path==='/dashboard')return Promise.resolve({totalCents:'0',monthlyChangeCents:'0',buckets:[]});
      if(path.startsWith('/operations?')){
        const offset=Number(new URLSearchParams(path.split('?')[1]).get('offset'));
        offsets.push(String(offset));
        return Promise.resolve({operations:many.slice(offset,offset+30),hasMore:offset+30<many.length,availableYears:[2026]});
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
    try{
      renderHistory();

      expect(await screen.findByText('Voce 1')).toBeInTheDocument();
      expect(screen.queryByText('Voce 21')).not.toBeInTheDocument();
      expect(screen.getByText('1–20 di 30+')).toBeInTheDocument();
      expect(offsets).toEqual(['0']);

      fireEvent.click(screen.getByRole('button',{name:'Pagina successiva'}));
      expect(await screen.findByText('Voce 21')).toBeInTheDocument();
      await waitFor(()=>expect(offsets).toEqual(['0','30']));
      expect(await screen.findByText('21–40 di 45')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button',{name:'Pagina 3'}));
      expect(await screen.findByText('Voce 45')).toBeInTheDocument();
      expect(screen.getByRole('button',{name:'Pagina successiva'})).toBeDisabled();
    }finally{
      delete document.documentElement.dataset.mobileUi;
    }
  });
});
