import type { ReactNode } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { CalendarClock,Download,Eye,EyeOff,KeyRound,LayoutTemplate,LogOut,Moon,PiggyBank,Plus,RotateCcw,Sun,Users,type LucideIcon } from 'lucide-react';
import { Link,Navigate,Route,Routes,useLocation,useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { resetSessionData } from '../lib/queryInvalidation';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { useMobileLayout } from '../lib/useMobileLayout';
import { displayName } from '../lib/user';
import { Avatar } from '../components/Avatar';
import type { DistributionTemplate } from '../lib/templates';
import type { CurrentUser,Dashboard,ManagedPlannedExpense,ManagedUser } from '../types';
import { PasswordPage,ProfilePage } from './settings/ProfileSection';
import { BucketEditorPage,BucketsPage } from './settings/BucketsSection';
import { PlannedPage } from './settings/PlannedSection';
import { TemplateEditorPage,TemplatesPage } from './settings/TemplatesSection';
import { AccountCreatePage,AccountDetailPage,AccountsPage,UserAvatar } from './settings/AccountsSection';
import { BackupPage,ResetPage } from './settings/BackupSection';

const themeOptions=[{value:'light',label:'Chiaro',icon:Sun},{value:'dark',label:'Scuro',icon:Moon},{value:'system',label:'Automatico',icon:null}] as const;
const createdFormatter=new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'});

/**
 * Settings home plus its sub-pages (/impostazioni/<sezione>). Phones show a
 * sub-page full screen; desktop keeps the bento visible under a side drawer.
 */
export function Settings({user}:{user:CurrentUser}){
  const section=useParams()['*']??'';
  const mobile=useMobileLayout();
  const admin=user.role==='admin';
  const panel=<Routes>
    <Route index element={null}/>
    <Route path="profilo" element={<ProfilePage user={user}/>}/>
    <Route path="password" element={<PasswordPage/>}/>
    <Route path="bucket" element={<BucketsPage/>}/>
    <Route path="bucket/nuovo" element={<BucketEditorPage/>}/>
    <Route path="bucket/:id" element={<BucketEditorPage/>}/>
    <Route path="spese" element={<PlannedPage/>}/>
    <Route path="template" element={<TemplatesPage/>}/>
    <Route path="template/nuovo" element={<TemplateEditorPage/>}/>
    <Route path="template/:id" element={<TemplateEditorPage/>}/>
    {admin&&<Route path="account" element={<AccountsPage currentUser={user}/>}/>}
    {admin&&<Route path="account/nuovo" element={<AccountCreatePage/>}/>}
    {admin&&<Route path="account/:id" element={<AccountDetailPage currentUser={user}/>}/>}
    <Route path="backup" element={<BackupPage/>}/>
    <Route path="azzera" element={<ResetPage/>}/>
    <Route path="*" element={<Navigate to="/impostazioni" replace/>}/>
  </Routes>;
  if(mobile&&section)return panel;
  return <>
    <SettingsHome user={user}/>
    {section&&panel}
  </>;
}

function SettingsHome({user}:{user:CurrentUser}){
  const qc=useQueryClient();
  const mobile=useMobileLayout();
  const location=useLocation();
  const {theme,setTheme,hidden,toggle,isUpdating}=useAmountPrivacy();
  const admin=user.role==='admin';
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
  const templates=useQuery({queryKey:['templates'],queryFn:({signal})=>api<{templates:DistributionTemplate[]}>('/templates',{signal})});
  const plans=useQuery({queryKey:['planned-expenses','manage'],queryFn:({signal})=>api<{expenses:ManagedPlannedExpense[]}>('/planned-expenses/manage',{signal})});
  const users=useQuery({queryKey:['admin-users'],queryFn:({signal})=>api<{users:ManagedUser[]}>('/admin/users',{signal}),enabled:admin});
  const logout=useMutation({mutationFn:()=>api('/auth/logout',{method:'POST'}),onSuccess:()=>resetSessionData(qc)});
  const message=(location.state as {message?:string}|null)?.message;

  const bucketCount=dashboard.data?.buckets.length;
  const activePlans=plans.data?.expenses.filter(expense=>!expense.archivedAt).length;
  const templateCount=templates.data?.templates.length;
  const count=(value:number|undefined,one:string,many:string)=>value===undefined?'…':`${value} ${value===1?one:many}`;
  const themeChoice=<div className="pills theme-pills" role="radiogroup" aria-label="Tema">{themeOptions.map(option=>{const Icon=option.icon;return <button key={option.value} type="button" role="radio" aria-checked={theme===option.value} onClick={()=>setTheme(option.value)}>{Icon&&<Icon className="i16" aria-hidden="true"/>}{option.label}</button>})}</div>;
  const privacySwitch=<button type="button" className="switch-row" role="switch" aria-checked={hidden} onClick={toggle} disabled={isUpdating}><span>Nascondi importi</span><i aria-hidden="true"/></button>;
  const statusMessage=message&&<p className="status-message" role="status">{message}</p>;

  if(mobile)return <div className="screen settings">
    <h1 className="screen-title">Impostazioni</h1>
    <Link className="hero-tile settings-profile" to="/impostazioni/profilo" aria-label={`I tuoi dati: ${displayName(user)}`}><Avatar user={user} className="settings-avatar"/><span className="settings-profile-text"><strong>{displayName(user)}</strong><small>{user.email}</small></span>{admin&&<span className="cap">Admin</span>}</Link>
    <div className="theme-box">{themeChoice}</div>
    {statusMessage}
    <div className="tile-grid two settings-tiles">
      <SettingsTile icon={PiggyBank} title="Bucket" meta={count(bucketCount,'attivo','attivi')} to="/impostazioni/bucket"/>
      <SettingsTile icon={CalendarClock} title="Spese previste" meta={count(activePlans,'attiva','attive')} to="/impostazioni/spese"/>
      <SettingsTile icon={LayoutTemplate} title="Template" meta={count(templateCount,'salvato','salvati')} to="/impostazioni/template"/>
      <SettingsTile icon={hidden?EyeOff:Eye} title="Privacy importi" meta={hidden?'Nascosti':'Visibili'} onClick={toggle} pressed={hidden}/>
      <SettingsTile icon={KeyRound} title="Password" meta="Cambia" to="/impostazioni/password"/>
      {admin&&<SettingsTile icon={Users} title="Account" meta={count(users.data?.users.length,'utente','utenti')} to="/impostazioni/account"/>}
      <SettingsTile icon={Download} title="Backup" meta="Esporta · importa" to="/impostazioni/backup"/>
      <SettingsTile icon={RotateCcw} title="Azzera dati" meta="Irreversibile" danger to="/impostazioni/azzera"/>
      <SettingsTile icon={LogOut} title="Esci" meta="Termina sessione" danger onClick={()=>logout.mutate()}/>
    </div>
  </div>;

  return <div className="screen settings settings-desktop">
    <h1 className="screen-title">Impostazioni</h1>
    {statusMessage}
    <div className="bento">
      <section className="hero-tile s6 settings-profile-desk">
        <Avatar user={user} className="settings-avatar big"/>
        <div className="settings-profile-text"><strong>{displayName(user)}</strong><small>{user.email} · {admin?'Amministratore':'Utente'}</small></div>
        <div className="settings-profile-actions"><Link className="btn sm inverse" to="/impostazioni/profilo">Modifica profilo</Link><button type="button" className="btn sm inverse ghost" onClick={()=>logout.mutate()}><LogOut aria-hidden="true"/>Esci</button></div>
      </section>
      <section className="tile s6"><div className="cap tile-head">Tema</div>{themeChoice}{privacySwitch}</section>
      <SettingsTile icon={PiggyBank} title="Bucket" meta={count(bucketCount,'attivo','attivi')} to="/impostazioni/bucket" wide/>
      <SettingsTile icon={CalendarClock} title="Spese previste" meta={count(activePlans,'attiva','attive')} to="/impostazioni/spese" wide/>
      <SettingsTile icon={LayoutTemplate} title="Template" meta={count(templateCount,'salvato','salvati')} to="/impostazioni/template" wide/>
      <SettingsTile icon={Download} title="Backup e dati" meta="Esporta · importa · azzera" to="/impostazioni/backup" wide extra={<Link className="text-btn neg" to="/impostazioni/azzera">Azzera dati</Link>}/>
      {admin&&<section className="tile s12 users-tile">
        <div className="row-between tile-head"><div><div className="cap">Amministrazione</div><h2>Gestione account</h2></div><Link className="btn sm" to="/impostazioni/account/nuovo"><Plus aria-hidden="true"/>Crea account</Link></div>
        <div className="table-scroll"><table className="users-table">
          <thead><tr><th className="cap">Utente</th><th className="cap">Ruolo</th><th className="cap">Stato</th><th className="cap">Creato</th><th className="cap right">Azioni</th></tr></thead>
          <tbody>{(users.data?.users??[]).map(item=><tr key={item.id}>
            <td><span className="user-cell"><UserAvatar user={item} size={36}/><span><strong>{displayName(item)}</strong>{(item.firstName||item.lastName)&&<small className="mu">{item.email}</small>}</span></span></td>
            <td>{item.role==='admin'?'Amministratore':'Utente'}{item.mustChangePassword&&<small className="mu">Password temporanea</small>}</td>
            <td><span className={`status-chip mono${item.isActive?' on':''}`}>{item.isActive?'Attivo':'Disattivato'}</span></td>
            <td className="mono mu">{createdFormatter.format(new Date(item.createdAt))}</td>
            <td className="right">{item.id===user.id?<span className="mu">Tu</span>:<Link className="btn outline sm" to={`/impostazioni/account/${item.id}`} aria-label={`Gestisci ${displayName(item)}`}>Gestisci</Link>}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="note">L’amministratore gestisce gli accessi ma non vede i dati finanziari degli altri utenti.</p>
      </section>}
    </div>
  </div>;
}

function SettingsTile({icon:Icon,title,meta,to,onClick,danger,pressed,wide,extra}:{icon:LucideIcon;title:string;meta:string;to?:string;onClick?:()=>void;danger?:boolean;pressed?:boolean;wide?:boolean;extra?:ReactNode}){
  const content=<><Icon aria-hidden="true"/><span><strong>{title}</strong><span className="cap">{meta}</span></span></>;
  return <div className={`settings-tile${danger?' danger':''}${wide?' s3':''}`}>
    {to?<Link className="settings-tile-main" to={to}>{content}</Link>:<button type="button" className="settings-tile-main" onClick={onClick} aria-pressed={pressed}>{content}</button>}
    {extra}
  </div>;
}
