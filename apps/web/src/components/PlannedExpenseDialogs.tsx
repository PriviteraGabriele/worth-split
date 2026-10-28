import { useRef,useState,type CSSProperties,type FormEvent } from 'react';
import { useMutation,useQueryClient } from '@tanstack/react-query';
import { api,newKey } from '../lib/api';
import { eurosToCents,formatEuro,sanitizeDecimalInput } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { refreshFinancialData } from '../lib/queryInvalidation';
import { bucketGroups,categoryLabel,dueDescription,formatMonth,frequencyLabel,pendingAmount,type BucketExpenseGroup } from '../lib/planned';
import type { PlannedExpense } from '../types';
import { Modal } from './Modal';

export function PlannedExpenseSummary({expenses,summary,month,onClose}:{expenses:PlannedExpense[];summary:'pending'|'actual';month:string;onClose:()=>void}){
  const {hidden}=useAmountPrivacy();
  const pending=summary==='pending';
  const visible=pending?expenses.filter(expense=>expense.status==='open'&&expense.includedInEstimatedTotal):expenses.filter(expense=>BigInt(expense.actualAmountCents)!==0n);
  const amount=(expense:PlannedExpense)=>pending?pendingAmount(expense):BigInt(expense.actualAmountCents);
  const groups=bucketGroups(visible,amount);
  const total=groups.reduce((sum,group)=>sum+group.total,0n);
  const expenseLabel=visible.length===1?'spesa':'spese';
  return <Modal title={pending?'Da pagare per bucket':'Già registrato per bucket'} onClose={onClose}><div className="summary-sheet">{groups.length?<>
    <section className="hero-tile summary-hero" aria-label="Riepilogo totale">
      <span className="cap">{formatMonth(month)}</span>
      <span className="summary-hero-label">{pending?'Totale ancora da pagare':'Totale già registrato'}</span>
      <strong className="mono">{formatEuro(total,hidden)}</strong>
      <span className="summary-hero-meta mono">{visible.length} {expenseLabel} · {groups.length} bucket</span>
    </section>
    <BucketExpenseGroups groups={groups} amount={amount} hidden={hidden} total={total} planned={pending}/>
  </>:<p className="status-message">{pending?'Nessuna spesa da pagare in questo mese.':'Nessun addebito registrato in questo mese.'}</p>}</div></Modal>;
}

function BucketExpenseGroups({groups,amount,hidden,total,planned}:{groups:BucketExpenseGroup[];amount:(expense:PlannedExpense)=>bigint;hidden:boolean;total:bigint;planned:boolean}){
  return <div className="summary-groups">{groups.map(group=>{
    const percentage=total>0n?Number((group.total*100n)/total):0;
    const color=group.bucketColor??'var(--ink)';
    return <section className="summary-group" style={{'--group-color':color} as CSSProperties} key={group.bucketId}>
      <header className="row-between"><div><span className="summary-group-name"><i className="dot" style={{background:color}}/>{group.bucketName}</span><small className="mu">{group.expenses.length} {group.expenses.length===1?'spesa':'spese'} · {percentage}% del totale</small></div><strong className="mono">{formatEuro(group.total,hidden)}</strong></header>
      <div className="progress thin" aria-hidden="true"><span style={{width:`${percentage}%`,background:color}}/></div>
      <ul>{group.expenses.map(expense=><li key={expense.id} className="row-between"><div><strong>{expense.name}</strong><small className="mu">{planned?dueDescription(expense):expense.status==='completed'?'Spesa saldata':'Pagamento registrato'}</small></div><strong className="mono">{formatEuro(amount(expense),hidden)}</strong></li>)}</ul>
    </section>;
  })}</div>;
}

export function PlannedExpenseDetails({expense,month,onClose}:{expense:PlannedExpense;month:string;onClose:()=>void}){
  const {hidden}=useAmountPrivacy();
  const actual=BigInt(expense.actualAmountCents);
  const qc=useQueryClient();
  const [mode,setMode]=useState<'details'|'correct'|'cancel'|'visibility'>('details');
  const [total,setTotal]=useState('');
  const [note,setNote]=useState('');
  const [error,setError]=useState('');
  const correctionKey=useRef(newKey());
  const cancellationKey=useRef(newKey());
  const completed=expense.status==='completed';
  const closeWithRefresh=(financial:boolean)=>{
    if(financial)refreshFinancialData(qc);
    else void qc.invalidateQueries({queryKey:['dashboard']});
    void qc.invalidateQueries({queryKey:['planned-expenses']});
    onClose();
  };
  const reopen=useMutation({
    mutationFn:()=>api<{status:'open';duplicate?:boolean}>(`/planned-expenses/${expense.id}/reopen`,{method:'POST',body:JSON.stringify({month})}),
    onSuccess:()=>closeWithRefresh(false),
  });
  const correct=useMutation({
    mutationFn:({actualTotalCents,note}:{actualTotalCents:string;note:string})=>api(`/planned-expenses/${expense.id}/correct`,{method:'POST',body:JSON.stringify({month,actualTotalCents,idempotencyKey:correctionKey.current,...(note.trim()?{note:note.trim()}:{}),})}),
    onSuccess:()=>closeWithRefresh(true),
  });
  const cancelPayments=useMutation({
    mutationFn:()=>api(`/planned-expenses/${expense.id}/cancel-payments`,{method:'POST',body:JSON.stringify({month,idempotencyKey:cancellationKey.current})}),
    onSuccess:()=>closeWithRefresh(true),
  });
  const visibility=useMutation({
    mutationFn:({includedInEstimatedTotal,scope}:{includedInEstimatedTotal:boolean;scope:'month'|'from_month'})=>api(`/planned-expenses/${expense.id}/estimated-total-visibility`,{method:'POST',body:JSON.stringify({month,includedInEstimatedTotal,scope})}),
    onSuccess:()=>closeWithRefresh(false),
  });
  const pending=reopen.isPending||correct.isPending||cancelPayments.isPending||visibility.isPending;
  function submitCorrection(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setError('');
    try{
      const actualTotalCents=eurosToCents(total);
      if(BigInt(actualTotalCents)<=0n){setError('Il totale effettivo deve essere maggiore di zero.');return}
      correct.mutate({actualTotalCents,note});
    }catch(cause){setError((cause as Error).message)}
  }
  const actionError=error||(reopen.isError||correct.isError||cancelPayments.isError||visibility.isError?'Impossibile aggiornare la spesa. Riprova.':'');
  return <Modal title={expense.name} onClose={onClose}>
    {mode==='details'&&<div className="stack">
      <div className="detail-grid">
        {expense.description&&<div className="wide"><span className="cap">Descrizione</span><strong>{expense.description}</strong></div>}
        <div><span className="cap">Tipo</span><strong>{categoryLabel(expense.category)}</strong></div>
        <div><span className="cap">Frequenza</span><strong>{frequencyLabel(expense.frequency)}</strong></div>
        <div><span className="cap">Bucket</span><strong>{expense.bucketName}</strong></div>
        <div><span className="cap">Scadenza</span><strong>{dueDescription(expense)}</strong></div>
        <div><span className="cap">{expense.amountMode==='fixed'?'Importo fisso':'Importo stimato'}</span><strong className="mono">{formatEuro(expense.amountCents,hidden)}</strong></div>
        <div><span className="cap">{completed?'Totale effettivo':'Già addebitato'}</span><strong className={`mono${actual>0n?' pos':''}`}>{formatEuro(expense.actualAmountCents,hidden)}</strong></div>
        <div><span className="cap">Movimenti storici</span><strong className="mono">{expense.paymentCount}</strong></div>
      </div>
      {expense.paymentCount>0&&<p className="note">Comprendono addebiti, rettifiche e annullamenti; il totale sopra è già al netto.</p>}
      {completed&&<div className="sheet-actions"><button type="button" className="btn outline" onClick={()=>reopen.mutate()} disabled={pending}>Riapri per altri addebiti</button><button type="button" className="btn outline" onClick={()=>{setError('');setMode('correct')}} disabled={pending}>Correggi totale effettivo</button>{actual>0n&&<button type="button" className="btn danger" onClick={()=>{setError('');setMode('cancel')}} disabled={pending}>Annulla pagamenti e riapri</button>}</div>}
      {!completed&&actual===0n&&expense.paymentCount===0&&<div className="sheet-actions">{expense.includedInEstimatedTotal?<button type="button" className="btn outline" onClick={()=>{setError('');setMode('visibility')}} disabled={pending}>Nascondi dal previsto</button>:<><p className="note">La spesa è esclusa dal totale previsto. Per registrare un pagamento devi prima riattivarla.</p><button type="button" className="btn" onClick={()=>visibility.mutate({includedInEstimatedTotal:true,scope:'from_month'})} disabled={pending}>{pending?'Inclusione…':'Includi'}</button></>}</div>}
      {actionError&&<p className="form-error">{actionError}</p>}
    </div>}
    {mode==='correct'&&<form className="stack" onSubmit={submitCorrection}><p className="note">Registra una sola rettifica per portare il totale effettivo a quello indicato. Lo storico precedente resta invariato.</p><label>Nuovo totale effettivo<input inputMode="decimal" value={total} onChange={event=>{correctionKey.current=newKey();setTotal(sanitizeDecimalInput(event.currentTarget.value))}} placeholder="0,00" required data-auto-focus/></label><label>Nota <small>facoltativa</small><input value={note} onChange={event=>{correctionKey.current=newKey();setNote(event.currentTarget.value)}} maxLength={300} placeholder="Motivo della rettifica"/></label>{actionError&&<p className="form-error">{actionError}</p>}<div className="edit-actions"><button type="button" className="secondary" onClick={()=>setMode('details')} disabled={pending}>Indietro</button><button className="primary" disabled={pending}>{pending?'Correzione…':'Conferma rettifica'}</button></div></form>}
    {mode==='cancel'&&<div className="stack"><p className="warning">Annullerai il totale di {formatEuro(expense.actualAmountCents,hidden)} con un movimento compensativo. Il saldo del bucket sarà ripristinato e la spesa tornerà aperta.</p>{actionError&&<p className="form-error">{actionError}</p>}<div className="edit-actions"><button type="button" className="secondary" onClick={()=>setMode('details')} disabled={pending}>Indietro</button><button type="button" className="danger-button" onClick={()=>cancelPayments.mutate()} disabled={pending}>{pending?'Annullamento…':'Conferma annullamento'}</button></div></div>}
    {mode==='visibility'&&<div className="stack"><p className="note">Scegli per quanto tempo escludere questa spesa dal totale previsto. Gli addebiti già registrati non vengono modificati.</p><div className="edit-actions"><button type="button" className="secondary" onClick={()=>visibility.mutate({includedInEstimatedTotal:false,scope:'month'})} disabled={pending}>Solo questo mese</button><button type="button" className="danger-button" onClick={()=>visibility.mutate({includedInEstimatedTotal:false,scope:'from_month'})} disabled={pending}>Questo mese e futuri</button></div><button type="button" className="secondary" onClick={()=>setMode('details')} disabled={pending}>Indietro</button>{actionError&&<p className="form-error">{actionError}</p>}</div>}
  </Modal>;
}
