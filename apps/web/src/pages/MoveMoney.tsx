import { useMemo,useRef,useState,type CSSProperties,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { DndContext,KeyboardSensor,PointerSensor,closestCenter,useSensor,useSensors,type DragEndEvent } from '@dnd-kit/core';
import { SortableContext,arrayMove,sortableKeyboardCoordinates,useSortable,verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpDown,GripVertical,PencilLine } from 'lucide-react';
import { Link,Navigate,useNavigate,useParams,useSearchParams } from 'react-router-dom';
import { api,newKey } from '../lib/api';
import { centsToInput,formatEuro,formatEuroCompact,normalizePercentageInput,safeCents,sanitizeDecimalInput } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { refreshFinancialData } from '../lib/queryInvalidation';
import type { Bucket,Dashboard } from '../types';
import { basisPointsToInput,percentageToBasisPoints,templateInputs,templateTotalCents,type DistributionTemplate,type TemplateMode } from '../lib/templates';
import { FlowHeader } from '../components/FlowHeader';
import { Money } from '../components/Money';
import { AmountEntry } from '../components/AmountEntry';
import { Keypad } from '../components/Keypad';
import { BucketPicker } from '../components/BucketPicker';
import { TextInputModal } from '../components/TextInputModal';

type Mode='trasferisci'|'distribuisci'|'ribilancia';
const modes:{value:Mode;label:string}[]=[{value:'trasferisci',label:'Trasferisci'},{value:'distribuisci',label:'Distribuisci'},{value:'ribilancia',label:'Ribilancia'}];

export function MoveMoney(){
  const params=useParams();
  const mode=modes.find(item=>item.value===params.mode)?.value;
  const [search]=useSearchParams();
  const requestedTemplate=search.get('template');
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
  const templates=useQuery({queryKey:['templates'],queryFn:({signal})=>api<{templates:DistributionTemplate[]}>('/templates',{signal}),enabled:mode==='distribuisci'});
  if(!mode)return <Navigate to="/sposta/trasferisci" replace/>;
  const buckets=dashboard.data?.buckets??[];
  // "Usa per distribuire" opens the panel with the template already applied.
  const waitingTemplate=mode==='distribuisci'&&requestedTemplate!==null&&templates.isLoading;
  const initialTemplate=requestedTemplate?templates.data?.templates.find(template=>template.id===requestedTemplate):undefined;
  return <div className="flow move-money">
    <FlowHeader to="/" kind="close" title={<span className="flow-title">Sposta denaro</span>}/>
    <nav className="pills" aria-label="Tipo di operazione">{modes.map(item=><Link key={item.value} to={`/sposta/${item.value}`} replace className={item.value===mode?'on':''} aria-current={item.value===mode?'page':undefined}>{item.label}</Link>)}</nav>
    {dashboard.isLoading||waitingTemplate?<div className="skeleton card"/>:buckets.length===0?<div className="empty"><h3>Nessun bucket</h3><p>Crea un bucket dalla Home per iniziare.</p><Link className="btn sm" to="/">Vai alla Home</Link></div>
      :mode==='trasferisci'?<TransferPanel buckets={buckets}/>
      :mode==='distribuisci'?<DistributionPanel buckets={buckets} initialTemplate={initialTemplate}/>
      :<RebalancePanel buckets={buckets}/>}
  </div>;
}

function useFinish(){
  const qc=useQueryClient();
  const navigate=useNavigate();
  return ()=>{refreshFinancialData(qc);navigate('/')};
}

/* ---------- Trasferisci ---------- */
export function TransferPanel({buckets}:{buckets:Bucket[]}){
  const {hidden}=useAmountPrivacy();
  const finish=useFinish();
  const [from,setFrom]=useState(buckets[0]?.id??'');
  const [to,setTo]=useState(buckets[1]?.id??'');
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');
  const [picking,setPicking]=useState<'from'|'to'|null>(null);
  const [error,setError]=useState('');
  const key=useRef(newKey());
  const fromBucket=buckets.find(bucket=>bucket.id===from);
  const toBucket=buckets.find(bucket=>bucket.id===to);
  const cents=safeCents(amount);
  const fromBalance=BigInt(fromBucket?.balanceCents??'0');
  const toBalance=BigInt(toBucket?.balanceCents??'0');
  const mutation=useMutation({
    mutationFn:()=>api('/transfers',{method:'POST',body:JSON.stringify({fromBucketId:from,toBucketId:to,amountCents:cents.toString(),note:note.trim(),idempotencyKey:key.current})}),
    onSuccess:finish,
    onError:()=>setError('Trasferimento non riuscito. Controlla il saldo di origine.'),
  });
  function change(value:string){key.current=newKey();setAmount(value);setError('')}
  function share(part:bigint){change(centsToInput((fromBalance*part/100n).toString()))}
  function submit(event:FormEvent){
    event.preventDefault();
    if(!fromBucket||!toBucket||from===to){setError('Scegli due bucket diversi per il trasferimento.');return}
    if(cents<=0n)return;
    if(cents>fromBalance){setError('L’importo supera il saldo del bucket di origine.');return}
    mutation.mutate();
  }
  if(buckets.length<2)return <div className="empty"><h3>Serve un altro bucket</h3><p>Per trasferire denaro ti servono almeno due bucket.</p></div>;
  return <><form className="flow-body" onSubmit={submit}>
    <div className="transfer-ends">
      <button type="button" className="end-tile" onClick={()=>setPicking('from')} aria-label={`Da: ${fromBucket?.name??'scegli'}`}><span className="end-main"><span className="cap">Da</span><span className="end-name"><i className="dot" style={{background:fromBucket?.color}}/>{fromBucket?.name}</span></span><span className="mono end-preview"><span>{formatEuroCompact(fromBalance,hidden)}</span><span className={`end-after${cents>0n?' neg':''}`}>{formatEuroCompact(fromBalance-cents,hidden)}</span></span></button>
      <button type="button" className="end-tile" onClick={()=>setPicking('to')} aria-label={`A: ${toBucket?.name??'scegli'}`}><span className="end-main"><span className="cap">A</span><span className="end-name"><i className="dot" style={{background:toBucket?.color}}/>{toBucket?.name}</span></span><span className="mono end-preview"><span>{formatEuroCompact(toBalance,hidden)}</span><span className={`end-after${cents>0n?' pos':''}`}>{formatEuroCompact(toBalance+cents,hidden)}</span></span></button>
      <button type="button" className="swap" onClick={()=>{setFrom(to);setTo(from);key.current=newKey()}} aria-label="Inverti origine e destinazione"><ArrowUpDown aria-hidden="true"/></button>
    </div>
    <AmountEntry label="Importo" value={amount} onChange={change} autoFocus/>
    <div className="chip-center"><button type="button" className="chip mono" onClick={()=>share(25n)}>25%</button><button type="button" className="chip mono" onClick={()=>share(50n)}>50%</button><button type="button" className="chip mono" onClick={()=>share(100n)}>Tutto</button></div>
    <label className="pill-input"><PencilLine aria-hidden="true"/><input placeholder="Aggiungi una nota" aria-label="Nota" value={note} maxLength={300} onChange={event=>{key.current=newKey();setNote(event.currentTarget.value)}}/></label>
    <Keypad value={amount} onChange={change}/>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="flow-spacer"/>
    <button className="btn" disabled={cents<=0n||mutation.isPending}>{mutation.isPending?'Trasferimento…':`Trasferisci ${formatEuro(cents,hidden)}`}</button>
  </form>
  {picking&&<BucketPicker title={picking==='from'?'Da quale bucket':'Verso quale bucket'} buckets={buckets} selected={picking==='from'?from:to} disabledId={picking==='from'?to:from} onSelect={id=>{key.current=newKey();if(picking==='from')setFrom(id);else setTo(id)}} onClose={()=>setPicking(null)}/>}
  </>;
}

/* ---------- Distribuisci ---------- */
const formatBasisPoints=(value:number)=>`${(value/100).toLocaleString('it-IT',{maximumFractionDigits:2})}%`;

export function DistributionPanel({buckets,initialTemplate}:{buckets:Bucket[];initialTemplate?:DistributionTemplate}){
  const {hidden}=useAmountPrivacy();
  const qc=useQueryClient();
  const finish=useFinish();
  const [total,setTotal]=useState(()=>initialTemplate?.mode==='fixed'?centsToInput(templateTotalCents(initialTemplate).toString()):'');
  const [mode,setMode]=useState<TemplateMode>(initialTemplate?.mode??'fixed');
  const [values,setValues]=useState<Record<string,string>>(()=>initialTemplate?templateInputs(initialTemplate):{});
  const [templateId,setTemplateId]=useState<string|null>(initialTemplate?.id??null);
  const [note,setNote]=useState(initialTemplate?`Template: ${initialTemplate.name}`:'');
  const [naming,setNaming]=useState(false);
  const [error,setError]=useState('');
  const key=useRef(newKey());
  const templates=useQuery({queryKey:['templates'],queryFn:({signal})=>api<{templates:DistributionTemplate[]}>('/templates',{signal})});
  const totalCents=safeCents(total);
  const rows=useMemo(()=>{
    if(mode==='fixed')return buckets.map(bucket=>{const cents=safeCents(values[bucket.id]??'');return {bucket,cents,basisPoints:totalCents>0n?Number(cents*10000n/totalCents):0}});
    // Percentages: each share is rounded down, the last bucket with a share takes the remainder.
    const shares=buckets.map(bucket=>({bucket,basisPoints:percentageToBasisPoints(values[bucket.id]??'')}));
    const sumPoints=shares.reduce((sum,item)=>sum+item.basisPoints,0);
    const lastIndex=shares.reduce((last,item,index)=>item.basisPoints>0?index:last,-1);
    let assigned=0n;
    return shares.map((item,index)=>{
      let cents=totalCents*BigInt(item.basisPoints)/10000n;
      if(index===lastIndex&&sumPoints===10000)cents=totalCents-assigned;
      assigned+=cents;
      return {...item,cents};
    });
  },[buckets,mode,totalCents,values]);
  const distributed=rows.reduce((sum,row)=>sum+row.cents,0n);
  const remaining=totalCents-distributed;
  const assignedPoints=totalCents>0n?Number(distributed*1000n/totalCents)/10:0;
  const entries=rows.filter(row=>row.cents>0n).map(row=>({bucketId:row.bucket.id,amountCents:row.cents.toString()}));
  const complete=totalCents>0n&&remaining===0n;
  const mutation=useMutation({
    mutationFn:()=>api('/distributions',{method:'POST',body:JSON.stringify({totalCents:totalCents.toString(),entries,note:note.trim(),idempotencyKey:key.current})}),
    onSuccess:finish,
    onError:()=>setError('Distribuzione non riuscita. Riprova.'),
  });

  function touch(){key.current=newKey();setError('')}
  function changeMode(next:TemplateMode){if(next===mode)return;setMode(next);setValues({});setTemplateId(null);touch()}
  function applyTemplate(template:DistributionTemplate){
    touch();
    setTemplateId(template.id);
    setNote(`Template: ${template.name}`);
    if(template.mode==='percentage'){
      setMode('percentage');
      setValues(Object.fromEntries(template.items.map(item=>[item.bucketId,basisPointsToInput(item.percentageBasisPoints??0)])));
    }else{
      setMode('fixed');
      const sum=template.items.reduce((acc,item)=>acc+BigInt(item.amountCents??'0'),0n);
      setValues(Object.fromEntries(template.items.map(item=>[item.bucketId,centsToInput(item.amountCents??'0')])));
      setTotal(centsToInput(sum.toString()));
    }
  }
  async function saveTemplate(name:string){
    const items=mode==='fixed'?entries:rows.filter(row=>row.basisPoints>0).map(row=>({bucketId:row.bucket.id,percentageBasisPoints:row.basisPoints}));
    await api('/templates',{method:'POST',body:JSON.stringify({name,mode,items})});
    void qc.invalidateQueries({queryKey:['templates']});
    setNaming(false);
  }
  function submit(event:FormEvent){
    event.preventDefault();
    if(totalCents<=0n){setError('Inserisci il totale da distribuire.');return}
    if(remaining>0n){setError(`Restano ancora ${formatEuro(remaining,hidden)} da distribuire.`);return}
    if(remaining<0n){setError(`Hai superato il totale di ${formatEuro(-remaining,hidden)}.`);return}
    mutation.mutate();
  }
  const canSaveTemplate=mode==='fixed'?entries.length>0:rows.some(row=>row.basisPoints>0);

  return <><form className="flow-body" onSubmit={submit}>
    <div className="dist-total">
      <label className="dist-total-amount"><span className="cap">Totale in entrata</span><span aria-hidden="true"><Money className="mono dist-total-value" cents={totalCents}/></span><input aria-label="Totale da distribuire" inputMode="decimal" autoComplete="off" value={total} onChange={event=>{setTotal(sanitizeDecimalInput(event.currentTarget.value));touch()}}/></label>
      <div className="pills mono-pills" role="group" aria-label="Modalità"><button type="button" aria-pressed={mode==='percentage'} onClick={()=>changeMode('percentage')}>%</button><button type="button" aria-pressed={mode==='fixed'} onClick={()=>changeMode('fixed')}>€</button></div>
    </div>
    <div className="chip-row" aria-label="Template">
      {(templates.data?.templates??[]).map(template=><button type="button" key={template.id} className="chip lime" aria-pressed={template.id===templateId} onClick={()=>applyTemplate(template)}>{template.name}</button>)}
      <button type="button" className="chip" onClick={()=>setNaming(true)} disabled={!canSaveTemplate}>+ Template</button>
    </div>
    <div className="stack-bar" role="img" aria-label={`Ripartizione: ${formatBasisPoints(Math.round(assignedPoints*100))} assegnato`}>{rows.filter(row=>row.cents>0n).map(row=><span key={row.bucket.id} style={{flex:Number(row.cents),background:row.bucket.color}}/>)}{remaining>0n&&<span className="rest" style={{flex:Number(remaining)}}/>}</div>
    <div className="dist-rows">{rows.map(row=><label key={row.bucket.id} className={`dist-row${row.cents>0n?'':' zero'}`}>
      <i className="dot" style={{background:row.bucket.color}}/>
      <span className="dist-name">{row.bucket.name}</span>
      {mode==='percentage'
        ?<><span className="dist-field mono"><input aria-label={`Percentuale per ${row.bucket.name}`} inputMode="decimal" placeholder="0" value={values[row.bucket.id]??''} onChange={event=>{setValues({...values,[row.bucket.id]:sanitizeDecimalInput(event.currentTarget.value)});setTemplateId(null);touch()}} onBlur={event=>setValues(current=>({...current,[row.bucket.id]:normalizePercentageInput(event.target.value)}))}/>%</span><span className="mono dist-value">{formatEuro(row.cents,hidden)}</span></>
        :<><span className="mono dist-pct">{formatBasisPoints(row.basisPoints)}</span><span className="dist-field mono wide">€<input aria-label={`Importo per ${row.bucket.name}`} inputMode="decimal" placeholder="0,00" value={values[row.bucket.id]??''} onChange={event=>{setValues({...values,[row.bucket.id]:sanitizeDecimalInput(event.currentTarget.value)});setTemplateId(null);touch()}}/></span></>}
    </label>)}</div>
    <div className="row-between mono dist-foot"><span className="mu">Assegnato {assignedPoints.toLocaleString('it-IT',{maximumFractionDigits:1})}%</span><span className={remaining===0n&&totalCents>0n?'pos':remaining<0n?'neg':'mu'}>{remaining<0n?'Oltre':'Rimanente'} {formatEuro(remaining<0n?-remaining:remaining,hidden)}</span></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="flow-spacer"/>
    <button className="btn" disabled={!complete||mutation.isPending}>{mutation.isPending?'Distribuzione…':`Distribuisci ${formatEuro(totalCents,hidden)}`}</button>
  </form>
  {naming&&<TextInputModal title="Salva template" label="Nome del template" submitLabel="Salva" onSubmit={saveTemplate} onClose={()=>setNaming(false)}/>}
  </>;
}

/* ---------- Ribilancia ---------- */
export function RebalancePanel({buckets}:{buckets:Bucket[]}){
  const {hidden}=useAmountPrivacy();
  const finish=useFinish();
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [real,setReal]=useState('');
  const [error,setError]=useState('');
  const key=useRef(newKey());
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const byId=useMemo(()=>new Map(buckets.map(bucket=>[bucket.id,bucket])),[buckets]);
  const selected=selectedIds.flatMap(id=>{const bucket=byId.get(id);return bucket?[bucket]:[]});
  const others=buckets.filter(bucket=>!selectedIds.includes(bucket.id));
  const appTotal=selected.reduce((sum,bucket)=>sum+BigInt(bucket.balanceCents),0n);
  const hasReal=real.trim().length>0;
  const target=safeCents(real);
  const difference=hasReal&&selected.length?target-appTotal:0n;
  const aligned=selected.length>0&&hasReal&&difference===0n;
  // A credit goes entirely to the first bucket; a reduction drains them in order.
  let remaining=-difference;
  const preview=difference>0n
    ?selected.map((bucket,index)=>{const change=index===0?difference:0n;return {bucket,change,next:BigInt(bucket.balanceCents)+change}})
    :selected.map(bucket=>{const balance=BigInt(bucket.balanceCents);const reduction=remaining<balance?remaining:balance;remaining-=reduction;return {bucket,change:-reduction,next:balance-reduction}});
  const valid=selected.length>0&&hasReal&&!aligned;
  const mutation=useMutation({
    mutationFn:()=>api('/rebalances',{method:'POST',body:JSON.stringify({bucketIds:selectedIds,targetTotalCents:target.toString(),idempotencyKey:key.current})}),
    onSuccess:finish,
    onError:()=>setError(difference>0n?'Accredito non riuscito. Riprova.':'Sottrazione non riuscita. Riprova.'),
  });
  function toggle(id:string){key.current=newKey();setError('');setSelectedIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id])}
  function finishDrag(event:DragEndEvent){
    if(!event.over||event.active.id===event.over.id)return;
    setSelectedIds(current=>{const from=current.indexOf(String(event.active.id));const to=current.indexOf(String(event.over!.id));return from>=0&&to>=0?arrayMove(current,from,to):current});
    key.current=newKey();
  }
  function submit(event:FormEvent){
    event.preventDefault();
    if(!selected.length){setError('Seleziona almeno un bucket.');return}
    if(!hasReal){setError('Inserisci il totale reale.');return}
    if(aligned)return;
    mutation.mutate();
  }
  const changes=preview.filter(item=>item.change!==0n);

  return <form className="flow-body" onSubmit={submit}>
    <div className="rebalance-totals">
      <div className="tile"><div className="cap">Nell’app</div><div className="mono rebalance-figure">{formatEuro(appTotal,hidden)}</div></div>
      <label className="tile rebalance-real"><span className="cap">Sul conto</span><span className="rebalance-input"><span className="mono">€</span><input className="mono" aria-label="Totale reale" inputMode="decimal" placeholder="0,00" value={real} onChange={event=>{setReal(sanitizeDecimalInput(event.currentTarget.value));key.current=newKey();setError('')}}/></span></label>
    </div>
    <div className="chip-center">{selected.length>0&&hasReal?<span className={aligned?'chip mono':'lime-chip'}>{aligned?'Totale già allineato':`Differenza ${formatEuro(difference,hidden,{sign:true})}`}</span>:<span className="mono mu rebalance-hint">Scegli i bucket e inserisci il saldo reale</span>}</div>
    <div className="row-between section-row"><span className="cap">Ordine di utilizzo</span><span className="mu small">Trascina per riordinare</span></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishDrag}>
      <SortableContext items={selectedIds} strategy={verticalListSortingStrategy}>
        <div className="rebalance-list">{selected.map((bucket,index)=><RebalanceRow key={bucket.id} bucket={bucket} order={index+1} hidden={hidden} onToggle={toggle} sortable/>)}{others.map(bucket=><RebalanceRow key={bucket.id} bucket={bucket} order={0} hidden={hidden} onToggle={toggle}/>)}</div>
      </SortableContext>
    </DndContext>
    {selected.length>0&&hasReal&&<section className="tile rebalance-result" aria-label="Anteprima ribilanciamento"><span className="cap">Risultato</span>{changes.length===0?<p className="mono mu">Nessuna variazione</p>:changes.map(({bucket,change,next})=><div key={bucket.id} className="rebalance-result-row"><span className="rebalance-result-name"><span>{bucket.name}</span><small className={`mono ${change>0n?'pos':'neg'}`}>{formatEuro(change,hidden,{sign:true})}</small></span><span className="mono rebalance-result-values" aria-label={`Da ${formatEuro(bucket.balanceCents,hidden)} a ${formatEuro(next,hidden)}`}><span className="mu">{formatEuro(bucket.balanceCents,hidden)}</span><span className="mu" aria-hidden="true">→</span><span className={change>0n?'pos':'neg'}>{formatEuro(next,hidden)}</span></span></div>)}</section>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="flow-spacer"/>
    <p className="flow-note">Nessuna modifica finché non confermi</p>
    <button className="btn" disabled={!valid||mutation.isPending}>{mutation.isPending?'Ribilanciamento…':aligned?'Totale già allineato':'Ribilancia'}</button>
  </form>;
}

function RebalanceRow({bucket,order,hidden,onToggle,sortable}:{bucket:Bucket;order:number;hidden:boolean;onToggle:(id:string)=>void;sortable?:boolean}){
  const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition}=useSortable({id:bucket.id,disabled:!sortable});
  const style:CSSProperties=sortable?{transform:CSS.Transform.toString(transform),transition}:{};
  const selected=order>0;
  return <div ref={sortable?setNodeRef:undefined} className={`rebalance-row${selected?'':' off'}`} style={style}>
    <button type="button" className="rebalance-toggle" onClick={()=>onToggle(bucket.id)} aria-pressed={selected} aria-label={selected?`${bucket.name}, ordine ${order}`:`Seleziona ${bucket.name}`}>
      <span className={`order-chip mono${selected?' on':''}`}>{selected?order:'—'}</span>
      <i className="dot" style={{background:bucket.color}}/>
      <span className="rebalance-name">{bucket.name}</span>
      <span className="mono mu">{formatEuro(bucket.balanceCents,hidden)}</span>
    </button>
    {sortable?<button type="button" className="rebalance-grip" ref={setActivatorNodeRef} style={{touchAction:'none'}} {...attributes} {...listeners} aria-label={`Trascina ${bucket.name} per cambiare ordine`}><GripVertical aria-hidden="true"/></button>:<span className="rebalance-grip" aria-hidden="true"><GripVertical/></span>}
  </div>;
}

