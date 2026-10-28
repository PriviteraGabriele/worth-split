import { useEffect,useLayoutEffect,useState } from 'react';
import { CalendarClock,ChartNoAxesCombined,History as HistoryIcon,House,SlidersHorizontal,type LucideIcon } from 'lucide-react';
import { Link,NavLink,Outlet,useLocation } from 'react-router-dom';
import { isEditableElement } from '../lib/viewport';
import { displayName } from '../lib/user';
import { Avatar } from './Avatar';
import type { CurrentUser } from '../types';
import { BrandMark } from './BrandMark';

type NavItem={to:string;label:string;icon:LucideIcon;end?:boolean};
const items:NavItem[]=[
  {to:'/',label:'Home',icon:House,end:true},
  {to:'/storico',label:'Movimenti',icon:HistoryIcon},
  {to:'/previsioni',label:'Previsioni',icon:CalendarClock},
  {to:'/andamento',label:'Andamento',icon:ChartNoAxesCombined},
  {to:'/impostazioni',label:'Impostazioni',icon:SlidersHorizontal},
];

// Task screens (bucket detail, move money, payments, the expense wizard,
// settings sub-pages) take the whole phone screen, so the floating
// navigation steps aside.
function isFlowPath(pathname:string){
  return pathname.startsWith('/bucket/')||pathname.startsWith('/sposta/')||/^\/impostazioni\/./.test(pathname)||/^\/previsioni\/(nuova|[^/]+\/(pagamento|modifica))/.test(pathname);
}

function scrollToTop(){
  window.scrollTo({top:0,left:0,behavior:'auto'});
  document.scrollingElement?.scrollTo({top:0,left:0,behavior:'auto'});
}

export function Layout({user}:{user:CurrentUser}){
  const [online,setOnline]=useState(navigator.onLine);
  const location=useLocation();

  useEffect(()=>{
    const on=()=>setOnline(true);
    const off=()=>setOnline(false);
    window.addEventListener('online',on);
    window.addEventListener('offline',off);
    return()=>{
      window.removeEventListener('online',on);
      window.removeEventListener('offline',off);
    };
  },[]);

  useLayoutEffect(()=>{
    // The document owns scrolling so Chrome/Safari keep pull-to-refresh.
    scrollToTop();
    const frame=requestAnimationFrame(scrollToTop);
    if(isEditableElement(document.activeElement))document.activeElement.blur();
    return()=>cancelAnimationFrame(frame);
  },[location.pathname]);

  useEffect(()=>{
    if(!('scrollRestoration' in window.history))return;
    const previous=window.history.scrollRestoration;
    window.history.scrollRestoration='manual';
    return()=>{window.history.scrollRestoration=previous};
  },[]);

  useEffect(()=>{
    const resetAfterBrowserRestore=(event:PageTransitionEvent)=>{if(event.persisted)requestAnimationFrame(scrollToTop)};
    window.addEventListener('pageshow',resetAfterBrowserRestore);
    return()=>window.removeEventListener('pageshow',resetAfterBrowserRestore);
  },[]);

  return <div className={`app-shell${isFlowPath(location.pathname)?' is-flow':''}`}>
    <nav className="app-nav" aria-label="Navigazione principale">
      <Link to="/" className="nav-brand" aria-label="WorthSplit, vai alla Home"><BrandMark/></Link>
      <div className="nav-links">{items.map(item=>{
        const Icon=item.icon;
        return <NavLink key={item.to} to={item.to} end={item.end} className="nav-link" aria-label={item.label} title={item.label}><Icon aria-hidden="true"/><span>{item.label}</span></NavLink>;
      })}</div>
      <Link to="/impostazioni" className="nav-user" aria-label={`Profilo di ${displayName(user)}`} title={displayName(user)}><Avatar user={user} className="avatar-fill"/></Link>
    </nav>
    <main><Outlet/></main>
    {!online&&<div className="offline" aria-live="polite">Offline · modifiche non disponibili</div>}
  </div>;
}
