import { useState,type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight,LogOut } from 'lucide-react';
import { PasswordInput } from '../components/PasswordInput';
import { api,ApiError } from '../lib/api';
import { resetSessionData } from '../lib/queryInvalidation';
import { useMobileLayout } from '../lib/useMobileLayout';
import type { CurrentUser } from '../types';
import { BrandMark } from '../components/BrandMark';

export function RequiredPasswordChange({user}:{user:CurrentUser}){
  const qc=useQueryClient();
  const mobile=useMobileLayout();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    const currentPassword=String(data.get('currentPassword')??'');
    const newPassword=String(data.get('newPassword')??'');
    const confirmation=String(data.get('confirmation')??'');
    if(newPassword!==confirmation){setError('Le nuove password non coincidono.');return}
    setBusy(true);setError('');
    try{
      await api('/profile/password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      qc.setQueryData<{user:CurrentUser}>(['me'],current=>current?{user:{...current.user,mustChangePassword:false}}:current);
    }catch(caught){
      setError(caught instanceof ApiError&&caught.code==='CURRENT_PASSWORD_INVALID'
        ?'La password temporanea non è corretta.'
        :caught instanceof ApiError&&caught.code==='PASSWORD_UNCHANGED'
          ?'La nuova password deve essere diversa da quella temporanea.'
          :'Non è stato possibile aggiornare la password.');
    }finally{setBusy(false)}
  }

  async function logout(){
    await api('/auth/logout',{method:'POST'});
    resetSessionData(qc);
  }

  const form=<form className="login-card" onSubmit={submit}>
    <div><span className="cap">Primo accesso</span><h2>Crea la tua password</h2><p className="login-note left">{user.email}</p></div>
    <label className="field"><span className="cap">Password temporanea</span><PasswordInput name="currentPassword" autoComplete="current-password" required/></label>
    <label className="field"><span className="cap">Nuova password</span><PasswordInput name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required/><small className="mu">Almeno 12 caratteri.</small></label>
    <label className="field"><span className="cap">Ripeti nuova password</span><PasswordInput name="confirmation" autoComplete="new-password" minLength={12} maxLength={128} required/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="btn with-arrow" disabled={busy}>{busy?'Salvataggio…':'Imposta password e continua'}<span className="btn-arrow" aria-hidden="true"><ArrowRight/></span></button>
    <button className="btn outline" type="button" onClick={logout}><LogOut/>Esci</button>
  </form>;

  if(mobile)return <main className="login login-mobile">
    <div className="login-brand"><BrandMark className="brand-mark"/><span className="cap">WorthSplit</span></div>
    <h1>Proteggi il tuo<br/><span className="highlight">account.</span></h1>
    <p className="login-lead">Sostituisci la password temporanea scelta dall’amministratore.</p>
    <div className="flow-spacer"/>
    {form}
  </main>;

  return <main className="login login-desktop">
    <section className="login-hero">
      <div className="login-hero-top"><span className="login-wordmark">WorthSplit</span><span className="cap">Privato · per invito</span></div>
      <h1>Proteggi il tuo<br/>nuovo account.</h1>
      <p className="login-hero-lead">Prima di continuare, sostituisci la password temporanea scelta dall’amministratore.</p>
    </section>
    <section className="login-form-side">{form}</section>
  </main>;
}
