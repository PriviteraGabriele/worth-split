// @vitest-environment jsdom

import { Suspense } from 'react';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { renderPage } from '../test/renderPage';
import { ResetPassword } from './ResetPassword';

const {apiMock}=vi.hoisted(()=>({apiMock:vi.fn()}));
vi.mock('../lib/api',()=>({api:apiMock,ApiError:class ApiError extends Error{constructor(public status:number,public code:string){super(code)}}}));

const token='a'.repeat(43);

function open(hash:string){
  window.history.replaceState(null,'',`/reimposta-password${hash}`);
  return renderPage({path:'/reimposta-password',routes:{'/reimposta-password':<ResetPassword/>,'/login':<p>Pagina di accesso</p>}});
}

function fill(password:string,confirmation=password){
  fireEvent.change(screen.getByLabelText(/^Nuova password/),{target:{value:password}});
  fireEvent.change(screen.getByLabelText('Ripeti la password'),{target:{value:confirmation}});
  fireEvent.click(screen.getByRole('button',{name:'Salva password'}));
}

describe('ResetPassword',()=>{
  beforeEach(()=>{apiMock.mockReset()});
  afterEach(cleanup);

  it('sends the token from the link and removes it from the address bar',async()=>{
    apiMock.mockResolvedValue(undefined);
    open(`#token=${token}`);

    expect(window.location.hash).toBe('');
    fill('brand-new-pass-1');

    expect(await screen.findByRole('status')).toHaveTextContent('Ora puoi accedere con la nuova password.');
    expect(apiMock).toHaveBeenCalledWith('/auth/password-reset',{method:'POST',body:JSON.stringify({token,newPassword:'brand-new-pass-1'})});
    fireEvent.click(screen.getByRole('button',{name:/Vai all’accesso/}));
    expect(await screen.findByText('Pagina di accesso')).toBeInTheDocument();
  });

  // React may render the page, throw that render away and mount it again
  // (here a sibling suspends the first attempt): the token must survive.
  it('keeps the token when React discards the first render and mounts again',async()=>{
    apiMock.mockResolvedValue(undefined);
    let ready=false;
    const pending=new Promise<void>(resolve=>setTimeout(()=>{ready=true;resolve()},20));
    function SuspendsOnce(){if(!ready)throw pending;return null}
    window.history.replaceState(null,'',`/reimposta-password#token=${token}`);
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Suspense fallback={<p>Caricamento</p>}><ResetPassword/><SuspendsOnce/></Suspense></MemoryRouter></QueryClientProvider>);

    expect(await screen.findByLabelText(/^Nuova password/)).toBeInTheDocument();
    expect(screen.queryByText('Link incompleto')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');
    fill('brand-new-pass-1');
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/auth/password-reset',{method:'POST',body:JSON.stringify({token,newPassword:'brand-new-pass-1'})}));
  });

  it('checks that the two passwords match before sending',()=>{
    open(`#token=${token}`);
    fill('brand-new-pass-1','brand-new-pass-2');
    expect(screen.getByRole('alert')).toHaveTextContent('Le password non coincidono.');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('explains an expired or already used link',async()=>{
    const { ApiError }=await import('../lib/api');
    apiMock.mockRejectedValue(new ApiError(400,'PASSWORD_TOKEN_INVALID'));
    open(`#token=${token}`);
    fill('brand-new-pass-1');
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Il link non è valido o è scaduto.'));
  });

  it('asks for a new link when the token is missing',()=>{
    open('');
    expect(screen.getByRole('alert')).toHaveTextContent('Apri il link esattamente come arrivato nell’email');
    expect(screen.queryByLabelText(/^Nuova password/)).not.toBeInTheDocument();
  });
});
