import { memo,useEffect,useMemo,useRef,useState } from 'react';
import { useInfiniteQuery,useQuery } from '@tanstack/react-query';
import { ChevronLeft,ChevronRight,Clock3,GitFork,PencilLine,Scale,Search,SlidersHorizontal,ArrowRightLeft,X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatEuro } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { formatOperationAmount,operationDay,operationTime,summarizeOperation } from '../lib/operations';
import { useMobileLayout } from '../lib/useMobileLayout';
import type { Dashboard,Operation } from '../types';
import { SelectControl } from '../components/SelectControl';
import { Modal } from '../components/Modal';

const PAGE_SIZE=30;
// Desktop shows numbered pages over the loaded (and locally filtered) list.
const DESKTOP_PAGE_SIZE=20;
const monthNames=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
type Kind='all'|Operation['kind'];
const kinds:{value:Kind;label:string}[]=[{value:'all',label:'Tutti'},{value:'transfer',label:'Trasferimenti'},{value:'distribution',label:'Distribuzioni'},{value:'adjustment',label:'Rettifiche'},{value:'rebalance',label:'Ribilanciamenti'}];
const icons={transfer:ArrowRightLeft,distribution:GitFork,rebalance:Scale,adjustment:PencilLine} as const;

export function History(){
  const {hidden}=useAmountPrivacy();
  const mobile=useMobileLayout();
  const [searchParams]=useSearchParams();
  const [year,setYear]=useState('');
  const [month,setMonth]=useState('');
  const [bucketId,setBucketId]=useState(()=>searchParams.get('bucket')??'');
  const [kind,setKind]=useState<Kind>('all');
  const [query,setQuery]=useState('');
  const [searching,setSearching]=useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [pageState,setPageState]=useState({key:'',page:0});
  const loadMoreRef=useRef<HTMLDivElement>(null);
  const resultsTopRef=useRef<HTMLDivElement>(null);
  const nextPageRequested=useRef(false);
  const operationsQuery=useInfiniteQuery({
    queryKey:['operations',year,month,bucketId],
    initialPageParam:0,
    queryFn:({pageParam,signal})=>{const params=new URLSearchParams({limit:String(PAGE_SIZE),offset:String(pageParam)});if(year)params.set('year',year);if(month)params.set('month',month);if(bucketId)params.set('bucketId',bucketId);return api<{operations:Operation[];hasMore:boolean;availableYears:number[]}>(`/operations?${params}`,{signal})},
    getNextPageParam:(lastPage,_pages,lastPageParam)=>lastPage.hasMore?lastPageParam+lastPage.operations.length:undefined,
  });
  const {data,isLoading,hasNextPage,isFetchingNextPage,isFetchNextPageError,fetchNextPage}=operationsQuery;
  const {data:dashboard}=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
  const pageCount=data?.pages.length??0;

  useEffect(()=>{nextPageRequested.current=false},[pageCount,year,month,bucketId]);
  useEffect(()=>{
    const target=loadMoreRef.current;
    if(!mobile||!target||!hasNextPage||isFetchNextPageError)return;
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting)||nextPageRequested.current)return;
      nextPageRequested.current=true;
      void fetchNextPage();
    },{rootMargin:'240px'});
    observer.observe(target);
    return()=>observer.disconnect();
  },[fetchNextPage,hasNextPage,isFetchNextPageError,mobile,pageCount,year,month,bucketId,kind,query]);

  const operations=useMemo(()=>data?.pages.flatMap(page=>page.operations)??[],[data]);
  const visible=useMemo(()=>{
    const needle=query.trim().toLocaleLowerCase('it-IT');
    return operations.filter(operation=>(kind==='all'||operation.kind===kind)&&(!needle||[operation.note??'',...operation.entries.map(entry=>entry.bucketName)].some(text=>text.toLocaleLowerCase('it-IT').includes(needle))));
  },[kind,operations,query]);
  const filterKey=[year,month,bucketId,kind,query.trim()].join('|');
  const page=pageState.key===filterKey?pageState.page:0;
  const pageStart=page*DESKTOP_PAGE_SIZE;
  const pageItems=visible.slice(pageStart,pageStart+DESKTOP_PAGE_SIZE);
  const loadedPages=Math.max(1,Math.ceil(visible.length/DESKTOP_PAGE_SIZE));
  const hasNextDesktopPage=visible.length>pageStart+DESKTOP_PAGE_SIZE;
  // Load server pages until the current page is full and we know whether another one follows.
  const needsMore=!mobile&&hasNextPage&&!isFetchingNextPage&&!isFetchNextPageError&&visible.length<=pageStart+DESKTOP_PAGE_SIZE;
  useEffect(()=>{if(needsMore)void fetchNextPage()},[fetchNextPage,needsMore]);
  function goToPage(next:number){
    setPageState({key:filterKey,page:next});
    const anchor=resultsTopRef.current;
    if(typeof anchor?.scrollIntoView==='function')anchor.scrollIntoView({block:'start',behavior:'smooth'});
  }
  const availableYears=data?.pages[0]?.availableYears??[];
  const buckets=useMemo(()=>dashboard?.buckets??[],[dashboard]);
  // Operations carry no colour; the dashboard provides it for the recipient bar.
  const colors=useMemo(()=>new Map(buckets.map(bucket=>[bucket.id,bucket.color])),[buckets]);
  const filtered=Boolean(year||month||bucketId||kind!=='all'||query.trim());
  const period=month&&year?`${monthNames[Number(month)-1]} ${year}`:month?monthNames[Number(month)-1]:year?year:'Tutti i movimenti';
  function resetFilters(){setYear('');setMonth('');setBucketId('');setKind('all');setQuery('')}

  const pager=!mobile&&(page>0||hasNextDesktopPage||hasNextPage)&&<nav className="pager" aria-label="Pagine dei movimenti">
    <button type="button" className="ib" onClick={()=>goToPage(page-1)} disabled={page===0} aria-label="Pagina precedente"><ChevronLeft aria-hidden="true"/></button>
    {pageNumbers(page,loadedPages).map((item,index)=>item===null?<span key={`gap-${index}`} className="pager-gap mono" aria-hidden="true">…</span>:<button type="button" key={item} className={`pager-page mono${item===page?' on':''}`} onClick={()=>goToPage(item)} aria-current={item===page?'page':undefined} aria-label={`Pagina ${item+1}`}>{item+1}</button>)}
    {hasNextPage&&<span className="pager-gap mono" aria-hidden="true">…</span>}
    <button type="button" className="ib" onClick={()=>goToPage(page+1)} disabled={!hasNextDesktopPage} aria-label="Pagina successiva"><ChevronRight aria-hidden="true"/></button>
    <span className="pager-info mono">{visible.length===0?'0':`${pageStart+1}–${pageStart+pageItems.length}`} di {visible.length}{hasNextPage?'+':''}</span>
  </nav>;
  const desktopStatus=isFetchNextPageError?<div className="load-more"><button type="button" className="btn outline sm" onClick={()=>void fetchNextPage()}>Riprova a caricare</button></div>:isFetchingNextPage&&pageItems.length<DESKTOP_PAGE_SIZE?<div className="load-more">Caricamento movimenti…</div>:null;
  const list=isLoading?<div className="skeleton card"/>:visible.length===0&&!hasNextPage
    ?<div className="empty"><span className="empty-icon"><Clock3/></span><h3>Nessuna operazione</h3><p>{filtered?'Non ci sono movimenti con i filtri selezionati.':'Le modifiche ai bucket compariranno qui.'}</p>{filtered&&<button className="btn sm" onClick={resetFilters}>Azzera filtri</button>}</div>
    :!mobile?<>
      <div className="tile op-table">{pageItems.map(operation=><OperationRow key={operation.id} operation={operation} hidden={hidden} desktop colors={colors}/>)}</div>
      {desktopStatus}
      {pager}
    </>
    :<>
      <div className="op-list">{visible.map(operation=><OperationRow key={operation.id} operation={operation} hidden={hidden} desktop={false} colors={colors}/>)}</div>
      {hasNextPage?<div className="load-more" ref={loadMoreRef}>{isFetchNextPageError?<button type="button" className="btn outline sm" onClick={()=>void fetchNextPage()}>Riprova a caricare</button>:isFetchingNextPage?'Caricamento movimenti…':'Scorri per caricare altri movimenti'}</div>:<div className="load-more">Tutti i movimenti sono stati caricati</div>}
    </>;
  const subtitle=`${period} · ${visible.length} ${visible.length===1?'operazione':'operazioni'}`;

  if(mobile)return <div className="screen history">
    <header className="screen-head">
      <div><div className="cap">{subtitle}</div><h1>Movimenti</h1></div>
      <div className="head-actions"><button className="ib" onClick={()=>setSearching(value=>!value)} aria-label="Cerca" aria-expanded={searching}><Search aria-hidden="true"/></button><button className={`ib${year||month||bucketId?' lime':''}`} onClick={()=>setFiltersOpen(true)} aria-label="Filtri: mese, anno, bucket"><SlidersHorizontal aria-hidden="true"/></button></div>
    </header>
    {searching&&<label className="pill-input"><Search aria-hidden="true"/><input autoFocus placeholder="Cerca nota o bucket" aria-label="Cerca nei movimenti" value={query} onChange={event=>setQuery(event.currentTarget.value)}/>{query&&<button type="button" className="text-btn" onClick={()=>setQuery('')} aria-label="Cancella ricerca"><X aria-hidden="true"/></button>}</label>}
    <div className="chip-row" role="group" aria-label="Tipo di operazione">{kinds.map(item=><button key={item.value} type="button" className="chip" aria-pressed={kind===item.value} onClick={()=>setKind(item.value)}>{item.label}</button>)}</div>
    {list}
    {filtersOpen&&<Modal title="Filtri" onClose={()=>setFiltersOpen(false)}><div className="stack">
      <label>Mese<SelectControl value={month} onChange={setMonth} options={[{value:'',label:'Tutti'},...monthNames.map((label,index)=>({value:String(index+1),label}))]}/></label>
      <label>Anno<SelectControl value={year} onChange={setYear} options={[{value:'',label:'Tutti'},...availableYears.map(value=>({value:String(value),label:String(value)}))]}/></label>
      <label>Bucket<SelectControl value={bucketId} onChange={setBucketId} options={[{value:'',label:'Tutti'},...buckets.map(bucket=>({value:bucket.id,label:bucket.name,color:bucket.color}))]}/></label>
      <div className="edit-actions"><button type="button" className="secondary" onClick={()=>{setYear('');setMonth('');setBucketId('')}}>Azzera</button><button type="button" className="primary" onClick={()=>setFiltersOpen(false)}>Mostra</button></div>
    </div></Modal>}
  </div>;

  const now=new Date();
  const shownYear=Number(year||now.getFullYear());
  const yearIndex=availableYears.indexOf(shownYear);
  return <div className="screen history history-desktop">
    <header className="desk-head">
      <div><div className="cap">{subtitle}</div><h1>Movimenti</h1></div>
      <label className="pill-input desk-search"><Search aria-hidden="true"/><input placeholder="Cerca nota o bucket" aria-label="Cerca nei movimenti" value={query} onChange={event=>setQuery(event.currentTarget.value)}/></label>
    </header>
    <div className="history-layout">
      <aside className="tile history-filters" aria-label="Filtri">
        <div className="chip-row wrap" role="group" aria-label="Tipo di operazione">{kinds.map(item=><button key={item.value} type="button" className="chip" aria-pressed={kind===item.value} onClick={()=>setKind(item.value)}>{item.label}</button>)}</div>
        <div>
          <div className="row-between filter-head"><span className="cap">Anno</span><span className="year-step mono"><button type="button" onClick={()=>setYear(String(availableYears[yearIndex+1]??shownYear-1))} disabled={yearIndex>=availableYears.length-1&&availableYears.length>0} aria-label="Anno precedente"><ChevronLeft aria-hidden="true"/></button>{year||'Tutti'}<button type="button" onClick={()=>setYear(yearIndex>0?String(availableYears[yearIndex-1]):'')} disabled={!year} aria-label="Anno successivo"><ChevronRight aria-hidden="true"/></button></span></div>
          <div className="month-grid">{monthNames.map((name,index)=>{
            const value=String(index+1);
            const future=shownYear===now.getFullYear()&&index>now.getMonth();
            return <button type="button" key={name} className={`mono month-cell${month===value?' on':''}`} disabled={future} aria-pressed={month===value} onClick={()=>setMonth(month===value?'':value)}>{name.slice(0,3)}</button>;
          })}</div>
        </div>
        <div>
          <div className="cap filter-head">Bucket</div>
          {buckets.map(bucket=>{const active=!bucketId||bucketId===bucket.id;return <button type="button" key={bucket.id} className="bucket-check" aria-pressed={bucketId===bucket.id} onClick={()=>setBucketId(bucketId===bucket.id?'':bucket.id)}><span className="check-box" style={{borderColor:bucket.color,background:active?bucket.color:'transparent'}}/>{bucket.name}</button>})}
        </div>
        <button type="button" className="btn outline" onClick={resetFilters} disabled={!filtered}>Azzera filtri</button>
      </aside>
      <section className="history-results"><div ref={resultsTopRef} className="scroll-anchor"/>{list}</section>
    </div>
  </div>;
}

const OperationRow=memo(function OperationRow({operation,hidden,desktop,colors}:{operation:Operation;hidden:boolean;desktop:boolean;colors:Map<string,string>}){
  const summary=summarizeOperation(operation,hidden);
  const day=operationDay(operation.occurredAt);
  const Icon=icons[operation.kind];
  const distribution=operation.kind==='distribution';
  const recipients=operation.entries.filter(entry=>BigInt(entry.amountCents)>0n);
  return <article className="op">
    <div className="op-date"><div className="mono op-day">{day.day}</div><div className="cap">{day.month}{desktop?` · ${operationTime(operation.occurredAt)}`:''}</div></div>
    {!desktop&&<span className="op-divider" aria-hidden="true"/>}
    <div className="op-main">
      <div className="op-title"><Icon className="i16 mu" aria-hidden="true"/><strong>{summary.title}</strong></div>
      <p className="op-sub">{summary.subtitle}</p>
      {distribution&&(desktop
        ?<div className="op-entries" aria-label="Bucket destinatari">{recipients.map(entry=><span key={entry.bucketId} className="mono op-entry"><span>{entry.bucketName}</span> {formatEuro(entry.amountCents,hidden,{sign:true})}</span>)}</div>
        :<div className="op-bar" role="img" aria-label={`Bucket destinatari: ${recipients.map(entry=>`${entry.bucketName} ${formatEuro(entry.amountCents,hidden,{sign:true})}`).join(', ')}`}>{recipients.map(entry=><span key={entry.bucketId} style={{flex:Number(BigInt(entry.amountCents)),background:colors.get(entry.bucketId)??'var(--ink)'}}/>)}</div>)}
    </div>
    <div className={`mono op-amount ${summary.tone}`}>{formatOperationAmount(summary,hidden)}</div>
  </article>;
});

/** Page indexes to show: first, last and the neighbours of the current one, with gaps as null. */
function pageNumbers(current:number,total:number):(number|null)[]{
  const pages=new Set([0,total-1,current-1,current,current+1].filter(index=>index>=0&&index<total));
  const sorted=[...pages].sort((a,b)=>a-b);
  return sorted.flatMap((index,position)=>position>0&&index-sorted[position-1]!>1?[null,index]:[index]);
}
