import { useMemo,useState,type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check,ChevronLeft,ChevronRight,PencilLine,Plus,WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatEuro } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { useMobileLayout } from '../lib/useMobileLayout';
import { byPendingDescending,daysInMonth,dueDayOf,dueDescription,formatMonth,monthName,pendingAmount,plannedSummary,shiftMonth,shortMonth,todayMonth } from '../lib/planned';
import type { Dashboard,PlannedExpense,PlannedExpensesResponse } from '../types';
import { Money } from '../components/Money';
import { PlannedExpenseDetails,PlannedExpenseSummary } from '../components/PlannedExpenseDialogs';

type Dialog={kind:'details';expense:PlannedExpense}|{kind:'summary';summary:'pending'|'actual'}|null;
const emptyExpenses:PlannedExpense[]=[];
const weekdays=['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];

export function PlannedExpenses(){
  const {hidden}=useAmountPrivacy();
  const mobile=useMobileLayout();
  const [month,setMonth]=useState(todayMonth);
  const [dialog,setDialog]=useState<Dialog>(null);
  const [showPaid,setShowPaid]=useState(false);
  const planned=useQuery({queryKey:['planned-expenses',month],queryFn:({signal})=>api<PlannedExpensesResponse>(`/planned-expenses?${new URLSearchParams({month})}`,{signal})});
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal}),enabled:!mobile});
  const expenses=planned.data?.expenses??emptyExpenses;
  const summary=useMemo(()=>plannedSummary(expenses),[expenses]);
  const open=useMemo(()=>[...summary.open].sort(byPendingDescending),[summary.open]);
  const currentMonth=todayMonth();
  const progress=summary.actual+summary.pending>0n?Number(summary.actual*1000n/(summary.actual+summary.pending))/10:0;
  const payLink=(expense:PlannedExpense)=>`/previsioni/${expense.id}/pagamento?mese=${month}`;

  const heroTile=<section className="hero-tile planned-hero" aria-label="Riepilogo del mese">
    <div className="row-between bottom">
      <button type="button" className="planned-hero-main" onClick={()=>setDialog({kind:'summary',summary:'pending'})}><span className="cap">Da pagare · {summary.pendingIncluded.length}</span><Money className="mono planned-hero-amount" cents={summary.pending} hidden={hidden}/><span className="sr-only">{summary.pendingIncluded.length===1?'1 spesa da pagare':`${summary.pendingIncluded.length} spese da pagare`}</span></button>
      {mobile&&<button type="button" className="planned-hero-side" onClick={()=>setDialog({kind:'summary',summary:'actual'})} aria-label={`Registrato ${formatEuro(summary.actual,hidden)}`}><span className="cap">Registrato</span><span className="mono">{formatEuro(summary.actual,hidden)}</span></button>}
    </div>
    <div className="progress on-hero" aria-hidden="true"><span style={{width:`${progress}%`}}/></div>
    {!mobile&&dashboard.data&&<div className="row-between mono planned-hero-foot"><button type="button" onClick={()=>setDialog({kind:'summary',summary:'actual'})} aria-label={`Registrato ${formatEuro(summary.actual,hidden)}`}>Registrato {formatEuro(summary.actual,hidden)}</button><span>Dopo {formatEuro(BigInt(dashboard.data.totalCents)-summary.pending,hidden)}</span></div>}
  </section>;
  const openList=open.length===0
    ?<div className="empty"><h3>Nessuna spesa da pagare</h3><p>Aggiungi abbonamenti, rate o stime per vedere qui cosa resta da pagare.</p><Link className="btn sm" to="/previsioni/nuova">Nuova spesa</Link></div>
    :<div className="ex-list">{open.map(expense=><ExpenseRow key={expense.id} expense={expense} hidden={hidden} onDetails={()=>setDialog({kind:'details',expense})} payTo={payLink(expense)}/>)}</div>;
  const paidList=summary.completed.length>0&&(showPaid||!mobile)&&<section aria-label="Spese pagate"><div className="row-between section-row"><span className="cap">Pagate · {summary.completed.length}</span></div><div className="ex-list">{summary.completed.map(expense=><ExpenseRow key={expense.id} expense={expense} hidden={hidden} onDetails={()=>setDialog({kind:'details',expense})}/>)}</div></section>;
  const loading=planned.isLoading?<div className="skeleton card"/>:planned.isError?<div className="state"><WifiOff/><h2>Impossibile caricare le previsioni</h2><p>Controlla la connessione e riprova.</p><button className="primary" onClick={()=>void planned.refetch()}>Riprova</button></div>:null;
  const dialogs=<>
    {dialog?.kind==='details'&&<PlannedExpenseDetails expense={dialog.expense} month={month} onClose={()=>setDialog(null)}/>}
    {dialog?.kind==='summary'&&<PlannedExpenseSummary expenses={expenses} summary={dialog.summary} month={month} onClose={()=>setDialog(null)}/>}
  </>;

  if(mobile){
    const chips=[-1,0,1,2,3].map(offset=>shiftMonth(month,offset));
    return <div className="screen planned">
      <header className="screen-head"><h1>Previsioni</h1><Link className="ib ink" to={`/previsioni/nuova?mese=${month}`} aria-label="Nuova spesa prevista"><Plus aria-hidden="true"/></Link></header>
      <div className="chip-row month-chips" role="group" aria-label="Mese visualizzato">
        {chips.map((value,index)=>{
          const selected=index===1;
          const label=selected?monthName(value):`${shortMonth(value)}${value.slice(0,4)!==month.slice(0,4)?` ${value.slice(2,4)}`:''}`;
          return <button key={value} type="button" className={`month-chip${selected?' on':''}`} onClick={()=>setMonth(value)} aria-pressed={selected} aria-label={index===0?'Mese precedente':index===2?'Mese successivo':formatMonth(value)}>{label}</button>;
        })}
        {month!==currentMonth&&<button type="button" className="month-chip" onClick={()=>setMonth(currentMonth)}>Oggi</button>}
      </div>
      {loading??<>
        {heroTile}
        <div className="row-between section-row"><span className="cap">Aperte · per residuo</span>{summary.completed.length>0&&<button type="button" className="cap paid-toggle" aria-pressed={showPaid} onClick={()=>setShowPaid(value=>!value)}>Pagate {summary.completed.length}</button>}</div>
        {openList}
        {paidList}
      </>}
      {dialogs}
    </div>;
  }

  return <div className="screen planned planned-desktop">
    <header className="desk-head">
      <div className="desk-head-title"><h1>Previsioni</h1><div className="month-pill mono"><button type="button" onClick={()=>setMonth(value=>shiftMonth(value,-1))} aria-label="Mese precedente"><ChevronLeft aria-hidden="true"/></button><span>{formatMonth(month)}</span><button type="button" onClick={()=>setMonth(value=>shiftMonth(value,1))} aria-label="Mese successivo"><ChevronRight aria-hidden="true"/></button></div>{month!==currentMonth&&<button type="button" className="chip" onClick={()=>setMonth(currentMonth)}>Oggi</button>}</div>
      <Link className="btn sm" to={`/previsioni/nuova?mese=${month}`}><Plus aria-hidden="true"/>Nuova spesa</Link>
    </header>
    {loading??<div className="planned-layout">
      <section className="tile calendar-tile"><Calendar month={month} expenses={expenses} hidden={hidden} onSelect={expense=>setDialog({kind:'details',expense})}/></section>
      <aside className="planned-side">
        {heroTile}
        <section className="tile"><span className="cap">Aperte · per residuo</span>{openList}</section>
        {paidList&&<section className="tile">{paidList}</section>}
      </aside>
    </div>}
    {dialogs}
  </div>;
}

function ExpenseRow({expense,hidden,onDetails,payTo}:{expense:PlannedExpense;hidden:boolean;onDetails:()=>void;payTo?:string}){
  const completed=expense.status==='completed';
  const fixed=expense.amountMode==='fixed';
  const excluded=!expense.includedInEstimatedTotal;
  const actual=BigInt(expense.actualAmountCents);
  const shown=completed?actual:pendingAmount(expense);
  const partial=!completed&&!fixed&&actual>0n;
  return <article className={`ex${completed?' is-completed':''}${excluded?' is-excluded':''}`} style={{'--stripe':expense.bucketColor??'var(--ink)'} as CSSProperties}>
    <button type="button" className="ex-main" onClick={onDetails} aria-label={`Dettagli ${expense.name}`}>
      <i className="ex-stripe" aria-hidden="true"/>
      <span className="ex-text">
        <span className="ex-title"><h3>{expense.name}</h3>{completed?<span className="tag">Pagata</span>:excluded?<span className="tag off">Esclusa</span>:<span className={`tag${fixed?'':' est'}`}>{fixed?'Fissa':'Stimata'}</span>}</span>
        <span className="ex-meta">{expense.bucketName} · {dueDescription(expense)}</span>
      </span>
      <span className="ex-amount" aria-label={partial?`${formatEuro(shown,hidden)} da pagare, ${formatEuro(actual,hidden)} già registrati`:undefined}><span className="mono">{formatEuro(shown,hidden)}</span>{partial&&<span className="mono ex-paid"><i/>{formatEuro(actual,hidden)}</span>}</span>
    </button>
    {completed?<span className="ex-done" aria-label="Saldata"><Check aria-hidden="true"/></span>:!excluded&&payTo&&<Link className="ex-pay" to={payTo} aria-label={fixed?`Salda ${expense.name}`:`Registra importo reale per ${expense.name}`}>{fixed?<Check aria-hidden="true"/>:<PencilLine aria-hidden="true"/>}</Link>}
  </article>;
}

function Calendar({month,expenses,hidden,onSelect}:{month:string;expenses:PlannedExpense[];hidden:boolean;onSelect:(expense:PlannedExpense)=>void}){
  const [year,monthNumber]=month.split('-').map(Number);
  const firstWeekday=(new Date(year??0,(monthNumber??1)-1,1).getDay()+6)%7;
  const days=daysInMonth(month);
  const today=new Date();
  const isCurrent=todayMonth()===month;
  const byDay=new Map<number,PlannedExpense[]>();
  const undated:PlannedExpense[]=[];
  for(const expense of expenses){
    const day=dueDayOf(expense,month);
    if(day===null)undated.push(expense);
    else byDay.set(day,[...(byDay.get(day)??[]),expense]);
  }
  const cells=Math.ceil((firstWeekday+days)/7)*7;
  return <>
    <div className="cal-head">{weekdays.map(day=><span key={day} className="cap">{day}</span>)}</div>
    <div className="cal-grid">{Array.from({length:cells},(_,index)=>{
      const day=index-firstWeekday+1;
      const inMonth=day>=1&&day<=days;
      return <div key={index} className={`cal-cell${inMonth?'':' out'}${isCurrent&&day===today.getDate()?' today':''}`}>
        {inMonth&&<span className="mono cal-day">{day}</span>}
        {inMonth&&(byDay.get(day)??[]).map(expense=><button type="button" key={expense.id} className={`cal-event${expense.status==='completed'?' done':''}`} style={{borderColor:expense.bucketColor??'var(--ink)'}} onClick={()=>onSelect(expense)}>{expense.name} {formatEuro(expense.status==='completed'?expense.actualAmountCents:pendingAmount(expense),hidden).replace(',00','')}</button>)}
      </div>;
    })}</div>
    {undated.length>0&&<div className="cal-undated"><span className="cap">Nel mese, senza data</span>{undated.map(expense=><button type="button" key={expense.id} className={`cal-event${expense.status==='completed'?' done':''}`} style={{borderColor:expense.bucketColor??'var(--ink)'}} onClick={()=>onSelect(expense)}>{expense.name} {formatEuro(expense.status==='completed'?expense.actualAmountCents:pendingAmount(expense),hidden)}</button>)}</div>}
  </>;
}
