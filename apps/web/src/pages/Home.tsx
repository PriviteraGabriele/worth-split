import { useState,type CSSProperties,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { DndContext,DragOverlay,KeyboardSensor,PointerSensor,closestCenter,useSensor,useSensors,type DragEndEvent } from '@dnd-kit/core';
import { SortableContext,arrayMove,rectSortingStrategy,sortableKeyboardCoordinates,useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowRightLeft,Check,Eye,EyeOff,GitFork,GripVertical,Plus,Scale,TrendingDown,TrendingUp,WifiOff,X } from 'lucide-react';
import { Link,useNavigate } from 'react-router-dom';
import { api,newKey } from '../lib/api';
import { formatEuro,percent,safeCents,sanitizeDecimalInput } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { refreshFinancialData } from '../lib/queryInvalidation';
import { dueDayOf,monthName,pendingAmount,plannedSummary,todayMonth } from '../lib/planned';
import { formatOperationAmount,operationDay,summarizeOperation } from '../lib/operations';
import { Avatar } from '../components/Avatar';
import { useMobileLayout } from '../lib/useMobileLayout';
import type { Bucket,CurrentUser,Dashboard,Operation,PlannedExpensesResponse,TrendMonth } from '../types';
import { Money } from '../components/Money';
import { BucketSquare } from '../components/BucketSquare';
import { BucketPicker } from '../components/BucketPicker';
import { BucketForm } from '../components/BucketForm';
import { Sparkline } from '../components/Sparkline';
import { BrandMark } from '../components/BrandMark';

const dateCap=new Intl.DateTimeFormat('it-IT',{weekday:'short',day:'numeric',month:'short'});
const dateLong=new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
function capitalize(value:string){return value.charAt(0).toUpperCase()+value.slice(1)}

export function Home(){
  const qc=useQueryClient();
  const navigate=useNavigate();
  const mobile=useMobileLayout();
  const {hidden,toggle,isUpdating}=useAmountPrivacy();
  const month=todayMonth();
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
  const me=useQuery({queryKey:['me'],queryFn:({signal})=>api<{user:CurrentUser}>('/auth/me',{signal}),staleTime:Infinity});
  const planned=useQuery({queryKey:['planned-expenses',month],queryFn:({signal})=>api<PlannedExpensesResponse>(`/planned-expenses?${new URLSearchParams({month})}`,{signal})});
  const trends=useQuery({queryKey:['trends'],queryFn:({signal})=>api<{months:TrendMonth[]}>('/trends',{signal})});
  const recent=useQuery({queryKey:['operations','recent'],queryFn:({signal})=>api<{operations:Operation[]}>('/operations?limit=4&offset=0',{signal}),enabled:!mobile});
  const [order,setOrder]=useState<string[]|null>(null);
  const [activeBucketId,setActiveBucketId]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const sensors=useSensors(
    useSensor(PointerSensor,{activationConstraint:{distance:6}}),
    useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}),
  );
  const orderMutation=useMutation({
    mutationFn:(ids:string[])=>api('/buckets/order',{method:'PUT',body:JSON.stringify({ids})}),
    onSuccess:(_result,ids)=>{
      qc.setQueryData<Dashboard>(['dashboard'],current=>{
        if(!current)return current;
        const byId=new Map(current.buckets.map(bucket=>[bucket.id,bucket]));
        const buckets=ids.map((id,index)=>{const bucket=byId.get(id);return bucket?{...bucket,sortOrder:index}:undefined}).filter((bucket):bucket is Bucket=>Boolean(bucket));
        return buckets.length===current.buckets.length?{...current,buckets}:current;
      });
      setOrder(null);
      void qc.invalidateQueries({queryKey:['dashboard']});
    },
  });

  if(dashboard.isLoading)return <div className="screen"><div className="skeleton hero"/><div className="skeleton card"/></div>;
  if(dashboard.isError||!dashboard.data)return <div className="screen"><div className="state"><WifiOff/><h2>Impossibile caricare i dati</h2><p>Controlla la connessione e riprova.</p></div></div>;
  const data=dashboard.data;
  const user=me.data?.user;
  const buckets=order?order.map(id=>data.buckets.find(bucket=>bucket.id===id)).filter((bucket):bucket is Bucket=>Boolean(bucket)):data.buckets;
  const allocation=data.buckets.filter(bucket=>bucket.includeInTotal&&BigInt(bucket.balanceCents)>0n).sort((a,b)=>{const difference=BigInt(b.balanceCents)-BigInt(a.balanceCents);return difference>0n?1:difference<0n?-1:a.sortOrder-b.sortOrder});
  const summary=plannedSummary(planned.data?.expenses??[]);
  const afterPlanned=BigInt(data.totalCents)-summary.pending;
  const change=BigInt(data.monthlyChangeCents);
  const sparkMonths=(trends.data?.months??[]).slice(-12);
  const activeBucket=activeBucketId?buckets.find(bucket=>bucket.id===activeBucketId):undefined;
  const plannedProgress=summary.actual+summary.pending>0n?Number(summary.actual*1000n/(summary.actual+summary.pending))/10:0;
  const now=new Date();

  function finishDrag(event:DragEndEvent){if(!order||!event.over||event.active.id===event.over.id)return;const from=order.indexOf(String(event.active.id));const to=order.indexOf(String(event.over.id));if(from>=0&&to>=0)setOrder(arrayMove(order,from,to))}

  const changeChip=<span className="hero-chip">{change>=0n?<TrendingUp className="i16" aria-hidden="true"/>:<TrendingDown className="i16" aria-hidden="true"/>}{hidden?'••••':`${change>=0n?'+':'−'}${formatEuro(change<0n?-change:change).slice(1)}`} {monthName(month).slice(0,3).toLowerCase()}</span>;
  const allocationBar=allocation.length>0&&<div className="allocation" role="img" aria-label="Ripartizione del patrimonio">{allocation.map(bucket=><span key={bucket.id} style={{flex:percent(bucket.balanceCents,data.totalCents),background:bucket.color}} title={`${bucket.name}: ${percent(bucket.balanceCents,data.totalCents).toLocaleString('it-IT')}%`}/>)}</div>;
  const bucketTiles=data.buckets.length===0
    ?<div className="empty"><span className="empty-icon"><Plus/></span><h3>Nessun bucket</h3><p>Crea il primo bucket per iniziare a dividere il patrimonio.</p><button className="btn sm" onClick={()=>setCreating(true)}>Crea bucket</button></div>
    :order
      ?<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={event=>setActiveBucketId(String(event.active.id))} onDragCancel={()=>setActiveBucketId(null)} onDragEnd={event=>{finishDrag(event);setActiveBucketId(null)}}><SortableContext items={order} strategy={rectSortingStrategy}><div className="bucket-grid is-reordering">{buckets.map(bucket=><SortableBucket key={bucket.id} bucket={bucket} hidden={hidden}/>)}</div></SortableContext><DragOverlay dropAnimation={{duration:220,easing:'cubic-bezier(.22,1,.36,1)'}}>{activeBucket&&<ReorderRow bucket={activeBucket} hidden={hidden} overlay/>}</DragOverlay></DndContext>
      :<div className="bucket-grid">{buckets.map(bucket=>{
        const share=percent(bucket.balanceCents,data.totalCents);
        return <Link key={bucket.id} to={`/bucket/${bucket.id}`} className={`bucket-tile${bucket.includeInTotal?'':' excluded'}`} aria-label={`Apri ${bucket.name}`}>
          <div className="bucket-tile-top"><BucketSquare type={bucket.type} color={bucket.color} size={mobile?28:30}/><span className="mono mu bucket-share">{bucket.includeInTotal?`${share.toLocaleString('it-IT')}%`:'escluso'}</span></div>
          <div><h3>{bucket.name}</h3><Money className="mono bucket-amount" cents={bucket.balanceCents} hidden={hidden}/></div>
          <PlannedCommitment bucket={bucket} hidden={hidden}/>
        </Link>;
      })}</div>;
  const bucketHeader=<div className="section-row">
    <span className="cap">Bucket · {data.buckets.length}</span>
    <div className="section-actions">{order
      ?<><button className="text-btn mu" onClick={()=>{setActiveBucketId(null);setOrder(null)}} disabled={orderMutation.isPending}><X aria-hidden="true"/>Annulla</button><button className="text-btn" onClick={()=>orderMutation.mutate(order)} disabled={orderMutation.isPending}><Check aria-hidden="true"/>Salva</button></>
      :<>{data.buckets.length>1&&<button className="text-btn" onClick={()=>setOrder(data.buckets.map(bucket=>bucket.id))}><GripVertical aria-hidden="true"/>Riordina</button>}{mobile&&<button className="text-btn" onClick={()=>setCreating(true)}><Plus aria-hidden="true"/>Nuovo</button>}</>}
    </div>
  </div>;

  if(mobile)return <div className="screen home">
    <header className="home-head">
      <div className="home-hello"><BrandMark className="brand-mark home-mark"/><div><div className="cap">{capitalize(dateCap.format(now)).replaceAll('.','')}</div><div className="home-name">{greetingName(user)}</div></div></div>
      <div className="home-head-actions"><button className="ib" onClick={toggle} disabled={isUpdating} aria-label={hidden?'Mostra importi':'Nascondi importi'}>{hidden?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}</button>{user&&<Link to="/impostazioni" aria-label="Profilo e impostazioni"><Avatar user={user} className="ib ink"/></Link>}</div>
    </header>
    <section className="hero-tile home-hero" aria-label="Patrimonio">
      <div className="cap">Patrimonio netto</div>
      <Money className="mono home-total" cents={data.totalCents} hidden={hidden}/>
      <div className="home-hero-row">{changeChip}<Sparkline className="home-spark" months={sparkMonths}/></div>
      {allocationBar}
    </section>
    <nav className="quick-actions" aria-label="Sposta denaro">
      <Link className="qa" to="/sposta/trasferisci" aria-disabled={data.buckets.length<2}><ArrowRightLeft aria-hidden="true"/>Trasferisci</Link>
      <Link className="qa" to="/sposta/distribuisci"><GitFork aria-hidden="true"/>Distribuisci</Link>
      <Link className="qa" to="/sposta/ribilancia"><Scale aria-hidden="true"/>Ribilancia</Link>
    </nav>
    <Link className="tile home-due" to="/previsioni" aria-label="Spese previste del mese">
      <div><div className="cap">Da pagare a {monthName(month).toLowerCase()} · {summary.pendingIncluded.length}</div><Money className="mono home-due-amount" cents={summary.pending} hidden={hidden}/></div>
      <div className="home-due-after"><div className="cap">Poi resta</div><Money className="mono" cents={afterPlanned} hidden={hidden}/></div>
    </Link>
    {bucketHeader}
    {orderMutation.isError&&<p className="form-error">Impossibile salvare l’ordine. Riprova.</p>}
    {bucketTiles}
    {creating&&<BucketForm onClose={()=>setCreating(false)}/>}
  </div>;

  const upcoming=summary.pendingIncluded.slice().sort((a,b)=>(dueDayOf(a,month)??32)-(dueDayOf(b,month)??32)).slice(0,4);
  return <div className="screen home home-desktop">
    <header className="desk-head">
      <div><div className="cap">{capitalize(dateLong.format(now))}</div><h1>{greetingName(user)}</h1></div>
      <div className="desk-head-actions"><button className="btn outline sm" onClick={toggle} disabled={isUpdating}>{hidden?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}{hidden?'Mostra':'Nascondi'}</button><button className="btn sm" onClick={()=>setCreating(true)}><Plus aria-hidden="true"/>Nuovo bucket</button></div>
    </header>
    <div className="bento">
      <section className="hero-tile s6 desk-hero" aria-label="Patrimonio">
        <div className="row-between"><span className="cap">Patrimonio netto</span>{changeChip}</div>
        <Money className="mono desk-total" cents={data.totalCents} hidden={hidden}/>
        <Sparkline className="desk-spark" months={sparkMonths}/>
        {allocationBar}
      </section>
      <Link className="tile s3 desk-stat" to="/previsioni">
        <span className="cap">Da pagare · {monthName(month).toLowerCase()}</span>
        <div><Money className="mono desk-stat-amount" cents={summary.pending} hidden={hidden}/><div className="desk-stat-sub">{summary.pendingIncluded.length} {summary.pendingIncluded.length===1?'spesa aperta':'spese aperte'} · {summary.registered.length} {summary.registered.length===1?'addebito registrato':'addebiti registrati'}</div></div>
        <div className="progress"><span style={{width:`${plannedProgress}%`}}/></div>
      </Link>
      <div className="tile s3 desk-stat">
        <span className="cap">Dopo le previste</span>
        <Money className="mono desk-stat-amount act" cents={afterPlanned} hidden={hidden}/>
        <div className="desk-stat-sub">Patrimonio libero a fine mese</div>
      </div>
      <div className="s12">{bucketHeader}{orderMutation.isError&&<p className="form-error">Impossibile salvare l’ordine. Riprova.</p>}{bucketTiles}</div>
      <QuickTransfer buckets={data.buckets} hidden={hidden} onMore={mode=>navigate(`/sposta/${mode}`)}/>
      <section className="tile s4">
        <div className="row-between tile-head"><span className="cap">Ultimi movimenti</span><Link className="text-btn" to="/storico">Tutti</Link></div>
        {(recent.data?.operations??[]).length===0?<p className="tile-empty">Nessun movimento.</p>:recent.data!.operations.map(operation=>{const summary=summarizeOperation(operation,hidden);const day=operationDay(operation.occurredAt);return <div className="li" key={operation.id}><span className="mono li-date">{day.day} {day.month.toUpperCase()}</span><span className="li-text">{operation.kind==='transfer'?summary.subtitle.split(' · ')[0]:summary.title}</span><span className={`mono li-amount ${summary.tone}`}>{formatOperationAmount(summary,hidden)}</span></div>})}
      </section>
      <section className="tile s4">
        <div className="row-between tile-head"><span className="cap">In scadenza</span><Link className="text-btn" to="/previsioni">Previsioni</Link></div>
        {upcoming.length===0?<p className="tile-empty">Nessuna spesa da pagare questo mese.</p>:upcoming.map(expense=>{const day=dueDayOf(expense,month);return <div className="li" key={expense.id}><span className="mono li-date">{day?String(day).padStart(2,'0'):'—'} {monthName(month).slice(0,3).toUpperCase()}</span><span className="li-text">{expense.name}{expense.amountMode==='estimated'&&BigInt(expense.actualAmountCents)>0n?' · residuo':''}</span><span className="mono li-amount">{formatEuro(pendingAmount(expense),hidden)}</span></div>})}
      </section>
    </div>
    {creating&&<BucketForm onClose={()=>setCreating(false)}/>}
  </div>;
}

/**
 * Share of the balance already taken by this month's open planned expenses
 * (amber) and, below, what is left once they are paid.
 */
function PlannedCommitment({bucket,hidden}:{bucket:Bucket;hidden:boolean}){
  const balance=BigInt(bucket.balanceCents);
  const planned=BigInt(bucket.plannedExpenseCents??'0');
  const net=balance-planned;
  const available=balance>0n?balance:0n;
  const reserved=planned<available?planned:available;
  const free=available-reserved;
  return <div className="bucket-commit">
    <span className="bucket-bar" aria-hidden="true" title={planned>0n&&!hidden?`Spese previste del mese: ${formatEuro(planned)}`:undefined}>
      {reserved>0n&&<span className="reserved" style={{flex:Number(reserved)}}/>}
      {free>0n&&<span style={{flex:Number(free),background:bucket.color}}/>}
    </span>
    {planned>0n
      ?<span className="mono bucket-net"><span className="mu">Restano</span> <span className={net<0n?'neg':''}>{formatEuro(net,hidden)}</span></span>
      :<span className="mono mu bucket-net">Nessuna spesa prevista</span>}
  </div>;
}

function greetingName(user:CurrentUser|undefined){return user?.firstName?`Ciao, ${user.firstName}`:'Ciao'}

function QuickTransfer({buckets,hidden,onMore}:{buckets:Bucket[];hidden:boolean;onMore:(mode:'distribuisci'|'ribilancia')=>void}){
  const qc=useQueryClient();
  const [from,setFrom]=useState(buckets[0]?.id??'');
  const [to,setTo]=useState(buckets[1]?.id??'');
  const [amount,setAmount]=useState('');
  const [picking,setPicking]=useState<'from'|'to'|null>(null);
  const [error,setError]=useState('');
  const fromBucket=buckets.find(bucket=>bucket.id===from);
  const toBucket=buckets.find(bucket=>bucket.id===to);
  const cents=safeCents(amount);
  const mutation=useMutation({
    mutationFn:()=>api('/transfers',{method:'POST',body:JSON.stringify({fromBucketId:from,toBucketId:to,amountCents:cents.toString(),note:'',idempotencyKey:newKey()})}),
    onSuccess:()=>{setAmount('');refreshFinancialData(qc)},
    onError:()=>setError('Trasferimento non riuscito. Controlla il saldo.'),
  });
  function submit(event:FormEvent){
    event.preventDefault();
    setError('');
    if(!fromBucket||!toBucket||from===to){setError('Scegli due bucket diversi.');return}
    if(cents<=0n){setError('Inserisci un importo.');return}
    mutation.mutate();
  }
  if(buckets.length<2)return <section className="tile s4"><span className="cap">Trasferimento rapido</span><p className="tile-empty">Servono almeno due bucket.</p></section>;
  return <form className="tile s4 quick-transfer" onSubmit={submit}>
    <div className="row-between"><span className="cap">Trasferimento rapido</span><span className="quick-links"><button type="button" className="text-btn" onClick={()=>onMore('distribuisci')}>Distribuisci</button> · <button type="button" className="text-btn" onClick={()=>onMore('ribilancia')}>Ribilancia</button></span></div>
    <button type="button" className="pick" onClick={()=>setPicking('from')} aria-label={`Da: ${fromBucket?.name??'scegli'}`}><i className="dot" style={{background:fromBucket?.color}}/><span>{fromBucket?.name}</span><span className="mono mu">{fromBucket&&formatEuro(fromBucket.balanceCents,hidden)}</span></button>
    <button type="button" className="pick" onClick={()=>setPicking('to')} aria-label={`A: ${toBucket?.name??'scegli'}`}><i className="dot" style={{background:toBucket?.color}}/><span>{toBucket?.name}</span><span className="mono mu">{toBucket&&formatEuro(toBucket.balanceCents,hidden)}</span></button>
    <div className="quick-row"><label className="pick mono quick-amount"><span>€</span><input aria-label="Importo da trasferire" inputMode="decimal" placeholder="0,00" value={amount} onChange={event=>setAmount(sanitizeDecimalInput(event.currentTarget.value))}/></label><button className="btn sm" disabled={mutation.isPending}>{mutation.isPending?'Invio…':'Invia'}</button></div>
    {error&&<p className="form-error">{error}</p>}
    {picking&&<BucketPicker title={picking==='from'?'Da quale bucket':'Verso quale bucket'} buckets={buckets} selected={picking==='from'?from:to} disabledId={picking==='from'?to:from} onSelect={id=>picking==='from'?setFrom(id):setTo(id)} onClose={()=>setPicking(null)}/>}
  </form>;
}

function SortableBucket({bucket,hidden}:{bucket:Bucket;hidden:boolean}){
  const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging}=useSortable({id:bucket.id,transition:{duration:260,easing:'cubic-bezier(.22,1,.36,1)'}});
  return <div ref={setNodeRef} className={`reorder-row${isDragging?' is-dragging':''}`} style={{transform:CSS.Transform.toString(transform),transition,zIndex:isDragging?5:undefined} as CSSProperties}>
    <button ref={setActivatorNodeRef} type="button" className="reorder-grip" style={{touchAction:'none'}} {...attributes} {...listeners} aria-label={`Trascina ${bucket.name} per riordinarlo`}><GripVertical/></button>
    <BucketSquare type={bucket.type} color={bucket.color}/>
    <h3>{bucket.name}</h3>
    <Money className="mono" cents={bucket.balanceCents} hidden={hidden}/>
  </div>;
}

function ReorderRow({bucket,hidden,overlay}:{bucket:Bucket;hidden:boolean;overlay?:boolean}){
  return <div className={`reorder-row${overlay?' overlay':''}`}><span className="reorder-grip"><GripVertical/></span><BucketSquare type={bucket.type} color={bucket.color}/><span className="reorder-name">{bucket.name}</span><Money className="mono" cents={bucket.balanceCents} hidden={hidden}/></div>;
}
