import { useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Check,ChevronRight,Copy,KeyRound,LockKeyhole,Mail,Pencil,Plus,RefreshCw,Search,ShieldCheck,ShieldOff,Trash2,TriangleAlert,UserCheck,UserX } from 'lucide-react';
import { Link,Navigate,useNavigate,useParams } from 'react-router-dom';
import { api,ApiError } from '../../lib/api';
import { generatePassword,MIN_PASSWORD_LENGTH } from '../../lib/password';
import { useMobileLayout } from '../../lib/useMobileLayout';
import { displayName } from '../../lib/user';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import type { CurrentUser,ManagedUser } from '../../types';
import { SettingsPanel } from './SettingsPanel';

const LIST_PATH='/impostazioni/account';
const avatarColors=['#8B7CF6','#3AAED8','#F27A65','#46C987','#E6A44A','#EA6F9A','#46B7A7'];
const dateFormatter=new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'});
type CopyStatus='idle'|'copied'|'error';

function mailErrorMessage(caught:unknown){
  if(caught instanceof ApiError&&caught.code==='MAIL_NOT_CONFIGURED')return 'L’invio di email non è configurato sul server: usa una password temporanea.';
  if(caught instanceof ApiError&&caught.code==='MAIL_DELIVERY_FAILED')return 'L’email non è stata consegnata. Riprova tra qualche minuto.';
  return 'Invio non riuscito.';
}

function useUsers(){
  return useQuery({queryKey:['admin-users'],queryFn:({signal})=>api<{users:ManagedUser[]}>('/admin/users',{signal})});
}

function avatarStyle(user:ManagedUser){
  if(!user.isActive)return {background:'var(--sf2)',color:'var(--mu)'};
  if(user.role==='admin')return {background:'var(--ac)',color:'var(--aci)'};
  const hash=[...user.id].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  return {background:avatarColors[hash%avatarColors.length],color:'#fff'};
}

function statusOf(user:ManagedUser){
  if(!user.isActive)return {label:'Disattivo',tag:'tag',dot:'off'};
  if(user.mustChangePassword)return {label:'Password',tag:'tag est',dot:'wait'};
  return {label:user.role==='admin'?'Admin':'Utente',tag:user.role==='admin'?'tag ink':'tag',dot:'on'};
}

export function UserAvatar({user,size=44}:{user:ManagedUser;size?:number}){
  const status=statusOf(user);
  return <span aria-hidden="true"><Avatar user={user} className="user-avatar-b" style={{...avatarStyle(user),width:size,height:size}}><i className={`status-dot ${status.dot}`}/></Avatar></span>;
}

export function AccountsPage({currentUser}:{currentUser:CurrentUser}){
  const mobile=useMobileLayout();
  const users=useUsers();
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<ManagedUser|null>(null);
  const list=users.data?.users??[];
  const needle=query.trim().toLowerCase();
  const visible=needle?list.filter(user=>`${displayName(user)} ${user.email}`.toLowerCase().includes(needle)):list;
  const newLink=<Link className={mobile?'ib lime':'btn sm'} to={`${LIST_PATH}/nuovo`} aria-label={mobile?'Nuovo account':undefined}><Plus aria-hidden="true"/>{!mobile&&'Crea account'}</Link>;

  return <SettingsPanel cap="Account" title="Account" action={mobile?newLink:undefined} footer={mobile?undefined:<><span className="foot-note">Gestisci gli accessi: i dati finanziari degli altri utenti restano privati.</span>{newLink}</>}>
    <section className="hero-tile stat-hero">
      <div><span className="cap">Totali</span><b className="mono">{list.length}</b></div>
      <div><span className="cap">Attivi</span><b className="mono">{list.filter(user=>user.isActive).length}</b></div>
      <div><span className="cap">Admin</span><b className="mono">{list.filter(user=>user.role==='admin').length}</b></div>
    </section>
    <label className="pill-input"><Search aria-hidden="true"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Cerca per nome o email" aria-label="Cerca account"/></label>
    {users.isLoading&&<div className="skeleton card"/>}
    {users.isError&&<p className="form-error">Impossibile caricare gli account.</p>}
    <div className="manage-list">{visible.map(user=>{
      const status=statusOf(user);
      const self=user.id===currentUser.id;
      return <button type="button" className={`manage-row user-row${user.isActive?'':' muted'}`} key={user.id} onClick={()=>setSelected(user)} aria-label={`Azioni per ${displayName(user)}`}>
        <UserAvatar user={user}/>
        <span className="grow"><strong className="manage-name">{displayName(user)}<span className={status.tag}>{status.label}</span></strong><small>{user.email}{self?' · tu':''}</small></span>
        <ChevronRight className="row-chevron" aria-hidden="true"/>
      </button>;
    })}</div>
    {users.data&&visible.length===0&&<p className="sub-note">Nessun account corrisponde alla ricerca.</p>}
    <p className="sub-note with-icon"><LockKeyhole aria-hidden="true"/>Come amministratore gestisci gli accessi, ma non vedi saldi, bucket o movimenti degli altri utenti.</p>
    {selected&&<AccountActionsSheet user={selected} currentUser={currentUser} onClose={()=>setSelected(null)}/>}
  </SettingsPanel>;
}

function AccountActionsSheet({user,currentUser,onClose}:{user:ManagedUser;currentUser:CurrentUser;onClose:()=>void}){
  const [title,setTitle]=useState(displayName(user));
  return <Modal title={title} onClose={onClose}><AccountActions user={user} currentUser={currentUser} onDone={onClose} onTitle={setTitle}/></Modal>;
}

/** Desktop drawer opened from the accounts table. */
export function AccountDetailPage({currentUser}:{currentUser:CurrentUser}){
  const {id}=useParams();
  const navigate=useNavigate();
  const users=useUsers();
  if(users.isLoading)return <SettingsPanel cap="Account" title="Account" back={LIST_PATH}><div className="skeleton card"/></SettingsPanel>;
  const user=users.data?.users.find(item=>item.id===id);
  if(!user)return <Navigate to={LIST_PATH} replace/>;
  return <SettingsPanel cap="Account" title={displayName(user)} back={LIST_PATH}>
    <AccountActions key={user.id} user={user} currentUser={currentUser} onDone={()=>navigate('/impostazioni')}/>
  </SettingsPanel>;
}

type ActionView='menu'|'edit'|'role'|'reset'|'link'|'link-done'|'status'|'delete'|{kind:'reset-done';password:string};

function AccountActions({user,currentUser,onDone,onTitle}:{user:ManagedUser;currentUser:CurrentUser;onDone:()=>void;onTitle?:(title:string)=>void}){
  const qc=useQueryClient();
  const [view,setViewState]=useState<ActionView>('menu');
  const [copy,setCopy]=useState<CopyStatus>('idle');
  const self=user.id===currentUser.id;
  const status=statusOf(user);
  const refresh=()=>qc.invalidateQueries({queryKey:['admin-users']});
  const canDelete=user.role==='user'&&!user.isActive;

  function setView(next:ActionView){
    setViewState(next);
    onTitle?.(next==='edit'?'Modifica dati':next==='role'?(user.role==='admin'?'Rendi utente':'Rendi amministratore'):next==='reset'?'Reimposta password':next==='link'||next==='link-done'?'Link via email':next==='status'?(user.isActive?'Disattiva account':'Riattiva account'):next==='delete'?'Elimina account':typeof next==='object'?'Password reimpostata':displayName(user));
  }
  const reset=useMutation({
    mutationFn:async()=>{const password=generatePassword();await api(`/admin/users/${user.id}/reset-password`,{method:'POST',body:JSON.stringify({temporaryPassword:password})});return password},
    onSuccess:async password=>{await refresh();setCopy('idle');setView({kind:'reset-done',password})},
  });
  // An account that has not chosen its password yet gets the invitation
  // again; the others a reset link.
  const linkPurpose=user.mustChangePassword?'invite':'reset';
  const sendLink=useMutation({
    mutationFn:()=>api(`/admin/users/${user.id}/password-link`,{method:'POST',body:JSON.stringify({purpose:linkPurpose})}),
    onSuccess:()=>setView('link-done'),
  });
  const toggle=useMutation({mutationFn:()=>api(`/admin/users/${user.id}/status`,{method:'PATCH',body:JSON.stringify({isActive:!user.isActive})}),onSuccess:async()=>{await refresh();onDone()}});
  const remove=useMutation({mutationFn:()=>api(`/admin/users/${user.id}`,{method:'DELETE'}),onSuccess:async()=>{await refresh();onDone()}});
  const changeRole=useMutation({mutationFn:()=>api(`/admin/users/${user.id}/role`,{method:'PATCH',body:JSON.stringify({role:user.role==='admin'?'user':'admin'})}),onSuccess:async()=>{await refresh();onDone()}});
  const edit=useMutation({
    mutationFn:(body:{email:string;firstName:string|null;lastName:string|null})=>api(`/admin/users/${user.id}`,{method:'PATCH',body:JSON.stringify(body)}),
    onSuccess:async()=>{await refresh();onDone()},
  });
  function submitEdit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const text=(name:string)=>String(data.get(name)??'').trim()||null;
    edit.mutate({email:String(data.get('email')??'').trim(),firstName:text('firstName'),lastName:text('lastName')});
  }

  async function copyPassword(password:string){
    try{await navigator.clipboard.writeText(`Link app: ${window.location.origin}\nEmail: ${user.email}\nPassword temporanea: ${password}`);setCopy('copied')}
    catch{setCopy('error')}
  }

  if(view==='edit')return <form className="sub-form" onSubmit={submitEdit}>
    <div className="grid-2">
      <label className="field"><span className="cap">Nome</span><span className="input"><input name="firstName" defaultValue={user.firstName??''} maxLength={60} autoComplete="off"/></span></label>
      <label className="field"><span className="cap">Cognome</span><span className="input"><input name="lastName" defaultValue={user.lastName??''} maxLength={60} autoComplete="off"/></span></label>
    </div>
    <div className="field"><label className="cap" htmlFor="account-edit-email">Email di accesso</label><span className="input"><input id="account-edit-email" name="email" type="email" defaultValue={user.email} required maxLength={254} autoComplete="off" aria-describedby="account-edit-email-note"/></span><small id="account-edit-email-note" className="field-note">Se cambi l’email, comunica all’utente il nuovo indirizzo per accedere.</small></div>
    {edit.isError&&<p className="form-error" role="alert">{edit.error instanceof ApiError&&edit.error.code==='ALREADY_EXISTS'?'Esiste già un account con questa email.':'Salvataggio non riuscito.'}</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setView('menu')} disabled={edit.isPending}>Indietro</button><button className="btn" disabled={edit.isPending}>{edit.isPending?'Salvataggio…':'Salva'}</button></div>
  </form>;
  if(view==='role')return <div className="confirm-sheet">
    <span className="confirm-icon">{user.role==='admin'?<ShieldOff aria-hidden="true"/>:<ShieldCheck aria-hidden="true"/>}</span>
    <p>{user.role==='admin'?'Togliere i permessi di amministratore a':'Rendere amministratore'} <strong>{displayName(user)}</strong>?</p>
    <small>{user.role==='admin'?'Tornerà a gestire solo il proprio patrimonio e non potrà più creare o gestire account.':'Potrà creare e gestire gli account, ma non vedrà i dati finanziari degli altri utenti. Un amministratore non può essere disattivato o eliminato finché non torna utente.'}</small>
    {changeRole.isError&&<p className="form-error" role="alert">{changeRole.error instanceof ApiError&&changeRole.error.code==='USER_MUST_BE_ACTIVE'?'Riattiva l’account prima di renderlo amministratore.':'Operazione non riuscita.'}</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setView('menu')} disabled={changeRole.isPending}>Indietro</button><button type="button" className="btn" onClick={()=>changeRole.mutate()} disabled={changeRole.isPending}>{changeRole.isPending?'Salvataggio…':user.role==='admin'?'Rendi utente':'Rendi amministratore'}</button></div>
  </div>;
  if(view==='reset')return <div className="confirm-sheet">
    <span className="confirm-icon"><KeyRound aria-hidden="true"/></span>
    <p>Generare una nuova password temporanea per <strong>{user.email}</strong>?</p>
    <small>Le sessioni attive verranno chiuse e al prossimo accesso dovrà sceglierne una nuova.</small>
    {reset.isError&&<p className="form-error" role="alert">Reimpostazione della password non riuscita.</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setView('menu')} disabled={reset.isPending}>Indietro</button><button type="button" className="btn" onClick={()=>reset.mutate()} disabled={reset.isPending}>{reset.isPending?'Reimpostazione…':'Reimposta'}</button></div>
  </div>;
  if(view==='link')return <div className="confirm-sheet">
    <span className="confirm-icon"><Mail aria-hidden="true"/></span>
    <p>Inviare a <strong>{user.email}</strong> {linkPurpose==='invite'?'un nuovo invito':'un link per reimpostare la password'}?</p>
    <small>{linkPurpose==='invite'?'Il link vale 7 giorni e sostituisce quelli inviati prima.':'Il link vale 1 ora. Finché non lo usa, la password attuale continua a funzionare.'}</small>
    {sendLink.isError&&<p className="form-error" role="alert">{mailErrorMessage(sendLink.error)}</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setView('menu')} disabled={sendLink.isPending}>Indietro</button><button type="button" className="btn" onClick={()=>sendLink.mutate()} disabled={sendLink.isPending}>{sendLink.isPending?'Invio…':'Invia'}</button></div>
  </div>;
  if(view==='link-done')return <div className="confirm-sheet">
    <span className="confirm-icon"><Check aria-hidden="true"/></span>
    <p role="status">Email inviata a <strong>{user.email}</strong>.</p>
    <div className="confirm-actions"><button type="button" className="btn" onClick={onDone}>Fatto</button></div>
  </div>;
  if(typeof view==='object')return <div className="confirm-sheet left">
    <div className="credential-card"><div><span className="cap">Email</span><strong>{user.email}</strong></div><div><span className="cap">Password temporanea</span><code className="mono">{view.password}</code></div></div>
    <p className="notice est"><TriangleAlert aria-hidden="true"/>La password viene mostrata una sola volta.</p>
    {copy==='copied'&&<p className="status-message" role="status">Credenziali copiate negli appunti.</p>}
    {copy==='error'&&<p className="form-error" role="alert">Copia non riuscita. Copia i valori manualmente.</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>void copyPassword(view.password)}>{copy==='copied'?<Check aria-hidden="true"/>:<Copy aria-hidden="true"/>}{copy==='copied'?'Copiate':'Copia credenziali'}</button><button type="button" className="btn" onClick={onDone}>Fatto</button></div>
  </div>;
  if(view==='status')return <div className="confirm-sheet">
    <span className={`confirm-icon${user.isActive?' danger':''}`}>{user.isActive?<UserX aria-hidden="true"/>:<UserCheck aria-hidden="true"/>}</span>
    <p>{user.isActive?'Disattivare':'Riattivare'} l’account <strong>{user.email}</strong>?</p>
    <small>{user.isActive?'L’utente verrà disconnesso subito, ma i suoi dati non saranno eliminati.':'L’utente potrà accedere di nuovo con la propria password.'}</small>
    {toggle.isError&&<p className="form-error" role="alert">Operazione non riuscita.</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setView('menu')} disabled={toggle.isPending}>Indietro</button><button type="button" className={user.isActive?'btn danger':'btn'} onClick={()=>toggle.mutate()} disabled={toggle.isPending}>{toggle.isPending?'Salvataggio…':user.isActive?'Disattiva':'Riattiva'}</button></div>
  </div>;
  if(view==='delete')return <div className="confirm-sheet">
    <span className="confirm-icon danger"><Trash2 aria-hidden="true"/></span>
    <p>Eliminare definitivamente l’account <strong>{user.email}</strong>?</p>
    <small>L’account e tutti i suoi bucket, movimenti, template e impostazioni verranno cancellati. L’operazione è irreversibile.</small>
    {remove.isError&&<p className="form-error" role="alert">{remove.error instanceof ApiError&&remove.error.code==='USER_MUST_BE_DISABLED'?'Disattiva nuovamente l’account prima di eliminarlo.':'Eliminazione definitiva non riuscita. Riprova.'}</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setView('menu')} disabled={remove.isPending}>Indietro</button><button type="button" className="btn danger" onClick={()=>remove.mutate()} disabled={remove.isPending}>{remove.isPending?'Eliminazione…':'Elimina definitivamente'}</button></div>
  </div>;

  return <div className="account-actions">
    <div className="account-who"><UserAvatar user={user} size={52}/><span className="grow"><strong className="manage-name">{displayName(user)}<span className={status.tag}>{status.label}</span></strong><small>{user.email}</small></span></div>
    <dl className="kv-list">
      <div><dt className="cap">Ruolo</dt><dd>{user.role==='admin'?'Amministratore':'Utente'}</dd></div>
      <div><dt className="cap">Creato</dt><dd className="mono">{dateFormatter.format(new Date(user.createdAt))}</dd></div>
      <div><dt className="cap">Dati finanziari</dt><dd className="mu with-icon"><LockKeyhole aria-hidden="true"/>Non visibili</dd></div>
    </dl>
    {self?<p className="sub-note">Questo è il tuo account: puoi modificarlo da Profilo.</p>:user.role==='admin'?<div className="option-list">
      <button type="button" className="option" onClick={()=>{changeRole.reset();setView('role')}}><span className="option-icon"><ShieldOff aria-hidden="true"/></span><span className="grow"><strong>Rendi utente</strong><small>Toglie i permessi di amministratore</small></span><ChevronRight aria-hidden="true"/></button>
      <p className="sub-note with-icon"><ShieldCheck aria-hidden="true"/>Per modificare, disattivare o eliminare un amministratore rendilo prima utente.</p>
    </div>:<div className="option-list">
      <button type="button" className="option" onClick={()=>{edit.reset();setView('edit')}}><span className="option-icon"><Pencil aria-hidden="true"/></span><span className="grow"><strong>Modifica dati</strong><small>Nome, cognome ed email</small></span><ChevronRight aria-hidden="true"/></button>
      {user.isActive&&<button type="button" className="option" onClick={()=>{sendLink.reset();setView('link')}}><span className="option-icon"><Mail aria-hidden="true"/></span><span className="grow"><strong>{user.mustChangePassword?'Reinvia invito':'Invia link per la password'}</strong><small>L’utente sceglie la password da un link via email</small></span><ChevronRight aria-hidden="true"/></button>}
      <button type="button" className="option" onClick={()=>setView('reset')}><span className="option-icon"><KeyRound aria-hidden="true"/></span><span className="grow"><strong>Reimposta password</strong><small>Genera una nuova password temporanea</small></span><ChevronRight aria-hidden="true"/></button>
      {user.isActive&&<button type="button" className="option" onClick={()=>{changeRole.reset();setView('role')}}><span className="option-icon"><ShieldCheck aria-hidden="true"/></span><span className="grow"><strong>Rendi amministratore</strong><small>Potrà creare e gestire gli account</small></span><ChevronRight aria-hidden="true"/></button>}
      <button type="button" className={`option${user.isActive?' neg':''}`} onClick={()=>setView('status')}><span className="option-icon">{user.isActive?<UserX aria-hidden="true"/>:<UserCheck aria-hidden="true"/>}</span><span className="grow"><strong>{user.isActive?'Disattiva account':'Riattiva account'}</strong><small>{user.isActive?'Blocca l’accesso, conserva i dati':'Consente di nuovo l’accesso'}</small></span><ChevronRight aria-hidden="true"/></button>
      {canDelete&&<button type="button" className="option neg" onClick={()=>{remove.reset();setView('delete')}}><span className="option-icon"><Trash2 aria-hidden="true"/></span><span className="grow"><strong>Elimina definitivamente</strong><small>Cancella l’utente e tutti i suoi dati</small></span><ChevronRight aria-hidden="true"/></button>}
    </div>}
  </div>;
}

export function AccountCreatePage(){
  const qc=useQueryClient();
  const navigate=useNavigate();
  const [email,setEmail]=useState('');
  const [firstName,setFirstName]=useState('');
  const [lastName,setLastName]=useState('');
  const [role,setRole]=useState<ManagedUser['role']>('user');
  const [delivery,setDelivery]=useState<'invite'|'password'>('invite');
  const [password,setPassword]=useState(()=>generatePassword());
  const [error,setError]=useState('');
  const [created,setCreated]=useState<{user:ManagedUser;password:string}|null>(null);
  const [invited,setInvited]=useState<{user:ManagedUser;sent:boolean}|null>(null);
  const [copy,setCopy]=useState<CopyStatus>('idle');
  const create=useMutation({
    mutationFn:()=>api<{user:ManagedUser;inviteSent?:boolean}>('/admin/users',{method:'POST',body:JSON.stringify({email,...(delivery==='password'?{temporaryPassword:password}:{}),firstName:firstName.trim()||null,lastName:lastName.trim()||null,role})}),
    onSuccess:async result=>{
      await qc.invalidateQueries({queryKey:['admin-users']});setCopy('idle');
      if(delivery==='invite')setInvited({user:result.user,sent:result.inviteSent===true});
      else setCreated({user:result.user,password});
    },
    onError:caught=>setError(caught instanceof ApiError&&caught.code==='ALREADY_EXISTS'?'Esiste già un account con questa email.':caught instanceof ApiError&&caught.code==='MAIL_NOT_CONFIGURED'?mailErrorMessage(caught):'Creazione dell’account non riuscita.'),
  });

  function submit(event:FormEvent){
    event.preventDefault();setError('');
    if(delivery==='password'&&password.length<MIN_PASSWORD_LENGTH){setError(`La password temporanea deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`);return}
    create.mutate();
  }
  async function copyCredentials(target:'all'|'email'|'password'){
    if(!created)return;
    const text=target==='email'?created.user.email:target==='password'?created.password:`Link app: ${window.location.origin}\nEmail: ${created.user.email}\nPassword temporanea: ${created.password}`;
    try{await navigator.clipboard.writeText(text);setCopy('copied')}catch{setCopy('error')}
  }

  if(invited)return <SettingsPanel cap="Account · Creato" title="Account creato" back={LIST_PATH} closeIcon footer={<button type="button" className="btn" onClick={()=>navigate(LIST_PATH)}>Fatto</button>}>
    <span className="success-badge" aria-hidden="true">{invited.sent?<Mail/>:<Check/>}</span>
    {invited.sent
      ?<p className="sub-lead center" role="status">Abbiamo inviato un invito a <strong>{invited.user.email}</strong>. Il link vale 7 giorni: {invited.user.firstName?`${invited.user.firstName} sceglierà`:'l’utente sceglierà'} da lì la propria password.</p>
      :<p className="notice est" role="alert"><TriangleAlert aria-hidden="true"/>L’account è stato creato, ma l’invito non è stato consegnato. Puoi reinviarlo dall’elenco account.</p>}
  </SettingsPanel>;

  if(created)return <SettingsPanel cap="Account · Creato" title="Account creato" back={LIST_PATH} closeIcon footer={<div className="foot-stack"><button type="button" className="btn outline" onClick={()=>void copyCredentials('all')}>{copy==='copied'?<Check aria-hidden="true"/>:<Copy aria-hidden="true"/>}{copy==='copied'?'Credenziali copiate':'Copia tutte le credenziali'}</button><button type="button" className="btn" onClick={()=>navigate(LIST_PATH)}>Fatto</button></div>}>
    <span className="success-badge" aria-hidden="true"><Check/></span>
    <p className="sub-lead center">Consegna queste credenziali {created.user.firstName?`a ${created.user.firstName}`:'al nuovo utente'}. Al primo accesso verrà chiesto di scegliere una nuova password.</p>
    <div className="credential-card" aria-label="Credenziali del nuovo account">
      <div><span className="cap">Email</span><strong>{created.user.email}</strong><button type="button" className="act-btn" onClick={()=>void copyCredentials('email')} aria-label="Copia email"><Copy aria-hidden="true"/></button></div>
      <div><span className="cap">Password temporanea</span><code className="mono">{created.password}</code><button type="button" className="act-btn" onClick={()=>void copyCredentials('password')} aria-label="Copia password"><Copy aria-hidden="true"/></button></div>
      <div><span className="cap">Ruolo</span><strong>{created.user.role==='admin'?'Amministratore':'Utente'}</strong></div>
    </div>
    <p className="notice est"><TriangleAlert aria-hidden="true"/>La password viene mostrata una sola volta. Se la perdi potrai generarne una nuova dall’elenco account.</p>
    {copy==='copied'&&<p className="status-message" role="status">Copiato negli appunti.</p>}
    {copy==='error'&&<p className="form-error" role="alert">Copia non riuscita. Riprova oppure copia i valori manualmente.</p>}
  </SettingsPanel>;

  return <SettingsPanel cap="Account · Nuovo" title="Nuovo account" back={LIST_PATH} closeIcon lead="Non c’è registrazione pubblica: crei tu l’accesso e lo consegni via email o con una password temporanea." footer={<button type="submit" form="account-form" className="btn" disabled={create.isPending}>{create.isPending?'Creazione…':delivery==='invite'?'Crea e invia invito':'Crea account'}</button>}>
    <form id="account-form" className="sub-form" onSubmit={submit}>
      <div className="grid-2">
        <label className="field"><span className="cap">Nome</span><span className="input on-surface"><input name="firstName" value={firstName} onChange={event=>setFirstName(event.target.value)} maxLength={60} autoComplete="off"/></span></label>
        <label className="field"><span className="cap">Cognome</span><span className="input on-surface"><input name="lastName" value={lastName} onChange={event=>setLastName(event.target.value)} maxLength={60} autoComplete="off"/></span></label>
      </div>
      <label className="field"><span className="cap">Email di accesso</span><span className="input on-surface"><input name="email" type="email" autoComplete="off" required value={email} onChange={event=>{setEmail(event.target.value);setError('')}} placeholder="nome@esempio.it"/></span></label>
      <div className="field"><span className="cap" id="account-delivery">Accesso</span><div className="role-cards" role="radiogroup" aria-labelledby="account-delivery">
        <button type="button" role="radio" aria-checked={delivery==='invite'} className="role-card" onClick={()=>{setDelivery('invite');setError('')}}><strong>Invito via email</strong><small>L’utente sceglie la password da un link</small></button>
        <button type="button" role="radio" aria-checked={delivery==='password'} className="role-card" onClick={()=>{setDelivery('password');setError('')}}><strong>Password temporanea</strong><small>La consegni tu all’utente</small></button>
      </div></div>
      {delivery==='password'&&<div className="field"><label className="cap" htmlFor="temporary-password">Password temporanea</label><span className="input on-surface"><KeyRound aria-hidden="true"/><input id="temporary-password" name="temporaryPassword" className="mono" autoComplete="off" spellCheck={false} minLength={MIN_PASSWORD_LENGTH} maxLength={128} required value={password} onChange={event=>{setPassword(event.target.value);setError('')}}/><button type="button" className="act-btn" onClick={()=>{setPassword(generatePassword());setError('')}} aria-label="Genera una nuova password" title="Genera"><RefreshCw aria-hidden="true"/></button></span><small className="field-note">Generata in automatico, puoi anche scriverne una tu (almeno {MIN_PASSWORD_LENGTH} caratteri). Andrà cambiata al primo accesso.</small></div>}
      <div className="field"><span className="cap" id="account-role">Ruolo</span><div className="role-cards" role="radiogroup" aria-labelledby="account-role">
        <button type="button" role="radio" aria-checked={role==='user'} className="role-card" onClick={()=>setRole('user')}><strong>Utente</strong><small>Gestisce solo il proprio patrimonio</small></button>
        <button type="button" role="radio" aria-checked={role==='admin'} className="role-card" onClick={()=>setRole('admin')}><strong>Admin</strong><small>Può anche creare e gestire account</small></button>
      </div><small className="field-note">Il nuovo account parte vuoto: nessuno vede i dati finanziari degli altri.</small></div>
      {error&&<p className="form-error" role="alert">{error}</p>}
    </form>
  </SettingsPanel>;
}
