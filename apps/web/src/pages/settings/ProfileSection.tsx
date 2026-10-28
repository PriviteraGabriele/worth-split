import { useRef,useState,type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera,Check,ChevronRight,KeyRound,LockKeyhole,X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api,ApiError } from '../../lib/api';
import { MIN_PASSWORD_LENGTH,passwordStrength } from '../../lib/password';
import { useMobileLayout } from '../../lib/useMobileLayout';
import { displayName } from '../../lib/user';
import { prepareAvatar } from '../../lib/avatarImage';
import { Avatar } from '../../components/Avatar';
import { PasswordInput } from '../../components/PasswordInput';
import type { CurrentUser } from '../../types';
import { SettingsPanel } from './SettingsPanel';

const genders=[{value:'male',label:'Uomo'},{value:'female',label:'Donna'},{value:null,label:'Non specificato'}] as const;

export function ProfilePage({user}:{user:CurrentUser}){
  const qc=useQueryClient();
  const mobile=useMobileLayout();
  const [gender,setGender]=useState<CurrentUser['gender']>(user.gender);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<{text:string;error?:boolean}|null>(null);
  const [photoBusy,setPhotoBusy]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);

  async function changePhoto(request:()=>Promise<{user:CurrentUser}>,done:string){
    setPhotoBusy(true);setMessage(null);
    try{
      qc.setQueryData(['me'],await request());
      void qc.invalidateQueries({queryKey:['admin-users']});
      setMessage({text:done});
    }catch(caught){
      const text=caught instanceof ApiError
        ?caught.code==='AVATAR_TOO_LARGE'?'L’immagine è troppo pesante.':caught.code==='AVATAR_INVALID'?'Formato non supportato: usa una foto JPG, PNG o WebP.':'Aggiornamento della foto non riuscito.'
        :(caught as Error).message||'Aggiornamento della foto non riuscito.';
      setMessage({text,error:true});
    }finally{setPhotoBusy(false)}
  }
  function upload(file:File){
    void changePhoto(async()=>api<{user:CurrentUser}>('/profile/avatar',{method:'PUT',body:JSON.stringify({image:await prepareAvatar(file)})}),'Foto profilo aggiornata.');
  }
  function removePhoto(){
    void changePhoto(()=>api<{user:CurrentUser}>('/profile/avatar',{method:'DELETE'}),'Foto profilo rimossa.');
  }

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    setBusy(true);setMessage(null);
    try{
      const result=await api<{user:CurrentUser}>('/profile',{method:'PATCH',body:JSON.stringify({
        firstName:String(data.get('firstName')??''),
        lastName:String(data.get('lastName')??''),
        gender,
      })});
      qc.setQueryData(['me'],result);
      setMessage({text:'Profilo aggiornato.'});
    }catch{setMessage({text:'Aggiornamento del profilo non riuscito.',error:true})}finally{setBusy(false)}
  }

  return <SettingsPanel cap="Profilo" title={mobile?'Profilo':'Profilo e sicurezza'} footer={<button type="submit" form="profile-form" className="btn" disabled={busy}>{busy?'Salvataggio…':'Salva profilo'}</button>}>
    <section className="hero-tile profile-hero">
      <button type="button" className="avatar-button" onClick={()=>fileInput.current?.click()} disabled={photoBusy} aria-label={user.avatarVersion?'Cambia foto profilo':'Aggiungi foto profilo'}>
        <Avatar user={user} className="settings-avatar big"/>
        <span className="avatar-badge" aria-hidden="true"><Camera/></span>
      </button>
      <div className="settings-profile-text">
        <strong>{displayName(user)}</strong><small>{user.role==='admin'?'Amministratore':'Utente'}</small>
        <span className="photo-actions"><button type="button" onClick={()=>fileInput.current?.click()} disabled={photoBusy}>{photoBusy?'Caricamento…':user.avatarVersion?'Cambia foto':'Aggiungi foto'}</button>{user.avatarVersion&&<button type="button" onClick={removePhoto} disabled={photoBusy}>Rimuovi</button>}</span>
      </div>
      <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)upload(file)}}/>
    </section>
    <form id="profile-form" className="sub-form" onSubmit={save}>
      <div className="grid-2">
        <label className="field"><span className="cap">Nome</span><span className="input on-surface"><input name="firstName" defaultValue={user.firstName??''} maxLength={60} autoComplete="given-name"/></span></label>
        <label className="field"><span className="cap">Cognome</span><span className="input on-surface"><input name="lastName" defaultValue={user.lastName??''} maxLength={60} autoComplete="family-name"/></span></label>
      </div>
      <div className="field"><label className="cap" htmlFor="profile-email">Email di accesso</label><span className="input locked"><LockKeyhole aria-hidden="true"/><input id="profile-email" value={user.email} disabled aria-describedby="profile-email-note"/></span><small id="profile-email-note" className="field-note">L’email identifica il tuo account: può cambiarla solo un amministratore.</small></div>
      <div className="field"><span className="cap" id="profile-gender">Sesso · facoltativo</span><div className="pills" role="radiogroup" aria-labelledby="profile-gender">{genders.map(option=><button key={option.label} type="button" role="radio" aria-checked={gender===option.value} onClick={()=>setGender(option.value)}>{option.label}</button>)}</div></div>
      {message&&<p className={message.error?'form-error':'status-message'} role={message.error?'alert':'status'}>{message.text}</p>}
    </form>
    {mobile
      ?<Link className="link-tile" to="/impostazioni/password"><span className="link-tile-icon"><KeyRound aria-hidden="true"/></span><span className="grow"><strong>Cambia password</strong><small>Le altre sessioni verranno disconnesse</small></span><ChevronRight aria-hidden="true"/></Link>
      :<><div className="cap sub-section">Cambia password</div><PasswordForm embedded/></>}
  </SettingsPanel>;
}

export function PasswordPage(){
  return <SettingsPanel cap="Password" title="Cambia password" back="/impostazioni/profilo" lead="Dopo il cambio verranno chiuse le sessioni aperte sugli altri dispositivi.">
    <PasswordForm/>
  </SettingsPanel>;
}

function PasswordForm({embedded=false}:{embedded?:boolean}){
  const [current,setCurrent]=useState('');
  const [next,setNext]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const strength=passwordStrength(next);
  const rules=[
    {ok:next.length>=MIN_PASSWORD_LENGTH,label:`Almeno ${MIN_PASSWORD_LENGTH} caratteri`},
    {ok:next.length>0&&next!==current,label:'Diversa dall’attuale'},
    {ok:next.length>0&&next===confirmation,label:'Le due password coincidono'},
  ];

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(next!==confirmation){setError('Le nuove password non coincidono.');return}
    setBusy(true);setError('');setMessage('');
    try{
      await api('/profile/password',{method:'POST',body:JSON.stringify({currentPassword:current,newPassword:next})});
      setCurrent('');setNext('');setConfirmation('');
      setMessage('Password aggiornata. Le altre sessioni sono state disconnesse.');
    }catch(caught){
      if(caught instanceof ApiError&&caught.code==='CURRENT_PASSWORD_INVALID')setError('La password attuale non è corretta.');
      else if(caught instanceof ApiError&&caught.code==='PASSWORD_UNCHANGED')setError('La nuova password deve essere diversa da quella attuale.');
      else setError('Cambio password non riuscito.');
    }finally{setBusy(false)}
  }

  return <form className={`sub-form${embedded?' tile':' fill'}`} onSubmit={submit} aria-busy={busy}>
    <label className="field"><span className="cap">Password attuale</span><PasswordInput name="currentPassword" autoComplete="current-password" required value={current} onChange={event=>{setCurrent(event.target.value);setError('')}}/></label>
    <label className="field"><span className="cap">Nuova password</span><PasswordInput name="newPassword" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} required value={next} onChange={event=>{setNext(event.target.value);setError('')}}/></label>
    <label className="field"><span className="cap">Ripeti la nuova password</span><PasswordInput name="confirmation" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} required value={confirmation} onChange={event=>{setConfirmation(event.target.value);setError('')}}/></label>
    <div className="strength" aria-live="polite"><span className="strength-bar" data-score={strength.score} aria-hidden="true"><i/><i/><i/><i/></span><span className="mono">{next?strength.label:'—'}</span></div>
    <ul className="rule-list">{rules.map(rule=><li key={rule.label} className={rule.ok?'ok':''}><span className="rule-dot" aria-hidden="true">{rule.ok?<Check/>:<X/>}</span>{rule.label}<span className="visually-hidden">{rule.ok?': soddisfatto':': da completare'}</span></li>)}</ul>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {message&&<p className="status-message" role="status">{message}</p>}
    {!embedded&&<div className="flow-spacer"/>}
    <button className={embedded?'btn ink sm':'btn'} disabled={busy}>{busy?'Aggiornamento…':'Aggiorna password'}</button>
  </form>;
}
