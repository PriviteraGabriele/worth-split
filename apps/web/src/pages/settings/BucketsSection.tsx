import { useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Check,Pencil,Plus,Trash2,X } from 'lucide-react';
import { Link,Navigate,useNavigate,useParams } from 'react-router-dom';
import { api,ApiError } from '../../lib/api';
import { formatEuro } from '../../lib/money';
import { useAmountPrivacy } from '../../lib/amountPrivacyContext';
import { useMobileLayout } from '../../lib/useMobileLayout';
import { refreshFinancialData } from '../../lib/queryInvalidation';
import { BucketSquare } from '../../components/BucketSquare';
import { BucketColorPicker } from '../../components/BucketColorPicker';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import type { Bucket,Dashboard,ManagedPlannedExpense } from '../../types';
import { SettingsPanel } from './SettingsPanel';

const LIST_PATH='/impostazioni/bucket';
const types:Bucket['type'][]=['spending','saving','investment','other'];
const bucketTypeLabels:Record<Bucket['type'],string>={spending:'Spese',saving:'Risparmio',investment:'Investimento',other:'Altro'};
const typeDefaults:Record<Bucket['type'],{icon:string;color:string}>={
  spending:{icon:'💳',color:'#F27A65'},
  saving:{icon:'💰',color:'#8B7CF6'},
  investment:{icon:'📈',color:'#3AAED8'},
  other:{icon:'✨',color:'#E6A44A'},
};

function useDashboard(){
  return useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
}

export function BucketsPage(){
  const {hidden}=useAmountPrivacy();
  const mobile=useMobileLayout();
  const dashboard=useDashboard();
  const plans=useQuery({queryKey:['planned-expenses','manage'],queryFn:({signal})=>api<{expenses:ManagedPlannedExpense[]}>('/planned-expenses/manage',{signal})});
  const [deleting,setDeleting]=useState<Bucket|null>(null);
  const buckets=dashboard.data?.buckets??[];
  const included=buckets.filter(bucket=>bucket.includeInTotal);
  const total=included.reduce((sum,bucket)=>sum+BigInt(bucket.balanceCents),0n);
  const excluded=buckets.length-included.length;
  const newLink=<Link className={mobile?'ib lime':'btn sm'} to={`${LIST_PATH}/nuovo`} aria-label={mobile?'Nuovo bucket':undefined}><Plus aria-hidden="true"/>{!mobile&&'Nuovo bucket'}</Link>;

  return <SettingsPanel cap="Bucket" title="Bucket" action={mobile?newLink:undefined} footer={mobile?undefined:<><span className="foot-note">Un bucket si elimina solo con saldo a €0,00 e senza spese previste attive.</span>{newLink}</>}>
    {dashboard.isLoading?<div className="skeleton hero"/>:dashboard.isError?<p className="form-error">Impossibile caricare i bucket.</p>:buckets.length===0?<div className="empty"><span className="empty-icon"><Plus/></span><h3>Nessun bucket</h3><p>Crea il primo bucket per iniziare a dividere il patrimonio.</p><Link className="btn sm" to={`${LIST_PATH}/nuovo`}>Crea bucket</Link></div>:<>
      <section className="hero-tile manage-hero">
        <div className="row-between"><div><span className="cap">Totale nei bucket</span><Money className="hero-amount mono" cents={total} hidden={hidden}/></div><span className="mono hero-meta">{included.length} {included.length===1?'attivo':'attivi'}{excluded>0&&<><br/>{excluded} {excluded===1?'escluso':'esclusi'} dal totale</>}</span></div>
        <span className="share-bar" aria-hidden="true">{included.filter(bucket=>BigInt(bucket.balanceCents)>0n).map(bucket=><i key={bucket.id} style={{flex:Number(BigInt(bucket.balanceCents)),background:bucket.color}}/>)}</span>
      </section>
      <div className="manage-list">{buckets.map(bucket=><article className={`manage-row${bucket.includeInTotal?'':' muted'}`} key={bucket.id}>
        <BucketSquare type={bucket.type} color={bucket.color} size={40}/>
        <span className="grow"><strong className="manage-name">{bucket.name}{!bucket.includeInTotal&&<span className="tag">Escluso</span>}</strong><small>{bucketTypeLabels[bucket.type]}{bucket.description?` · ${bucket.description}`:''}</small></span>
        <span className="mono manage-amount">{formatEuro(bucket.balanceCents,hidden)}</span>
        <Link className="act-btn" to={`${LIST_PATH}/${bucket.id}`} aria-label={`Modifica ${bucket.name}`} title="Modifica"><Pencil aria-hidden="true"/></Link>
        <button type="button" className="act-btn neg" onClick={()=>setDeleting(bucket)} aria-label={`Elimina ${bucket.name}`} title="Elimina"><Trash2 aria-hidden="true"/></button>
      </article>)}</div>
      {mobile&&<p className="sub-note">Un bucket si elimina solo con saldo a €0,00 e senza spese previste attive. I bucket esclusi non entrano nel totale della Home.</p>}
    </>}
    {deleting&&<DeleteBucketSheet bucket={deleting} plannedCount={(plans.data?.expenses??[]).filter(expense=>expense.bucketId===deleting.id&&!expense.archivedAt).length} onClose={()=>setDeleting(null)}/>}
  </SettingsPanel>;
}

function DeleteBucketSheet({bucket,plannedCount,onClose}:{bucket:Bucket;plannedCount:number;onClose:()=>void}){
  const {hidden}=useAmountPrivacy();
  const qc=useQueryClient();
  const empty=BigInt(bucket.balanceCents)===0n;
  const remove=useMutation({
    mutationFn:()=>api(`/buckets/${bucket.id}`,{method:'DELETE'}),
    onSuccess:()=>{
      refreshFinancialData(qc);
      void qc.invalidateQueries({queryKey:['templates']});
      void qc.invalidateQueries({queryKey:['planned-expenses']});
      onClose();
    },
  });
  const errorCode=remove.error instanceof ApiError?remove.error.code:undefined;
  return <Modal title={`Eliminare ${bucket.name}?`} onClose={onClose}><div className="confirm-sheet left">
    <span className="confirm-icon danger"><Trash2 aria-hidden="true"/></span>
    <div className="sheet-card"><BucketSquare type={bucket.type} color={bucket.color} size={36}/><strong className="grow">{bucket.name}</strong><span className="mono">{formatEuro(bucket.balanceCents,hidden)}</span></div>
    <span className="cap">Prima di eliminare</span>
    <ul className="rule-list">
      <li className={empty?'ok':'bad'}><span className="rule-dot" aria-hidden="true">{empty?<Check/>:<X/>}</span>Il saldo deve essere a €0,00</li>
      <li className={plannedCount===0?'ok':'warn'}><span className="rule-dot" aria-hidden="true">{plannedCount===0?<Check/>:<X/>}</span>{plannedCount===0?'Nessuna spesa prevista attiva':`${plannedCount} ${plannedCount===1?'spesa prevista collegata':'spese previste collegate'}: archiviale prima`}</li>
    </ul>
    <small>Le operazioni già registrate resteranno nello storico.</small>
    {remove.isError&&<p className="form-error" role="alert">{errorCode==='BUCKET_HAS_ACTIVE_PLANNED_EXPENSES'?'Il bucket ha ancora spese previste attive. Archiviale prima di eliminarlo.':errorCode==='BUCKET_MUST_BE_EMPTY'?'Il bucket contiene ancora denaro. Trasferisci il saldo prima di eliminarlo.':'Non è stato possibile eliminare il bucket. Riprova.'}</p>}
    {!empty&&<Link className="btn" to="/sposta/trasferisci">Trasferisci il saldo</Link>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={onClose} disabled={remove.isPending}>Annulla</button><button type="button" className="btn danger" onClick={()=>remove.mutate()} disabled={!empty||remove.isPending}>{remove.isPending?'Eliminazione…':'Elimina'}</button></div>
  </div></Modal>;
}

export function BucketEditorPage(){
  const {id}=useParams();
  const dashboard=useDashboard();
  if(!id)return <BucketEditor/>;
  if(dashboard.isLoading)return <SettingsPanel cap="Bucket · Modifica" title="Modifica bucket" back={LIST_PATH} closeIcon><div className="skeleton card"/></SettingsPanel>;
  const bucket=dashboard.data?.buckets.find(item=>item.id===id);
  if(!bucket)return <Navigate to={LIST_PATH} replace/>;
  return <BucketEditor key={bucket.id} bucket={bucket}/>;
}

function BucketEditor({bucket}:{bucket?:Bucket}){
  const {hidden}=useAmountPrivacy();
  const qc=useQueryClient();
  const navigate=useNavigate();
  const [name,setName]=useState(bucket?.name??'');
  const [type,setType]=useState<Bucket['type']>(bucket?.type??'spending');
  const [color,setColor]=useState(bucket?.color??typeDefaults.spending.color);
  const save=useMutation({
    mutationFn:(body:unknown)=>bucket?api(`/buckets/${bucket.id}`,{method:'PATCH',body:JSON.stringify(body)}):api('/buckets',{method:'POST',body:JSON.stringify(body)}),
    onSuccess:()=>{
      refreshFinancialData(qc);
      void qc.invalidateQueries({queryKey:['templates']});
      navigate(LIST_PATH);
    },
  });

  function chooseType(next:Bucket['type']){
    setType(next);
    // A new bucket follows the type's default colour until one is picked.
    if(!bucket)setColor(typeDefaults[next].color);
  }
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    save.mutate({
      name:name.trim(),
      description:String(form.get('description')??'').trim()||null,
      type,
      icon:bucket?.icon??typeDefaults[type].icon,
      color,
      monthlyTargetCents:bucket?.monthlyTargetCents??null,
    });
  }

  const label=bucket?'Salva modifiche':'Crea bucket';
  return <SettingsPanel cap={bucket?'Bucket · Modifica':'Bucket · Nuovo'} title={bucket?'Modifica bucket':'Nuovo bucket'} back={LIST_PATH} closeIcon footer={<button type="submit" form="bucket-form" className="btn" disabled={save.isPending}>{save.isPending?'Salvataggio…':label}</button>}>
    <section className="tile bucket-preview" aria-label="Anteprima del bucket">
      <div className="row-between"><BucketSquare type={type} color={color} size={30}/><span className="cap">Anteprima</span></div>
      <div><div className="bucket-preview-name">{name.trim()||'Nome del bucket'}</div><Money className="mono bucket-preview-amount" cents={bucket?.balanceCents??'0'} hidden={hidden}/></div>
    </section>
    <form id="bucket-form" className="sub-form" onSubmit={submit}>
      <label className="field"><span className="cap">Nome</span><span className="input on-surface"><input name="name" value={name} onChange={event=>setName(event.target.value)} placeholder="Es. Fondo emergenza" maxLength={60} required enterKeyHint="next"/></span></label>
      <label className="field"><span className="cap">Descrizione · facoltativa</span><span className="input on-surface"><textarea name="description" defaultValue={bucket?.description??''} maxLength={300} placeholder="A cosa serve questo bucket"/></span></label>
      <fieldset className="field"><legend className="cap">Tipo</legend><div className="choice-row">{types.map(item=><button type="button" className={type===item?'choice selected':'choice'} onClick={()=>chooseType(item)} aria-pressed={type===item} key={item}><BucketSquare type={item} color={type===item?color:'var(--mu)'} size={34}/><strong>{bucketTypeLabels[item]}</strong></button>)}</div></fieldset>
      <fieldset className="field"><legend className="cap">Colore</legend><BucketColorPicker value={color} onChange={setColor}/></fieldset>
      {save.isError&&<p className="form-error" role="alert">{bucket?'Impossibile salvare le modifiche.':'Impossibile creare il bucket.'}</p>}
    </form>
  </SettingsPanel>;
}
