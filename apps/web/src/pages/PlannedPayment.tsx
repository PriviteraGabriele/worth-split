import { useRef,useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { PencilLine } from 'lucide-react';
import { Navigate,useNavigate,useParams,useSearchParams } from 'react-router-dom';
import { api,newKey } from '../lib/api';
import { centsToInput,eurosToCents,formatEuro,formatEuroCompact } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { refreshFinancialData } from '../lib/queryInvalidation';
import { frequencyLabel,pendingAmount,todayMonth } from '../lib/planned';
import type { PlannedExpense,PlannedExpensesResponse } from '../types';
import { FlowHeader } from '../components/FlowHeader';
import { AmountEntry } from '../components/AmountEntry';
import { Keypad } from '../components/Keypad';

export function PlannedPayment(){
  const {id}=useParams();
  const [searchParams]=useSearchParams();
  const month=/^\d{4}-\d{2}$/.test(searchParams.get('mese')??'')?searchParams.get('mese')!:todayMonth();
  const planned=useQuery({queryKey:['planned-expenses',month],queryFn:({signal})=>api<PlannedExpensesResponse>(`/planned-expenses?${new URLSearchParams({month})}`,{signal})});
  if(planned.isLoading)return <div className="flow"><div className="skeleton card"/></div>;
  const expense=planned.data?.expenses.find(item=>item.id===id);
  if(!expense||expense.status!=='open'||!expense.includedInEstimatedTotal)return <Navigate to="/previsioni" replace/>;
  return <PaymentForm key={expense.id} expense={expense} month={month}/>;
}

export function PaymentForm({expense,month,onDone}:{expense:PlannedExpense;month:string;onDone?:()=>void}){
  const {hidden}=useAmountPrivacy();
  const qc=useQueryClient();
  const navigate=useNavigate();
  const fixed=expense.amountMode==='fixed';
  const [amount,setAmount]=useState(fixed?centsToInput(expense.amountCents):'');
  const [note,setNote]=useState('');
  const [error,setError]=useState('');
  const paymentKey=useRef(newKey());
  const alreadyPaid=BigInt(expense.actualAmountCents);
  const planned=BigInt(expense.amountCents);
  const residual=pendingAmount(expense);
  const done=()=>{if(onDone)onDone();else navigate('/previsioni')};
  const mutation=useMutation({
    mutationFn:({amountCents,idempotencyKey}:{amountCents:string;idempotencyKey:string})=>api(`/planned-expenses/${expense.id}/payments`,{method:'POST',body:JSON.stringify({month,amountCents,complete:fixed,idempotencyKey,...(note.trim()?{note:note.trim()}:{})})}),
    onSuccess:()=>{refreshFinancialData(qc);void qc.invalidateQueries({queryKey:['planned-expenses']});done()},
    onError:()=>setError('Impossibile registrare l’addebito. Controlla il saldo del bucket e riprova.'),
  });
  const completeWithoutPayment=useMutation({
    mutationFn:()=>api(`/planned-expenses/${expense.id}/complete`,{method:'POST',body:JSON.stringify({month})}),
    onSuccess:()=>{
      // Completing an estimate changes the reservation shown on the home page,
      // even though it does not create a further ledger operation.
      void qc.invalidateQueries({queryKey:['dashboard']});
      void qc.invalidateQueries({queryKey:['planned-expenses']});
      done();
    },
    onError:()=>setError('Impossibile completare la spesa. Riprova.'),
  });
  let cents:bigint|null=null;
  try{cents=amount?BigInt(eurosToCents(amount)):null}catch{cents=null}
  function change(value:string){paymentKey.current=newKey();setAmount(value);setError('')}
  function submit(event:FormEvent){
    event.preventDefault();
    setError('');
    try{
      const amountCents=eurosToCents(amount);
      if(BigInt(amountCents)<=0n){setError('L’importo deve essere maggiore di zero.');return}
      mutation.mutate({amountCents,idempotencyKey:paymentKey.current});
    }catch(cause){setError((cause as Error).message)}
  }
  const busy=mutation.isPending||completeWithoutPayment.isPending;
  const label=fixed?(cents&&cents>0n?`Salda ${formatEuro(cents,hidden)}`:'Salda'):(cents&&cents>0n?`Registra ${formatEuro(cents,hidden)}`:'Registra addebito');
  const paidShare=planned>0n?Number((alreadyPaid>planned?planned:alreadyPaid)*1000n/planned)/10:0;

  return <form className="flow payment" onSubmit={submit}>
    <FlowHeader to="/previsioni" kind="close" title={<span className="cap">{fixed?'Fissa':'Stimata'} · {frequencyLabel(expense.frequency)}</span>}/>
    <section className="tile payment-card">
      <div className="row-between"><h1>{expense.name}</h1><span className="payment-bucket"><i className="dot" style={{background:expense.bucketColor??'var(--ink)'}}/>{expense.bucketName}</span></div>
      {fixed
        ?<div className="row-between mono payment-meta"><span className="mu">Importo fisso</span><span>{formatEuro(planned,hidden)}</span></div>
        :<><div className="split-bar" aria-hidden="true"><span className="paid" style={{flex:paidShare}}/><span style={{flex:100-paidShare}}/></div><div className="row-between mono payment-meta"><span className="pos">● {formatEuro(alreadyPaid,hidden)} registrati</span><span className="mu">stima {formatEuro(planned,hidden)}</span></div></>}
    </section>
    <div className="payment-amount"><div className="cap center">Addebito</div><AmountEntry label={fixed?'Importo da addebitare':'Importo reale'} value={amount} onChange={change} autoFocus/></div>
    <div className="chip-center">{fixed
      ?<button type="button" className="chip mono" aria-pressed={cents===planned} onClick={()=>change(centsToInput(planned.toString()))}>Importo fisso {formatEuroCompact(planned,hidden)}</button>
      :<><button type="button" className="chip mono" aria-pressed={cents===residual&&residual>0n} onClick={()=>change(centsToInput(residual.toString()))} disabled={residual<=0n}>Residuo {formatEuroCompact(residual,hidden)}</button><button type="button" className="chip mono" aria-pressed={cents===planned} onClick={()=>change(centsToInput(planned.toString()))}>Stima {formatEuroCompact(planned,hidden)}</button></>}</div>
    <label className="pill-input"><PencilLine aria-hidden="true"/><input placeholder="Nota (facoltativa)" aria-label="Nota" value={note} maxLength={300} onChange={event=>{paymentKey.current=newKey();setNote(event.currentTarget.value)}}/></label>
    <Keypad value={amount} onChange={change} disabled={busy}/>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="flow-spacer"/>
    <button className="btn" disabled={busy}>{mutation.isPending?'Registrazione…':label}</button>
    {!fixed&&alreadyPaid>0n&&<button type="button" className="btn outline" onClick={()=>completeWithoutPayment.mutate()} disabled={busy}>{completeWithoutPayment.isPending?'Chiusura…':'Chiudi senza nuovo addebito'}</button>}
  </form>;
}
