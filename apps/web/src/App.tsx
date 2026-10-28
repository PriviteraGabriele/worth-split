import { lazy,Suspense,useEffect } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { Navigate,Route,Routes,useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { Layout } from './components/Layout';
import { AsyncBoundary,reloadApplication } from './components/AsyncBoundary';
import { AmountPrivacyProvider } from './lib/amountPrivacy';
import type { CurrentUser } from './types';
import { BrandMark } from './components/BrandMark';

const Login=lazy(()=>import('./pages/Login').then(module=>({default:module.Login})));
const Home=lazy(()=>import('./pages/Home').then(module=>({default:module.Home})));
const History=lazy(()=>import('./pages/History').then(module=>({default:module.History})));
const Trends=lazy(()=>import('./pages/Trends').then(module=>({default:module.Trends})));
const Settings=lazy(()=>import('./pages/Settings').then(module=>({default:module.Settings})));
const PlannedExpenses=lazy(()=>import('./pages/PlannedExpenses').then(module=>({default:module.PlannedExpenses})));
const BucketDetail=lazy(()=>import('./pages/BucketDetail').then(module=>({default:module.BucketDetail})));
const MoveMoney=lazy(()=>import('./pages/MoveMoney').then(module=>({default:module.MoveMoney})));
const PlannedPayment=lazy(()=>import('./pages/PlannedPayment').then(module=>({default:module.PlannedPayment})));
const PlannedWizard=lazy(()=>import('./pages/PlannedWizard').then(module=>({default:module.PlannedWizard})));
const RequiredPasswordChange=lazy(()=>import('./pages/RequiredPasswordChange').then(module=>({default:module.RequiredPasswordChange})));
const ResetPassword=lazy(()=>import('./pages/ResetPassword').then(module=>({default:module.ResetPassword})));

function RouteFallback(){return <div className="screen"><div className="skeleton card"/></div>}
function RouteLoadError(){return <div className="screen"><div className="state"><h2>Impossibile aprire questa schermata</h2><p>Riprova a caricare l’app.</p><button className="primary" onClick={reloadApplication}>Ricarica</button></div></div>}
function withFallback(element:React.ReactNode){return <AsyncBoundary fallback={<RouteLoadError/>}><Suspense fallback={<RouteFallback/>}>{element}</Suspense></AsyncBoundary>}

export function App(){
  const qc=useQueryClient();
  const location=useLocation();
  const me=useQuery({queryKey:['me'],queryFn:({signal})=>api<{user:CurrentUser}>('/auth/me',{signal}),retry:false});
  useEffect(()=>{
    if(!me.isError)return;
    qc.removeQueries({type:'inactive',predicate:query=>query.queryKey[0]!=='me'});
  },[me.isError,qc]);
  // Links from invitation and reset e-mails work with or without a session.
  if(location.pathname==='/reimposta-password')return withFallback(<ResetPassword/>);
  if(me.isLoading)return <div className="splash"><BrandMark className="brand-mark" label="WorthSplit"/></div>;
  if(me.isError)return <Routes><Route path="/login" element={withFallback(<Login/>)}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes>;
  if(me.data!.user.mustChangePassword)return withFallback(<RequiredPasswordChange user={me.data!.user}/>);
  return <AmountPrivacyProvider><Routes><Route element={<Layout user={me.data!.user}/>}><Route index element={withFallback(<Home/>)}/><Route path="previsioni" element={withFallback(<PlannedExpenses/>)}/><Route path="previsioni/nuova" element={withFallback(<PlannedWizard/>)}/><Route path="previsioni/:id/modifica" element={withFallback(<PlannedWizard/>)}/><Route path="previsioni/:id/pagamento" element={withFallback(<PlannedPayment/>)}/><Route path="bucket/:id" element={withFallback(<BucketDetail/>)}/><Route path="sposta/:mode" element={withFallback(<MoveMoney/>)}/><Route path="andamento" element={withFallback(<Trends/>)}/><Route path="storico" element={withFallback(<History/>)}/><Route path="impostazioni/*" element={withFallback(<Settings user={me.data!.user}/>)}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AmountPrivacyProvider>;
}
