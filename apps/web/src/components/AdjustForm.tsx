import { useCallback,useState,type FormEvent } from 'react';
import { useMutation,useQueryClient } from '@tanstack/react-query';
import { Pencil,Trash2 } from 'lucide-react';
import { api,newKey } from '../lib/api';
import { eurosToCents,formatMoney,sanitizeDecimalInput } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { refreshFinancialData } from '../lib/queryInvalidation';
import type { Bucket } from '../types';
import { Modal } from './Modal';
import { BucketSquare } from './BucketSquare';
import { BucketColorPicker } from './BucketColorPicker';

const types:Bucket['type'][]=['spending','saving','investment','other'];
const labels:Record<Bucket['type'],string>={spending:'Spese',saving:'Risparmio',investment:'Investimento',other:'Altro'};
export function AdjustForm({bucket,onClose,initialView='adjust',initialDelete=false,manage=true}:{bucket:Bucket;onClose:()=>void;initialView?:'adjust'|'edit';initialDelete?:boolean;manage?:boolean}){
  const {hidden}=useAmountPrivacy();
  const qc=useQueryClient();
  const [view,setView]=useState<'adjust'|'edit'>(initialView);
  const [mode,setMode]=useState<'add'|'subtract'>('add');
  const [editType,setEditType]=useState<Bucket['type']>(bucket.type);
  const [editColor,setEditColor]=useState(bucket.color);
  const [confirmDelete,setConfirmDelete]=useState(initialDelete);
  const [error,setError]=useState('');
  const [amount,setAmount]=useState('');
  const amountCents=(()=>{try{return amount?BigInt(eurosToCents(amount)):0n}catch{return 0n}})();
  const currentBalance=BigInt(bucket.balanceCents);
  const nextBalance=currentBalance+(mode==='add'?amountCents:-amountCents);
  const cannotDelete=currentBalance!==0n;
  const refreshAndClose=useCallback((refreshTemplates=false)=>{
    refreshFinancialData(qc);
    if(refreshTemplates)void qc.invalidateQueries({queryKey:['templates']});
    onClose();
  },[onClose,qc]);
  const adjustment=useMutation({mutationFn:(body:unknown)=>api(`/buckets/${bucket.id}/adjust`,{method:'POST',body:JSON.stringify(body)}),onSuccess:()=>refreshAndClose()});
  const update=useMutation({mutationFn:(body:unknown)=>api(`/buckets/${bucket.id}`,{method:'PATCH',body:JSON.stringify(body)}),onSuccess:()=>refreshAndClose(true)});
  const remove=useMutation({mutationFn:()=>api(`/buckets/${bucket.id}`,{method:'DELETE'}),onSuccess:()=>refreshAndClose(true)});

  function submitAdjustment(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');const form=new FormData(event.currentTarget);try{adjustment.mutate({mode,amountCents:eurosToCents(amount),note:String(form.get('note')||''),idempotencyKey:newKey()})}catch(cause){setError((cause as Error).message)}}
  function submitEdit(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');const form=new FormData(event.currentTarget);try{update.mutate({name:form.get('name'),description:form.get('description')||null,type:editType,icon:bucket.icon,color:editColor,monthlyTargetCents:null})}catch(cause){setError((cause as Error).message)}}
  function askToDelete(){setError('');setConfirmDelete(true)}

  if(confirmDelete)return <Modal title="Elimina bucket?" onClose={()=>initialDelete?onClose():setConfirmDelete(false)}><div className="delete-confirmation"><span className="delete-confirmation-icon"><Trash2/></span><p>Stai per eliminare <strong>{bucket.name}</strong> dalla dashboard.</p><small>{cannotDelete?<>Il bucket contiene ancora <strong>{formatMoney(currentBalance.toString(),hidden)}</strong>. Trasferisci o sottrai tutto il saldo prima di eliminarlo.</>:<>Il bucket non sarà più utilizzabile, ma le operazioni già registrate resteranno nello storico.</>}</small>{cannotDelete&&<p className="form-error">Il saldo deve essere pari a 0,00 €.</p>}{remove.isError&&<p className="form-error">Non è stato possibile eliminare il bucket. Riprova.</p>}<div className="delete-confirmation-actions"><button className="secondary" onClick={()=>initialDelete?onClose():setConfirmDelete(false)} disabled={remove.isPending}>Annulla</button><button className="danger-button" onClick={()=>remove.mutate()} disabled={remove.isPending||cannotDelete}>{remove.isPending?'Eliminazione…':'Elimina bucket'}</button></div></div></Modal>;

  if(view==='edit')return <Modal title="Modifica bucket" onClose={onClose}><form className="stack" onSubmit={submitEdit}>
    <label>Nome<input name="name" defaultValue={bucket.name} maxLength={60} required data-auto-focus enterKeyHint="next"/></label>
    <label>Descrizione<textarea name="description" defaultValue={bucket.description??''} maxLength={300}/></label>
    <fieldset><legend>Tipo</legend><div className="choice-row">{types.map(type=><button type="button" className={editType===type?'choice selected':'choice'} onClick={()=>setEditType(type)} key={type}><BucketSquare type={type} color={editColor} size={34}/><strong>{labels[type]}</strong></button>)}</div></fieldset>
    <fieldset><legend>Colore</legend><BucketColorPicker value={editColor} onChange={setEditColor}/></fieldset>
    {(error||update.isError)&&<p className="form-error">{error||'Impossibile salvare le modifiche.'}</p>}
    <div className="edit-actions"><button type="button" className="secondary" onClick={()=>{if(initialView==='edit')onClose();else{setView('adjust');setError('')}}}>Annulla</button><button className="primary" disabled={update.isPending}>{update.isPending?'Salvataggio…':'Salva modifiche'}</button></div>
  </form></Modal>;

  const managementActions=manage?<><button className="management-icon edit" onClick={()=>setView('edit')} aria-label="Modifica bucket" title="Modifica"><Pencil/></button><button className="management-icon delete" onClick={askToDelete} disabled={remove.isPending} aria-label="Elimina bucket" title="Elimina"><Trash2/></button></>:undefined;
  return <Modal title={bucket.name} onClose={onClose} actions={managementActions}><form className="stack" onSubmit={submitAdjustment}>
    <div className="adjust-actions" aria-label="Tipo di modifica"><button type="button" className={`adjust-add ${mode==='add'?'active':''}`} onClick={()=>setMode('add')} aria-pressed={mode==='add'} aria-label="Aggiungi"><span aria-hidden="true">+</span></button><button type="button" className={`adjust-subtract ${mode==='subtract'?'active':''}`} onClick={()=>setMode('subtract')} aria-pressed={mode==='subtract'} aria-label="Sottrai"><span aria-hidden="true">−</span></button></div>
    <label>Importo<div className="money-input"><span>€</span><input name="amount" inputMode="decimal" enterKeyHint="next" placeholder="0,00" value={amount} onChange={event=>setAmount(sanitizeDecimalInput(event.currentTarget.value))} required data-auto-focus/></div></label>
    <section className={`adjust-preview ${mode}`} aria-live="polite" aria-label="Anteprima del saldo"><div><span>Saldo attuale</span><strong>{formatMoney(currentBalance.toString(),hidden)}</strong></div><b>{mode==='add'?'+':'−'}{formatMoney(amountCents.toString(),hidden)}</b><div><span>Nuovo saldo</span><strong>{formatMoney(nextBalance.toString(),hidden)}</strong></div></section>
    <label>Nota<input name="note" placeholder="Aggiungi una nota (facoltativa)" maxLength={300} enterKeyHint="done"/></label>
    {(error||adjustment.isError||remove.isError)&&<p className="form-error">{error||'Operazione non riuscita. Controlla il saldo.'}</p>}
    <button className={`primary confirm-adjust ${mode}`} disabled={adjustment.isPending}>{adjustment.isPending?'Salvataggio…':mode==='add'?'Aggiungi':'Togli'}</button>
  </form></Modal>;
}
