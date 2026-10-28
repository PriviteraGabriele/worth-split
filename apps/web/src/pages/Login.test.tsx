// @vitest-environment jsdom

import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { CurrentUser,Dashboard } from '../types';
import { ApiError } from '../lib/api';
import { Login } from './Login';

const {apiMock}=vi.hoisted(()=>({apiMock:vi.fn()}));
vi.mock('../lib/api',()=>({api:apiMock,ApiError:class ApiError extends Error{constructor(public status:number,public code:string){super(code)}}}));

const user:CurrentUser={
  id:'00000000-0000-4000-8000-000000000001',
  email:'utente@example.it',
  role:'user',
  firstName:null,
  lastName:null,
  gender:null,
  isActive:true,
  mustChangePassword:false,
};

function renderLogin(client:QueryClient){
  return render(<QueryClientProvider client={client}><Login/></QueryClientProvider>);
}

describe('Login',()=>{
  beforeEach(()=>{apiMock.mockReset()});
  afterEach(cleanup);

  it('replaces the current user and removes cached data from the previous account',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const previousDashboard:Dashboard={totalCents:'100',monthlyChangeCents:'0',buckets:[]};
    client.setQueryData(['dashboard'],previousDashboard);
    apiMock.mockResolvedValue({user});
    renderLogin(client);

    fireEvent.change(screen.getByLabelText('Email'),{target:{value:user.email}});
    fireEvent.change(screen.getByLabelText('Password'),{target:{value:'password'}});
    fireEvent.click(screen.getByRole('button',{name:'Accedi'}));

    await waitFor(()=>expect(client.getQueryData(['me'])).toEqual({user}));
    expect(client.getQueryData(['dashboard'])).toBeUndefined();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('explains when too many login attempts were made',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    apiMock.mockImplementation(async()=>{throw new ApiError(429,'TOO_MANY_LOGIN_ATTEMPTS')});
    renderLogin(client);

    fireEvent.change(screen.getByLabelText('Email'),{target:{value:user.email}});
    fireEvent.change(screen.getByLabelText('Password'),{target:{value:'password'}});
    fireEvent.click(screen.getByRole('button',{name:'Accedi'}));

    expect(await screen.findByText('Troppi tentativi di accesso. Riprova tra qualche minuto.')).toBeInTheDocument();
  });

  it('sends a reset link from the forgotten password form',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    apiMock.mockResolvedValue(undefined);
    renderLogin(client);

    fireEvent.click(screen.getByRole('button',{name:'Password dimenticata?'}));
    fireEvent.change(screen.getByLabelText('Email'),{target:{value:user.email}});
    fireEvent.click(screen.getByRole('button',{name:'Invia link'}));

    expect(await screen.findByRole('status')).toHaveTextContent(`Se ${user.email} corrisponde a un account attivo`);
    expect(apiMock).toHaveBeenCalledWith('/auth/password-reset/request',{method:'POST',body:JSON.stringify({email:user.email})});
  });
});
