import { useEffect,useState,type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { PasswordInput } from '../components/PasswordInput';
import { api,ApiError } from '../lib/api';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { resetSessionData } from '../lib/queryInvalidation';
import { useMobileLayout } from '../lib/useMobileLayout';

// The link carries the token in the fragment (#token=…). Reading it must stay
// free of side effects: React may render the page, throw that render away and
// mount it again, and a token removed during the first render would be lost.
function readToken(){
  return new URLSearchParams(window.location.hash.slice(1)).get('token')??'';
}

/** Page opened from the invitation or reset e-mail to choose a password. */
export function ResetPassword(){
  const qc=useQueryClient();
  const navigate=useNavigate();
  const mobile=useMobileLayout();
  const [token]=useState(readToken);
  // Once the page is on screen the token leaves the address bar, so it does
  // not stay in the browser history.
  useEffect(()=>{
    if(window.location.hash)window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
  },[]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [done,setDone]=useState(false);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const newPassword=String(data.get('newPassword')??'');
    if(newPassword!==String(data.get('confirmation')??'')){setError('Le password non coincidono.');return}
    setBusy(true);setError('');
    try{
      await api('/auth/password-reset',{method:'POST',body:JSON.stringify({token,newPassword})});
      setDone(true);
    }catch(caught){
      setError(caught instanceof ApiError&&caught.code==='PASSWORD_TOKEN_INVALID'
        ?'Il link non è valido o è scaduto. Richiedi un nuovo link dalla pagina di accesso.'
        :caught instanceof ApiError&&caught.status===429
          ?'Troppi tentativi. Riprova tra qualche minuto.'
          :'Non è stato possibile salvare la password.');
    }finally{setBusy(false)}
  }

  // Every session was closed by the server: forget the cached account and
  // start again from the login.
  function goToLogin(){
    resetSessionData(qc);
    navigate('/login',{replace:true});
  }

  const card=done?<div className="login-card">
    <div><span className="cap">Fatto</span><h2>Password salvata</h2></div>
    <p className="login-note left" role="status">Ora puoi accedere con la nuova password.</p>
    <button type="button" className="btn with-arrow" onClick={goToLogin}>Vai all’accesso<span className="btn-arrow" aria-hidden="true"><ArrowRight/></span></button>
  </div>:!token?<div className="login-card">
    <div><span className="cap">Link non valido</span><h2>Link incompleto</h2></div>
    <p className="login-note left" role="alert">Apri il link esattamente come arrivato nell’email, oppure richiedine uno nuovo dalla pagina di accesso.</p>
    <button type="button" className="btn outline" onClick={goToLogin}>Vai all’accesso</button>
  </div>:<form className="login-card" onSubmit={submit}>
    <div><span className="cap">Password</span><h2>Scegli la password</h2></div>
    <label className="field"><span className="cap">Nuova password</span><PasswordInput name="newPassword" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} required/><small className="mu">Almeno {MIN_PASSWORD_LENGTH} caratteri.</small></label>
    <label className="field"><span className="cap">Ripeti la password</span><PasswordInput name="confirmation" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} required/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="btn with-arrow" disabled={busy}>{busy?'Salvataggio…':'Salva password'}<span className="btn-arrow" aria-hidden="true"><ArrowRight/></span></button>
    <button type="button" className="text-btn center" onClick={goToLogin}>Vai all’accesso</button>
  </form>;

  if(mobile)return <main className="login login-mobile">
    <div className="login-brand"><BrandMark className="brand-mark"/><span className="cap">WorthSplit</span></div>
    <h1>Una nuova<br/><span className="highlight">password.</span></h1>
    <p className="login-lead">Scegline una che usi solo qui.</p>
    <div className="flow-spacer"/>
    {card}
  </main>;

  return <main className="login login-desktop">
    <section className="login-hero">
      <div className="login-hero-top"><span className="login-wordmark">WorthSplit</span><span className="cap">Privato · per invito</span></div>
      <h1>Una nuova<br/>password.</h1>
      <p className="login-hero-lead">Scegline una che usi solo qui: almeno {MIN_PASSWORD_LENGTH} caratteri.</p>
    </section>
    <section className="login-form-side">{card}</section>
  </main>;
}
