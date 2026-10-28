// @vitest-environment jsdom

import { cleanup,fireEvent,screen,waitFor,within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Bucket,CurrentUser,ManagedUser } from '../types';
import { renderPage } from '../test/renderPage';
import { Settings } from './Settings';

vi.mock('../lib/avatarImage',()=>({prepareAvatar:vi.fn(async()=> 'data:image/jpeg;base64,/9j/4AAQ')}));

const {apiMock,writeTextMock}=vi.hoisted(()=>({apiMock:vi.fn(),writeTextMock:vi.fn()}));
vi.mock('../lib/api',async()=>{
  const actual=await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {...actual,api:apiMock};
});

const admin:CurrentUser={id:'00000000-0000-4000-8000-000000000001',email:'utente@example.it',role:'admin',firstName:null,lastName:null,gender:null,isActive:true,mustChangePassword:false};
const bucket:Bucket={id:'00000000-0000-4000-8000-0000000000b1',name:'Vacanze',type:'saving',balanceCents:'320000',monthlyChangeCents:'0',currency:'EUR',icon:'💰',color:'#F2614D',monthlyTargetCents:null,sortOrder:0,includeInTotal:true};
const emptyBucket:Bucket={...bucket,id:'00000000-0000-4000-8000-0000000000b2',name:'Regali',balanceCents:'0'};
const activeUser:ManagedUser={id:'00000000-0000-4000-8000-000000000004',email:'martina@example.it',role:'user',firstName:'Martina',lastName:'Rossi',gender:null,isActive:true,mustChangePassword:false,createdAt:'2026-03-03T10:00:00Z'};
const disabledUser:ManagedUser={id:'00000000-0000-4000-8000-000000000003',email:'disattivato@example.it',role:'user',firstName:'Sara',lastName:'Conti',gender:null,isActive:false,mustChangePassword:false,createdAt:'2026-08-22T10:00:00Z'};

function defaultApi(path:string){
  if(path==='/dashboard')return Promise.resolve({totalCents:'320000',monthlyChangeCents:'0',buckets:[bucket,emptyBucket]});
  if(path==='/templates')return Promise.resolve({templates:[]});
  if(path==='/planned-expenses/manage')return Promise.resolve({expenses:[]});
  if(path==='/admin/users')return Promise.resolve({users:[{...admin,createdAt:'2026-01-12T10:00:00Z'},disabledUser,activeUser]});
  if(path==='/backup/exports')return Promise.resolve({exports:[]});
  return Promise.resolve(undefined);
}

function renderSettings({role='admin',path='/impostazioni'}:{role?:CurrentUser['role'];path?:string}={}){
  return renderPage({path,routes:{'/impostazioni/*':<Settings user={{...admin,role}}/>,'/sposta/:mode':<p>Sposta</p>}});
}

describe('Settings',()=>{
  beforeEach(()=>{
    document.documentElement.dataset.mobileUi='true';
    apiMock.mockReset();writeTextMock.mockReset();
    apiMock.mockImplementation(defaultApi);
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:writeTextMock}});
  });

  afterEach(()=>{
    cleanup();
    delete document.documentElement.dataset.mobileUi;
  });

  it('shows account management only to administrators',()=>{
    const adminView=renderSettings();
    expect(screen.getByRole('link',{name:/Account/})).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    adminView.unmount();

    renderSettings({role:'user'});
    expect(screen.queryByRole('link',{name:/^Account/})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:/I tuoi dati/})).toBeInTheDocument();
  });

  it('opens each section as its own page',async()=>{
    renderSettings();

    expect(await screen.findByText('0 salvati')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link',{name:/Template/}));
    expect(await screen.findByRole('heading',{name:'Template'})).toBeInTheDocument();
    expect(await screen.findByText('Nessun template')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link',{name:'Indietro'}));
    expect(await screen.findByRole('heading',{name:'Impostazioni'})).toBeInTheDocument();
  });

  it('blocks deleting a bucket that still holds money',async()=>{
    renderSettings({path:'/impostazioni/bucket'});

    fireEvent.click(await screen.findByRole('button',{name:'Elimina Vacanze'}));
    const sheet=screen.getByRole('dialog',{name:'Eliminare Vacanze?'});
    expect(within(sheet).getByRole('button',{name:'Elimina'})).toBeDisabled();
    expect(within(sheet).getByRole('link',{name:'Trasferisci il saldo'})).toHaveAttribute('href','/sposta/trasferisci');
  });

  it('deletes an empty bucket after confirmation',async()=>{
    renderSettings({path:'/impostazioni/bucket'});

    fireEvent.click(await screen.findByRole('button',{name:'Elimina Regali'}));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Eliminare Regali?'})).getByRole('button',{name:'Elimina'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(`/buckets/${emptyBucket.id}`,{method:'DELETE'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('exports the backup without a password when requested',async()=>{
    const backup={format:'worth-split-backup',exportedAt:'2026-08-24T12:00:00.000Z'};
    const createObjectUrl=vi.fn(()=> 'blob:backup');
    const revokeObjectUrl=vi.fn();
    Object.assign(URL,{createObjectURL:createObjectUrl,revokeObjectURL:revokeObjectUrl});
    const download=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>undefined);
    apiMock.mockImplementation((path:string)=>path==='/backup/export?protected=false'?Promise.resolve(backup):defaultApi(path));

    renderSettings();
    fireEvent.click(screen.getByRole('link',{name:/Backup/}));
    fireEvent.click(await screen.findByRole('button',{name:/Esporta backup/}));
    expect(screen.getByRole('dialog',{name:'Esporta backup'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Esporta senza password/}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/backup/export?protected=false'));
    expect(await screen.findByRole('status')).toHaveTextContent(/esportato senza password/);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:backup');
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('keeps the password-protected export available',async()=>{
    renderSettings({path:'/impostazioni/backup'});
    fireEvent.click(await screen.findByRole('button',{name:/Esporta backup/}));
    fireEvent.click(screen.getByRole('button',{name:/Proteggi con password/}));

    expect(screen.getByRole('dialog',{name:'Proteggi backup'})).toBeInTheDocument();
    expect(screen.getByLabelText('Password di cifratura')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Esporta backup protetto'})).toBeInTheDocument();
  });

  it.each([
    {option:/Reset parziale/,title:'Confermare il reset parziale?',start:'Azzera dati',mode:'partial',confirmation:'RESET_PARTIAL',message:/movimenti e pagamenti pianificati eliminati, bucket azzerati/},
    {option:/Reset totale/,title:'Confermare il reset totale?',start:'Elimina tutto',mode:'total',confirmation:'RESET_TOTAL',message:/bucket, template, spese previste e movimenti eliminati/},
  ])('requires the typed word and a last confirmation for $mode reset',async({option,title,start,mode,confirmation,message})=>{
    renderSettings();

    fireEvent.click(screen.getByRole('link',{name:/Azzera dati/}));
    fireEvent.click(await screen.findByRole('radio',{name:option}));
    const startButton=screen.getByRole('button',{name:start});
    expect(startButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('AZZERA'),{target:{value:'azzera'}});
    fireEvent.click(startButton);

    const sheet=screen.getByRole('dialog',{name:title});
    expect(apiMock).not.toHaveBeenCalledWith('/backup/reset',expect.anything());
    fireEvent.click(within(sheet).getByRole('button',{name:'Azzera definitivamente'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/backup/reset',{method:'POST',body:JSON.stringify({mode,confirmation})}));
    expect(await screen.findByRole('status')).toHaveTextContent(message);
    expect(screen.getByRole('heading',{name:'Impostazioni'})).toBeInTheDocument();
  });

  it('creates an account with a generated password and copies the credentials',async()=>{
    apiMock.mockImplementation((path:string,init?:RequestInit)=>{
      if(path==='/admin/users'&&init?.method==='POST'){
        const body=JSON.parse(String(init.body)) as {email:string;temporaryPassword:string};
        return Promise.resolve({user:{...disabledUser,email:body.email.toLowerCase(),isActive:true,mustChangePassword:true}});
      }
      return defaultApi(path);
    });
    writeTextMock.mockResolvedValue(undefined);
    renderSettings({path:'/impostazioni/account/nuovo'});

    fireEvent.click(screen.getByRole('radio',{name:/Password temporanea/}));
    const password=screen.getByLabelText('Password temporanea') as HTMLInputElement;
    expect(password.value).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
    fireEvent.change(screen.getByLabelText('Nome'),{target:{value:' Giulia '}});
    fireEvent.change(screen.getByPlaceholderText('nome@esempio.it'),{target:{value:'NUOVO@example.it'}});
    fireEvent.click(screen.getByRole('radio',{name:/Admin/}));
    fireEvent.click(screen.getByRole('button',{name:'Crea account'}));

    expect(await screen.findByRole('heading',{name:'Account creato'})).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/admin/users',{method:'POST',body:JSON.stringify({email:'NUOVO@example.it',temporaryPassword:password.value,firstName:'Giulia',lastName:null,role:'admin'})});
    fireEvent.click(screen.getByRole('button',{name:'Copia tutte le credenziali'}));
    await waitFor(()=>expect(writeTextMock).toHaveBeenCalledWith(`Link app: ${window.location.origin}\nEmail: nuovo@example.it\nPassword temporanea: ${password.value}`));
    expect(await screen.findByRole('status')).toHaveTextContent('Copiato negli appunti.');
  });

  it('creates an account by e-mail invitation without a temporary password',async()=>{
    apiMock.mockImplementation((path:string,init?:RequestInit)=>{
      if(path==='/admin/users'&&init?.method==='POST'){
        const body=JSON.parse(String(init.body)) as {email:string};
        return Promise.resolve({user:{...activeUser,email:body.email,mustChangePassword:true},inviteSent:true});
      }
      return defaultApi(path);
    });
    renderSettings({path:'/impostazioni/account/nuovo'});

    expect(screen.queryByLabelText('Password temporanea')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('nome@esempio.it'),{target:{value:'nuovo@example.it'}});
    fireEvent.click(screen.getByRole('button',{name:'Crea e invia invito'}));

    expect(await screen.findByRole('status')).toHaveTextContent('Abbiamo inviato un invito a nuovo@example.it');
    expect(apiMock).toHaveBeenCalledWith('/admin/users',{method:'POST',body:JSON.stringify({email:'nuovo@example.it',firstName:null,lastName:null,role:'user'})});
  });

  it('warns when the invitation could not be delivered',async()=>{
    apiMock.mockImplementation((path:string,init?:RequestInit)=>path==='/admin/users'&&init?.method==='POST'
      ?Promise.resolve({user:{...activeUser,mustChangePassword:true},inviteSent:false})
      :defaultApi(path));
    renderSettings({path:'/impostazioni/account/nuovo'});

    fireEvent.change(screen.getByPlaceholderText('nome@esempio.it'),{target:{value:'nuovo@example.it'}});
    fireEvent.click(screen.getByRole('button',{name:'Crea e invia invito'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('l’invito non è stato consegnato');
  });

  it('e-mails a password link to an existing account',async()=>{
    apiMock.mockImplementation((path:string)=>path.endsWith('/password-link')?Promise.resolve(undefined):defaultApi(path));
    renderSettings({path:'/impostazioni/account'});

    fireEvent.click(await screen.findByRole('button',{name:'Azioni per Martina Rossi'}));
    const sheet=screen.getByRole('dialog',{name:'Martina Rossi'});
    fireEvent.click(within(sheet).getByRole('button',{name:/Invia link per la password/}));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Invia'}));

    expect(await screen.findByRole('status')).toHaveTextContent('Email inviata a martina@example.it');
    expect(apiMock).toHaveBeenCalledWith(`/admin/users/${activeUser.id}/password-link`,{method:'POST',body:JSON.stringify({purpose:'reset'})});
  });

  it('offers permanent deletion only for disabled accounts and asks for confirmation',async()=>{
    renderSettings({path:'/impostazioni/account'});

    fireEvent.click(await screen.findByRole('button',{name:'Azioni per Sara Conti'}));
    let sheet=screen.getByRole('dialog',{name:'Sara Conti'});
    fireEvent.click(within(sheet).getByRole('button',{name:/Elimina definitivamente/}));
    sheet=screen.getByRole('dialog',{name:'Elimina account'});
    expect(apiMock).not.toHaveBeenCalledWith(`/admin/users/${disabledUser.id}`,expect.anything());
    fireEvent.click(within(sheet).getByRole('button',{name:'Elimina definitivamente'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(`/admin/users/${disabledUser.id}`,{method:'DELETE'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('promotes an active user to administrator after confirmation',async()=>{
    renderSettings({path:'/impostazioni/account'});

    fireEvent.click(await screen.findByRole('button',{name:'Azioni per Martina Rossi'}));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Martina Rossi'})).getByRole('button',{name:/Rendi amministratore/}));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Rendi amministratore'})).getByRole('button',{name:'Rendi amministratore'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(`/admin/users/${activeUser.id}/role`,{method:'PATCH',body:JSON.stringify({role:'admin'})}));
  });

  it('edits the name and e-mail of a user',async()=>{
    renderSettings({path:'/impostazioni/account'});

    fireEvent.click(await screen.findByRole('button',{name:'Azioni per Martina Rossi'}));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Martina Rossi'})).getByRole('button',{name:/Modifica dati/}));
    const sheet=screen.getByRole('dialog',{name:'Modifica dati'});
    fireEvent.change(within(sheet).getByLabelText('Email di accesso'),{target:{value:'martina.rossi@example.it'}});
    fireEvent.change(within(sheet).getByLabelText('Cognome'),{target:{value:''}});
    fireEvent.click(within(sheet).getByRole('button',{name:'Salva'}));

    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(`/admin/users/${activeUser.id}`,{method:'PATCH',body:JSON.stringify({email:'martina.rossi@example.it',firstName:'Martina',lastName:null})}));
  });

  it('shows the last backup and the recent exports',async()=>{
    apiMock.mockImplementation((path:string)=>path==='/backup/exports'
      ?Promise.resolve({exports:[{id:'00000000-0000-4000-8000-0000000000e1',createdAt:'2026-10-12T16:42:00.000Z',protected:true,sizeBytes:421888,bucketCount:7,operationCount:1284,plannedExpenseCount:6,templateCount:2}]})
      :defaultApi(path));
    renderSettings({path:'/impostazioni/backup'});

    expect(await screen.findByText('worth-split-2026-10-12.wsbackup')).toBeInTheDocument();
    expect(screen.getByText('412 KB')).toBeInTheDocument();
    expect(screen.getByLabelText('Protetto da password')).toBeInTheDocument();
    expect(screen.queryByText('Mai')).not.toBeInTheDocument();
  });

  it('uploads a resized profile photo and can remove it',async()=>{
    apiMock.mockImplementation((path:string,init?:RequestInit)=>{
      if(path==='/profile/avatar'&&init?.method==='PUT')return Promise.resolve({user:{...admin,avatarVersion:'1792774000000'}});
      if(path==='/profile/avatar'&&init?.method==='DELETE')return Promise.resolve({user:{...admin,avatarVersion:null}});
      return defaultApi(path);
    });
    const view=renderSettings({path:'/impostazioni/profilo'});

    const input=view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input,{target:{files:[new File(['x'],'foto.jpg',{type:'image/jpeg'})]}});
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/profile/avatar',{method:'PUT',body:JSON.stringify({image:'data:image/jpeg;base64,/9j/4AAQ'})}));
    expect(await screen.findByRole('status')).toHaveTextContent('Foto profilo aggiornata.');
    expect(view.client.getQueryData(['me'])).toEqual({user:{...admin,avatarVersion:'1792774000000'}});
  });

  it('shows the profile photo instead of the initials',()=>{
    const user={...admin,avatarVersion:'1792774000000'};
    const view=renderPage({path:'/impostazioni/profilo',routes:{'/impostazioni/*':<Settings user={user}/>}});
    expect(view.container.querySelector('img')).toHaveAttribute('src',`/api/users/${admin.id}/avatar?v=1792774000000`);
    fireEvent.click(screen.getByRole('button',{name:'Rimuovi'}));
    return waitFor(()=>expect(apiMock).toHaveBeenCalledWith('/profile/avatar',{method:'DELETE'}));
  });

  it('never offers actions on your own account',async()=>{
    renderSettings({path:'/impostazioni/account'});

    fireEvent.click(await screen.findByRole('button',{name:'Azioni per utente@example.it'}));
    const sheet=screen.getByRole('dialog',{name:'utente@example.it'});
    expect(within(sheet).getByText(/Questo è il tuo account/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('button',{name:/Reimposta password/})).not.toBeInTheDocument();
  });

  it('opens sub-pages in a side drawer on desktop',async()=>{
    document.documentElement.dataset.mobileUi='false';
    renderSettings({path:'/impostazioni/template'});

    expect(screen.getByRole('heading',{name:'Impostazioni'})).toBeInTheDocument();
    const drawer=screen.getByRole('dialog',{name:'Template'});
    expect(within(drawer).getByText('Impostazioni · Template')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button',{name:'Chiudi'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
