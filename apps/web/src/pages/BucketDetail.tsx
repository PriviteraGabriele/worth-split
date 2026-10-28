import { useRef,useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { EyeOff,History as HistoryIcon,MoreHorizontal,PencilLine,Power,Trash2 } from 'lucide-react';
import { Link,Navigate,useNavigate,useParams } from 'react-router-dom';
import { api,newKey } from '../lib/api';
import { formatEuro,percent,safeCents } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { refreshFinancialData } from '../lib/queryInvalidation';
import type { Bucket,Dashboard } from '../types';
import { FlowHeader } from '../components/FlowHeader';
import { Money } from '../components/Money';
import { AmountEntry } from '../components/AmountEntry';
import { Keypad } from '../components/Keypad';
import { Modal } from '../components/Modal';
import { AdjustForm } from '../components/AdjustForm';

type Mode='add'|'subtract'|'set';
const modeLabels:Record<Mode,string>={add:'Aggiungi',subtract:'Sottrai',set:'Imposta'};
const typeLabels:Record<Bucket['type'],string>={spending:'Spesa',saving:'Risparmio',investment:'Investimento',other:'Altro'};

export function BucketDetail(){
  const {id}=useParams();
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
  if(dashboard.isLoading)return <div className="flow"><div className="skeleton hero"/></div>;
  const bucket=dashboard.data?.buckets.find(item=>item.id===id);
  if(!bucket||!dashboard.data)return <Navigate to="/" replace/>;
  return <BucketDetailView key={bucket.id} bucket={bucket} totalCents={dashboard.data.totalCents}/>;
}

function BucketDetailView({bucket,totalCents}:{bucket:Bucket;totalCents:string}){
  const qc=useQueryClient();
  const navigate=useNavigate();
  const {hidden}=useAmountPrivacy();
  const [mode,setMode]=useState<Mode>('add');
  const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');
  const [error,setError]=useState('');
  const [sheet,setSheet]=useState<'actions'|'edit'|'delete'|null>(null);
  const key=useRef(newKey());
  const balance=BigInt(bucket.balanceCents);
  const plannedCents=BigInt(bucket.plannedExpenseCents??'0');
  const cents=safeCents(amount);
  const next=mode==='add'?balance+cents:mode==='subtract'?balance-cents:cents;
  const unchanged=mode==='set'?(amount===''||next===balance):cents<=0n;
  const adjust=useMutation({
    mutationFn:()=>api(`/buckets/${bucket.id}/adjust`,{method:'POST',body:JSON.stringify({mode,amountCents:cents.toString(),note:note.trim(),idempotencyKey:key.current})}),
    onSuccess:()=>{refreshFinancialData(qc);navigate('/')},
    onError:()=>setError(mode==='subtract'||next<0n?'Operazione non riuscita: il saldo non può diventare negativo.':'Operazione non riuscita. Riprova.'),
  });
  const visibility=useMutation({
    mutationFn:(includeInTotal:boolean)=>api(`/buckets/${bucket.id}/total-visibility`,{method:'PATCH',body:JSON.stringify({includeInTotal})}),
    onSuccess:()=>{void qc.invalidateQueries({queryKey:['dashboard']});void qc.invalidateQueries({queryKey:['trends']});setSheet(null)},
  });
  function change(value:string){key.current=newKey();setAmount(value);setError('')}
  function submit(event:FormEvent){
    event.preventDefault();
    if(unchanged)return;
    if(next<0n){setError('Il saldo non può diventare negativo.');return}
    adjust.mutate();
  }
  const prefix=mode==='add'?'+':mode==='subtract'?'−':'';
  const share=percent(bucket.balanceCents,totalCents);

  return <><form className="flow bucket-detail" onSubmit={submit}>
    <FlowHeader to="/" title={<span className="cap">Bucket · {typeLabels[bucket.type]}</span>} trailing={<button type="button" className="ib" onClick={()=>setSheet('actions')} aria-label="Altre azioni: modifica, escludi dal totale, elimina"><MoreHorizontal aria-hidden="true"/></button>}/>
    <section className="bucket-hero" style={{background:`color-mix(in srgb, ${bucket.color} 74%, #000)`}}>
      <div className="row-between"><h1>{bucket.name}</h1><span className="mono bucket-hero-chip">{bucket.includeInTotal?`${share.toLocaleString('it-IT')}%`:'escluso'}</span></div>
      <Money className="mono bucket-hero-amount" cents={bucket.balanceCents} hidden={hidden}/>
      <div className="mono bucket-hero-meta">{plannedCents>0n?<><span>Previste {hidden?'••••':`−${formatEuro(plannedCents).slice(1)}`}</span><span>Dopo {formatEuro(balance-plannedCents,hidden)}</span></>:<span>{bucket.includeInTotal?'Conta nel patrimonio totale':'Escluso dal patrimonio totale'}</span>}</div>
    </section>
    <div className="pills" role="group" aria-label="Tipo di modifica">{(Object.keys(modeLabels) as Mode[]).map(item=><button type="button" key={item} aria-pressed={mode===item} onClick={()=>{setMode(item);key.current=newKey();setError('')}}>{modeLabels[item]}</button>)}</div>
    <AmountEntry label={mode==='set'?'Nuovo saldo':'Importo'} value={amount} onChange={change} prefix={prefix} autoFocus hint={<>Nuovo saldo <span className={next>balance?'pos':next<balance?'neg':''}>{formatEuro(next,hidden)}</span></>}/>
    <label className="pill-input"><PencilLine aria-hidden="true"/><input placeholder="Aggiungi una nota" aria-label="Nota" value={note} maxLength={300} onChange={event=>{key.current=newKey();setNote(event.currentTarget.value)}}/></label>
    <Keypad value={amount} onChange={change}/>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="flow-spacer"/>
    <button className="btn" disabled={unchanged||adjust.isPending}>{adjust.isPending?'Salvataggio…':`${modeLabels[mode]} ${formatEuro(cents,hidden)}`}</button>
  </form>

    {sheet==='actions'&&<Modal title={bucket.name} onClose={()=>setSheet(null)}><div className="sheet-list">
      <button type="button" className="sheet-option" onClick={()=>setSheet('edit')}><PencilLine aria-hidden="true"/><span>Modifica bucket<small>Nome, tipo, colore</small></span></button>
      <button type="button" className="sheet-option" onClick={()=>visibility.mutate(!bucket.includeInTotal)} disabled={visibility.isPending}>{bucket.includeInTotal?<EyeOff aria-hidden="true"/>:<Power aria-hidden="true"/>}<span>{bucket.includeInTotal?'Escludi dal patrimonio':'Includi nel patrimonio'}<small>{bucket.includeInTotal?'Non conterà nel totale':'Tornerà nel totale'}</small></span></button>
      <Link className="sheet-option" to={`/storico?bucket=${bucket.id}`}><HistoryIcon aria-hidden="true"/><span>Movimenti del bucket</span></Link>
      <button type="button" className="sheet-option danger" onClick={()=>setSheet('delete')}><Trash2 aria-hidden="true"/><span>Elimina bucket</span></button>
      {visibility.isError&&<p className="form-error">Impossibile aggiornare il bucket. Riprova.</p>}
    </div></Modal>}
    {sheet==='edit'&&<AdjustForm bucket={bucket} initialView="edit" onClose={()=>setSheet(null)}/>}
    {sheet==='delete'&&<AdjustForm bucket={bucket} initialDelete onClose={()=>setSheet(null)}/>}
  </>;
}
