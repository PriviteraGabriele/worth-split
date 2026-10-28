import { useState,type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api,ApiError } from '../lib/api';
import { PasswordInput } from '../components/PasswordInput';
import { useMobileLayout } from '../lib/useMobileLayout';
import type { CurrentUser } from '../types';
import { BrandMark } from '../components/BrandMark';

function loginErrorMessage(caught:unknown){
  if(caught instanceof ApiError&&caught.code==='ACCOUNT_DISABLED')return 'Questo account è stato disattivato. Contatta l’amministratore.';
  if(caught instanceof ApiError&&caught.status===429)return 'Troppi tentativi di accesso. Riprova tra qualche minuto.';
  return 'Email o password non corretti.';
}

export function Login(){
  const qc=useQueryClient();
  const mobile=useMobileLayout();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [mode,setMode]=useState<'login'|'forgot'|'sent'>('login');
  const [email,setEmail]=useState('');

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);
    setError('');
    const data=new FormData(event.currentTarget);
    try{
      const result=await api<{user:CurrentUser}>('/auth/login',{method:'POST',body:JSON.stringify({email:data.get('email'),password:data.get('password')})});
      qc.removeQueries({predicate:query=>query.queryKey[0]!=='me'});
      qc.getMutationCache().clear();
      qc.setQueryData(['me'],result);
    }catch(caught){
      setError(loginErrorMessage(caught));
    }finally{
      setBusy(false);
    }
  }

  // The answer is the same whether or not the address has an account.
  async function requestReset(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setBusy(true);
    setError('');
    try{
      await api('/auth/password-reset/request',{method:'POST',body:JSON.stringify({email})});
      setMode('sent');
    }catch(caught){
      setError(caught instanceof ApiError&&caught.status===429?'Troppe richieste. Riprova tra qualche minuto.':'Richiesta non riuscita. Riprova.');
    }finally{
      setBusy(false);
    }
  }

  function showMode(next:typeof mode){setError('');setMode(next)}

  const form=mode==='sent'?<div className="login-card">
    <div><span className="cap">Recupero password</span><h2>Controlla la posta</h2></div>
    <p className="login-note left" role="status">Se <strong>{email}</strong> corrisponde a un account attivo, riceverai un’email con il link per scegliere una nuova password. Il link vale 1 ora.</p>
    <button type="button" className="btn outline" onClick={()=>showMode('login')}>Torna all’accesso</button>
  </div>:mode==='forgot'?<form className="login-card" onSubmit={requestReset}>
    <div><span className="cap">Recupero password</span><h2>Password dimenticata</h2></div>
    <p className="login-note left">Inserisci l’email del tuo account: ti invieremo un link per sceglierne una nuova.</p>
    <label className="field"><span className="cap">Email</span><span className="input"><input name="email" type="email" autoComplete="email" enterKeyHint="send" required value={email} onChange={event=>setEmail(event.target.value)}/></span></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="btn with-arrow" disabled={busy}>{busy?'Invio…':'Invia link'}<span className="btn-arrow" aria-hidden="true"><ArrowRight/></span></button>
    <button type="button" className="text-btn center" onClick={()=>showMode('login')}>Torna all’accesso</button>
  </form>:<form className="login-card" onSubmit={submit}>
    {!mobile&&<div><span className="cap">Accesso</span><h2>Bentornato</h2></div>}
    <label className="field"><span className="cap">Email</span><span className="input"><input name="email" type="email" autoComplete="email" enterKeyHint="next" required value={email} onChange={event=>setEmail(event.target.value)}/></span></label>
    <label className="field"><span className="cap">Password</span><PasswordInput name="password" autoComplete="current-password" enterKeyHint="go" required/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="btn with-arrow" disabled={busy}>{busy?'Accesso…':'Accedi'}<span className="btn-arrow" aria-hidden="true"><ArrowRight/></span></button>
    <button type="button" className="text-btn center" onClick={()=>showMode('forgot')}>Password dimenticata?</button>
    <p className="login-note">{mobile?'Account creati dall’amministratore':'Gli account vengono creati dall’amministratore.'}</p>
  </form>;

  if(mobile)return <main className="login login-mobile">
    <div className="login-brand"><BrandMark className="brand-mark"/><span className="cap">WorthSplit</span></div>
    <h1>I tuoi soldi.<br/>Finalmente<br/><span className="highlight">chiari.</span></h1>
    <p className="login-lead">Una visione semplice e privata del tuo patrimonio.</p>
    <div className="flow-spacer"/>
    {form}
  </main>;

  return <main className="login login-desktop">
    <section className="login-hero">
      <div className="login-hero-top"><span className="login-wordmark">WorthSplit</span><span className="cap">Privato · per invito</span></div>
      <h1>I tuoi soldi.<br/>Finalmente<br/>chiari.</h1>
      <div className="login-features" aria-hidden="true">
        <div><span className="cap">Bucket</span><p>Dividi il patrimonio per obiettivo</p></div>
        <div><span className="cap">Previsioni</span><p>Sai già cosa resta a fine mese</p></div>
        <div><span className="cap">Andamento</span><p>Guarda come cresce, mese per mese</p></div>
      </div>
    </section>
    <section className="login-form-side">{form}</section>
  </main>;
}
