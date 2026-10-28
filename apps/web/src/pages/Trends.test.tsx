// @vitest-environment jsdom

import { cleanup,fireEvent,screen,within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { renderPage } from '../test/renderPage';
import { Trends } from './Trends';

const {apiMock}=vi.hoisted(()=>({apiMock:vi.fn()}));

vi.mock('../lib/api',()=>({api:apiMock}));

function renderTrends(){return renderPage({routes:{'/':<Trends/>}})}

describe('Trends',()=>{
  beforeEach(()=>{
    apiMock.mockReset();
    apiMock.mockResolvedValue({months:[
      {month:'2026-06',totalCents:'10000',buckets:[{id:'bucket-1',name:'Risparmi',type:'saving',color:'#B49CFF',includeInTotal:true,balanceCents:'10000'}]},
      {month:'2026-07',totalCents:'20000',buckets:[{id:'bucket-1',name:'Risparmi',type:'saving',color:'#B49CFF',includeInTotal:true,balanceCents:'20000'}]},
      {month:'2026-08',totalCents:'30000',buckets:[{id:'bucket-1',name:'Risparmi',type:'saving',color:'#B49CFF',includeInTotal:true,balanceCents:'30000'}]},
    ]});
  });

  afterEach(cleanup);

  it('starts on the latest month and compares it with the previous one',async()=>{
    renderTrends();

    expect(await screen.findByText('Agosto 2026')).toBeInTheDocument();
    expect(screen.getByText('vs lug')).toBeInTheDocument();
    expect(screen.getAllByText('+€100,00').length).toBeGreaterThan(0);
    expect(screen.getByText('+200% 3m')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Composizione del patrimonio')).getByText('Risparmi')).toBeInTheDocument();
  });

  it('selects an earlier month from its bar',async()=>{
    renderTrends();

    fireEvent.click(await screen.findByRole('button',{name:/^Luglio 2026/}));

    expect(await screen.findByText('Luglio 2026')).toBeInTheDocument();
    expect(screen.getByText('vs giu')).toBeInTheDocument();
  });
});
