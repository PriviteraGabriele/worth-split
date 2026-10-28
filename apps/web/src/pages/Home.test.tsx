// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act,cleanup,fireEvent,screen,waitFor,within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Dashboard,PlannedExpensesResponse } from '../types';
import { renderPage } from '../test/renderPage';
import { Home } from './Home';

const firstBucketId='00000000-0000-4000-8000-000000000001';
const secondBucketId='00000000-0000-4000-8000-000000000002';
const dashboard:Dashboard={
  totalCents:'30000',
  monthlyChangeCents:'12345',
  buckets:[
    {id:firstBucketId,name:'Spese',type:'spending',balanceCents:'10000',monthlyChangeCents:'0',plannedExpenseCents:'2500',currency:'EUR',icon:'wallet',color:'#FF826F',monthlyTargetCents:null,sortOrder:0,includeInTotal:true},
    {id:secondBucketId,name:'Risparmi',type:'saving',balanceCents:'20000',monthlyChangeCents:'0',currency:'EUR',icon:'piggy-bank',color:'#B49CFF',monthlyTargetCents:null,sortOrder:1,includeInTotal:true},
  ],
};
const planned:PlannedExpensesResponse={
  expenses:[
    {id:'p1',name:'Luce',description:null,category:'other',bucketId:firstBucketId,bucketName:'Spese',bucketIcon:null,bucketType:'spending',bucketColor:'#FF826F',amountCents:'4000',configuredAmountCents:'4000',amountMode:'estimated',frequency:'monthly',dueRule:'month',dueDay:null,dueDate:null,startMonth:'2026-01',durationMonths:null,archivedAt:null,includedInEstimatedTotal:true,period:'2026-08',status:'open',actualAmountCents:'1500',paymentCount:1,completedAt:null},
    {id:'p2',name:'Palestra',description:null,category:'subscription',bucketId:firstBucketId,bucketName:'Spese',bucketIcon:null,bucketType:'spending',bucketColor:'#FF826F',amountCents:'9900',configuredAmountCents:'9900',amountMode:'fixed',frequency:'monthly',dueRule:'month',dueDay:null,dueDate:null,startMonth:'2026-01',durationMonths:null,archivedAt:null,includedInEstimatedTotal:false,period:'2026-08',status:'open',actualAmountCents:'0',paymentCount:0,completedAt:null},
  ],
  endedExpenses:[],
};

const {apiMock,dndHarness}=vi.hoisted(()=>({
  apiMock:vi.fn(),
  dndHarness:{onDragEnd:undefined as ((event:DragEndEvent)=>void)|undefined},
}));

vi.mock('../lib/api',()=>({api:apiMock,newKey:()=> '00000000-0000-4000-8000-000000000099'}));
vi.mock('@dnd-kit/core',async importOriginal=>{
  const actual=await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext:({children,onDragEnd}:{children:ReactNode;onDragEnd?:(event:DragEndEvent)=>void})=>{dndHarness.onDragEnd=onDragEnd;return <>{children}</>},
    DragOverlay:({children}:{children:ReactNode})=><>{children}</>,
  };
});
vi.mock('@dnd-kit/sortable',async importOriginal=>{
  const actual=await importOriginal<typeof import('@dnd-kit/sortable')>();
  return {
    ...actual,
    SortableContext:({children}:{children:ReactNode})=><>{children}</>,
    useSortable:()=>({attributes:{role:'button'},listeners:{},setNodeRef:()=>undefined,setActivatorNodeRef:()=>undefined,transform:null,transition:undefined,isDragging:false}),
  };
});

function renderHome(){return renderPage({routes:{'/':<Home/>,'/bucket/:id':<p>Dettaglio aperto</p>}})}

describe('Home',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    dndHarness.onDragEnd=undefined;
    apiMock.mockImplementation(async(path:string,init?:RequestInit)=>{
      if(path==='/dashboard')return dashboard;
      if(path.startsWith('/planned-expenses?'))return planned;
      if(path==='/trends')return {months:[]};
      if(path==='/auth/me')return {user:{id:'u1',email:'giulia@example.com',role:'user',firstName:'Giulia',lastName:null,gender:null,isActive:true,mustChangePassword:false}};
      if(path==='/buckets/order'&&init?.method==='PUT')return undefined;
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  afterEach(cleanup);

  it('shows the net worth, the residual still due this month and what remains after it',async()=>{
    renderHome();

    const hero=await screen.findByLabelText('Patrimonio');
    expect(hero).toHaveTextContent('€300,00');
    expect(hero).toHaveTextContent('+123,45');
    const due=screen.getByLabelText('Spese previste del mese');
    // Only the included estimate counts, and only its residual (40 − 15).
    await waitFor(()=>expect(due).toHaveTextContent(/· 1/));
    expect(due).toHaveTextContent('€25,00');
    expect(due).toHaveTextContent('€275,00');
    expect(await screen.findByText('Ciao, Giulia')).toBeInTheDocument();
  });

  it('shows on each tile what is left after this month\'s planned expenses',async()=>{
    renderHome();
    const spese=await screen.findByRole('link',{name:'Apri Spese'});
    expect(within(spese).getByText('Restano')).toBeInTheDocument();
    expect(within(spese).getByText('€75,00')).toBeInTheDocument();
    expect(within(spese).getByTitle('Spese previste del mese: €25,00')).toBeInTheDocument();
    expect(within(screen.getByRole('link',{name:'Apri Risparmi'})).getByText('Nessuna spesa prevista')).toBeInTheDocument();
  });

  it('opens a bucket from its tile',async()=>{
    renderHome();
    fireEvent.click(await screen.findByRole('link',{name:'Apri Risparmi'}));
    expect(await screen.findByText('Dettaglio aperto')).toBeInTheDocument();
  });

  it('keeps the touch grip draggable and saves the reordered bucket ids',async()=>{
    renderHome();
    fireEvent.click(await screen.findByRole('button',{name:'Riordina'}));

    const grip=screen.getByRole('button',{name:'Trascina Spese per riordinarlo'});
    expect(grip).toHaveAttribute('type','button');
    expect(grip.style.touchAction).toBe('none');

    act(()=>dndHarness.onDragEnd?.({active:{id:firstBucketId},over:{id:secondBucketId}} as DragEndEvent));

    const reorderedGrid=document.querySelector<HTMLElement>('.bucket-grid.is-reordering');
    expect(reorderedGrid).not.toBeNull();
    expect(within(reorderedGrid!).getAllByRole('heading',{level:3}).map(heading=>heading.textContent)).toEqual(['Risparmi','Spese']);

    fireEvent.click(screen.getByRole('button',{name:'Salva'}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/buckets/order',{method:'PUT',body:JSON.stringify({ids:[secondBucketId,firstBucketId]})}));
  });
});
