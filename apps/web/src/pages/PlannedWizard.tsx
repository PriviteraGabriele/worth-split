import { useMemo,useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { ArrowRight,ChevronLeft,X } from 'lucide-react';
import { Link,Navigate,useNavigate,useParams,useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { centsToInput,eurosToCents,sanitizeDecimalInput } from '../lib/money';
import { categoryLabels,formatMonth,shiftMonth,todayMonth } from '../lib/planned';
import type { Bucket,Dashboard,ManagedPlannedExpense,PlannedExpenseAmountMode,PlannedExpenseCategory,PlannedExpenseDueRule,PlannedExpenseFrequency,PlannedExpenseInput } from '../types';
import { Modal } from '../components/Modal';

const categories:PlannedExpenseCategory[]=['subscription','installment','one_time','other'];
const frequencies:{value:PlannedExpenseFrequency;label:string;hint:string}[]=[
  {value:'monthly',label:'Mensile',hint:'×12'},{value:'bimonthly',label:'Bimestrale',hint:'×6'},{value:'quarterly',label:'Trimestrale',hint:'×4'},
  {value:'semiannual',label:'Semestrale',hint:'×2'},{value:'annual',label:'Annuale',hint:'×1'},{value:'once',label:'Una tantum',hint:'1 volta'},
];
const dueRules:{value:PlannedExpenseDueRule;label:string;hint:string}[]=[
  {value:'month',label:'Nel mese',hint:'Senza un giorno preciso'},{value:'exact',label:'Data precisa',hint:'Scegli il giorno'},
  {value:'start',label:'Inizio mese',hint:'Nei primi giorni'},{value:'mid',label:'Metà mese',hint:'Verso il 15'},{value:'end',label:'Fine mese',hint:'Negli ultimi giorni'},
];
const titles=['Che spesa è?','Quanto e ogni quanto?','Ultimi dettagli'];

function asMonth(value:string|null|undefined){return value&&/^\d{4}-\d{2}$/.test(value)?value:''}
function defaultFrequency(category:PlannedExpenseCategory):PlannedExpenseFrequency|undefined{return category==='subscription'||category==='installment'?'monthly':category==='one_time'?'once':undefined}

export function PlannedWizard(){
  const {id}=useParams();
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
  const manage=useQuery({queryKey:['planned-expenses','manage'],queryFn:({signal})=>api<{expenses:ManagedPlannedExpense[]}>('/planned-expenses/manage',{signal}),enabled:Boolean(id)});
  if(dashboard.isLoading||(id&&manage.isLoading))return <div className="flow"><div className="skeleton card"/></div>;
  const expense=id?manage.data?.expenses.find(item=>item.id===id):undefined;
  if(id&&!expense)return <Navigate to="/previsioni" replace/>;
  return <WizardForm key={id??'new'} expense={expense} buckets={dashboard.data?.buckets??[]}/>;
}

function WizardForm({expense,buckets}:{expense?:ManagedPlannedExpense;buckets:Bucket[]}){
  const qc=useQueryClient();
  const navigate=useNavigate();
  const [searchParams]=useSearchParams();
  const selectedMonth=asMonth(searchParams.get('mese'))||todayMonth();
  // Opened from the settings list: leaving the wizard returns there.
  const exitTo=searchParams.get('da')==='impostazioni'?'/impostazioni/spese':'/previsioni';
  const editing=Boolean(expense);
  const [step,setStep]=useState(0);
  const [name,setName]=useState(expense?.name??'');
  const [description,setDescription]=useState(expense?.description??'');
  const [category,setCategory]=useState<PlannedExpenseCategory>(expense?.category??'other');
  const [bucketId,setBucketId]=useState(expense?.bucketId??buckets[0]?.id??'');
  const [amount,setAmount]=useState(expense?centsToInput(expense.configuredAmountCents??expense.amountCents):'');
  const [amountMode,setAmountMode]=useState<PlannedExpenseAmountMode>(expense?.amountMode??'fixed');
  const [frequency,setFrequency]=useState<PlannedExpenseFrequency>(expense?.frequency??'monthly');
  const [dueRule,setDueRule]=useState<PlannedExpenseDueRule>(expense?.dueRule??'month');
  const [dueDay,setDueDay]=useState(expense?.dueDay?String(expense.dueDay):'1');
  const [dueDate,setDueDate]=useState(expense?.dueDate??`${selectedMonth}-01`);
  const [startMonth,setStartMonth]=useState(asMonth(expense?.startMonth)||selectedMonth);
  const [unlimited,setUnlimited]=useState(expense?expense.durationMonths===null:true);
  const [durationMonths,setDurationMonths]=useState(expense?.durationMonths?String(expense.durationMonths):'');
  const [sheet,setSheet]=useState<'due'|'month'|null>(null);
  const [error,setError]=useState('');
  const bucket=buckets.find(item=>item.id===bucketId);
  const recurring=frequency!=='once';
  const exactOnce=frequency==='once'&&dueRule==='exact';
  const mutation=useMutation({
    mutationFn:(body:PlannedExpenseInput)=>expense
      ?api<{id:string}>(`/planned-expenses/${expense.id}`,{method:'PATCH',body:JSON.stringify(body)})
      :api<{id:string}>('/planned-expenses',{method:'POST',body:JSON.stringify(body)}),
    onSuccess:()=>{
      void qc.invalidateQueries({queryKey:['dashboard']});
      void qc.invalidateQueries({queryKey:['planned-expenses']});
      navigate(exitTo);
    },
    onError:()=>setError('Impossibile salvare la spesa prevista. Riprova.'),
  });

  function chooseCategory(value:PlannedExpenseCategory){
    setCategory(value);
    const preset=defaultFrequency(value);
    if(preset)setFrequency(preset);
    setError('');
  }
  function validate(target:number){
    if(target>=0){
      if(!name.trim())return 'Inserisci un nome per la spesa.';
      if(!bucketId)return 'Seleziona il bucket da cui verrà addebitata la spesa.';
    }
    if(target>=1){
      let cents:bigint;
      try{cents=BigInt(eurosToCents(amount))}catch{return 'Inserisci un importo valido.'}
      if(cents<=0n)return 'L’importo deve essere maggiore di zero.';
      if(dueRule==='exact'&&recurring){const day=Number(dueDay);if(!Number.isInteger(day)||day<1||day>31)return 'Inserisci un giorno compreso tra 1 e 31.'}
      if(exactOnce&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))return 'Seleziona una data valida.';
      if(!exactOnce&&!startMonth)return 'Seleziona il mese di inizio.';
    }
    if(target>=2&&frequency==='monthly'&&!unlimited){const months=Number(durationMonths);if(!Number.isInteger(months)||months<1)return 'Inserisci una durata di almeno un mese oppure scegli senza scadenza.'}
    return '';
  }
  function next(){
    const problem=validate(step);
    if(problem){setError(problem);return}
    setError('');
    if(step<2){setStep(step+1);return}
    mutation.mutate({
      name:name.trim(),
      description:description.trim()||null,
      category,
      bucketId,
      amountCents:eurosToCents(amount),
      amountMode,
      frequency,
      dueRule,
      dueDay:dueRule==='exact'&&recurring?Number(dueDay):null,
      dueDate:exactOnce?dueDate:null,
      startMonth:exactOnce?dueDate.slice(0,7):startMonth,
      durationMonths:frequency==='monthly'&&!unlimited?Number(durationMonths):null,
    });
  }
  const dueLabel=useMemo(()=>{
    if(dueRule==='exact')return recurring?`Il giorno ${dueDay||'—'}`:new Intl.DateTimeFormat('it-IT',{day:'numeric',month:'long'}).format(new Date(`${dueDate}T12:00:00`));
    return dueRules.find(rule=>rule.value===dueRule)?.label??'Nel mese';
  },[dueDate,dueDay,dueRule,recurring]);
  const finalMonth=frequency==='monthly'&&!unlimited&&Number(durationMonths)>0?formatMonth(shiftMonth(startMonth,Number(durationMonths)-1)):null;

  return <div className="flow wizard">
    <header className="flow-header">
      {step===0?<Link className="ib" to={exitTo} aria-label="Indietro"><ChevronLeft aria-hidden="true"/></Link>:<button type="button" className="ib" onClick={()=>{setStep(step-1);setError('')}} aria-label="Passo precedente"><ChevronLeft aria-hidden="true"/></button>}
      <span className="cap">{editing?'Modifica spesa':'Nuova spesa'} · {step+1} di 3</span>
      <Link className="ib" to={exitTo} aria-label="Annulla"><X aria-hidden="true"/></Link>
    </header>
    <div className="steps" aria-hidden="true">{[0,1,2].map(index=><span key={index} className={index<=step?'on':''}/>)}</div>
    {step>0&&<div className="chip-row summary-chips"><span className="chip static">{name}</span><span className="chip static">{categoryLabels[category]}</span>{bucket&&<span className="chip static"><i className="dot" style={{background:bucket.color}}/>{bucket.name}</span>}</div>}
    <h1 className="wizard-title">{titles[step]}</h1>

    {step===0&&<>
      <label className="field"><span className="cap">Nome</span><span className="input on-surface"><input value={name} onChange={event=>{setName(event.currentTarget.value);setError('')}} placeholder="Es. Bolletta gas" maxLength={80} aria-label="Nome della spesa" autoFocus enterKeyHint="next"/></span></label>
      <div className="field"><span className="cap">Tipo</span><div className="tile-grid two">{categories.map(value=><button type="button" key={value} className={`option-tile${category===value?' on':''}`} aria-pressed={category===value} onClick={()=>chooseCategory(value)}>{categoryLabels[value]}</button>)}</div></div>
      <div className="field"><span className="cap">Addebitata su</span>{buckets.length?<div className="chip-row">{buckets.map(item=><button type="button" key={item.id} className="chip" aria-pressed={bucketId===item.id} onClick={()=>{setBucketId(item.id);setError('')}}><i className="dot" style={{background:item.color}}/>{item.name}</button>)}</div>:<p className="note">Crea prima un bucket per registrare la spesa.</p>}</div>
    </>}

    {step===1&&<>
      <div className="pills" role="group" aria-label="Tipo di importo"><button type="button" aria-pressed={amountMode==='fixed'} onClick={()=>setAmountMode('fixed')}>Importo fisso</button><button type="button" aria-pressed={amountMode==='estimated'} onClick={()=>setAmountMode('estimated')}>Stimato</button></div>
      <label className="tile wizard-amount"><span className="cap">{amountMode==='fixed'?'Importo per occorrenza':'Stima per occorrenza'}</span><span className="wizard-amount-input mono"><span className="mu">€</span><input inputMode="decimal" placeholder="0,00" value={amount} onChange={event=>{setAmount(sanitizeDecimalInput(event.currentTarget.value));setError('')}} aria-label={amountMode==='fixed'?'Importo fisso':'Importo stimato'}/></span></label>
      <div className="field"><span className="cap">Frequenza</span><div className="tile-grid three">{frequencies.map(item=><button type="button" key={item.value} className={`option-tile${frequency===item.value?' on':''}`} aria-pressed={frequency===item.value} onClick={()=>{setFrequency(item.value);setError('')}}>{item.label}<span className="mono mu">{item.hint}</span></button>)}</div></div>
      <div className="tile-grid two">
        <button type="button" className="option-tile left" onClick={()=>setSheet('due')}><span className="cap">Scadenza</span>{dueLabel}</button>
        {!exactOnce&&<button type="button" className="option-tile left" onClick={()=>setSheet('month')}><span className="cap">{recurring?'Dal mese':'Mese previsto'}</span>{formatMonth(startMonth)}</button>}
      </div>
    </>}

    {step===2&&<>
      <label className="field"><span className="cap">Descrizione · facoltativa</span><span className="input on-surface"><textarea value={description} onChange={event=>setDescription(event.currentTarget.value)} placeholder="Es. Accesso mensile alla palestra" maxLength={300} aria-label="Descrizione"/></span></label>
      {frequency==='monthly'&&<div className="field"><span className="cap">Durata</span><div className="pills" role="group" aria-label="Durata"><button type="button" aria-pressed={unlimited} onClick={()=>setUnlimited(true)}>Senza scadenza</button><button type="button" aria-pressed={!unlimited} onClick={()=>setUnlimited(false)}>Numero di mesi</button></div>{!unlimited&&<span className="input on-surface"><input type="number" min="1" step="1" inputMode="numeric" value={durationMonths} onChange={event=>{setDurationMonths(event.currentTarget.value);setError('')}} placeholder="Es. 12" aria-label="Numero di mesi"/></span>}{finalMonth&&<small className="mu">Ultima occorrenza: <strong>{finalMonth}</strong></small>}</div>}
      <section className="tile wizard-review">
        <span className="cap">Riepilogo</span>
        <p><strong>{name}</strong> · {categoryLabels[category]}</p>
        <p className="mono">{amountMode==='fixed'?'Fisso':'Stimato'} €{amount||'0'} · {frequencies.find(item=>item.value===frequency)?.label}</p>
        <p className="mu">{bucket?.name} · {dueLabel}{!exactOnce?` · da ${formatMonth(startMonth).toLowerCase()}`:''}</p>
        {amountMode==='estimated'&&<p className="note">La stima è un riferimento: ogni addebito reale potrà avere un importo diverso.</p>}
      </section>
    </>}

    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="flow-spacer"/>
    <button type="button" className="btn with-arrow" onClick={next} disabled={mutation.isPending||!buckets.length}>{mutation.isPending?'Salvataggio…':step<2?'Continua':editing?'Salva modifiche':'Crea spesa'}<span className="btn-arrow" aria-hidden="true"><ArrowRight/></span></button>

    {sheet==='due'&&<Modal title="Scadenza" onClose={()=>setSheet(null)}><div className="stack">
      <div className="sheet-list">{dueRules.map(rule=><button type="button" key={rule.value} className="sheet-option" aria-pressed={dueRule===rule.value} onClick={()=>setDueRule(rule.value)}><span>{rule.label}<small>{rule.hint}</small></span></button>)}</div>
      {dueRule==='exact'&&recurring&&<label>Giorno del mese<input type="number" min="1" max="31" inputMode="numeric" value={dueDay} onChange={event=>setDueDay(event.currentTarget.value)}/></label>}
      {dueRule==='exact'&&!recurring&&<label>Data prevista<input type="date" value={dueDate} onChange={event=>{const value=event.currentTarget.value;setDueDate(value);if(value)setStartMonth(value.slice(0,7))}}/></label>}
      <button type="button" className="primary" onClick={()=>setSheet(null)}>Fatto</button>
    </div></Modal>}
    {sheet==='month'&&<Modal title={recurring?'Dal mese':'Mese previsto'} onClose={()=>setSheet(null)}><div className="stack">
      <label>{recurring?'Prima occorrenza':'Mese previsto'}<input type="month" value={startMonth} onChange={event=>setStartMonth(event.currentTarget.value)}/></label>
      <button type="button" className="primary" onClick={()=>setSheet(null)} disabled={!startMonth}>Fatto</button>
    </div></Modal>}
  </div>;
}
