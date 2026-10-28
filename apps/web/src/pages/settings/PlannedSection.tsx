import { useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Archive,CalendarClock,ChevronDown,CircleEllipsis,HandCoins,Pencil,Plus,Repeat2,Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatEuro } from '../../lib/money';
import { useAmountPrivacy } from '../../lib/amountPrivacyContext';
import { useMobileLayout } from '../../lib/useMobileLayout';
import { Modal } from '../../components/Modal';
import type { ManagedPlannedExpense,PlannedExpenseCategory } from '../../types';
import { SettingsPanel } from './SettingsPanel';

const NEW_PATH='/previsioni/nuova?da=impostazioni';
const editPath=(expense:ManagedPlannedExpense)=>`/previsioni/${expense.id}/modifica?da=impostazioni`;
const filters:{value:PlannedExpenseCategory|'all';label:string}[]=[{value:'all',label:'Tutte'},{value:'subscription',label:'Abbonamenti'},{value:'installment',label:'A rate'},{value:'one_time',label:'Una tantum'},{value:'other',label:'Altro'}];
const categoryLabels={subscription:'Abbonamento',installment:'A rate',one_time:'Una tantum',other:'Altro'} as const;
const frequencyLabels={monthly:'Mensile',bimonthly:'Bimestrale',quarterly:'Trimestrale',semiannual:'Semestrale',annual:'Annuale',once:'Una tantum'} as const;
const categoryIcons={subscription:Repeat2,installment:HandCoins,other:CircleEllipsis} as const;
type Pending={kind:'archive'|'delete';expense:ManagedPlannedExpense};

export function PlannedPage(){
  const {hidden}=useAmountPrivacy();
  const mobile=useMobileLayout();
  const [filter,setFilter]=useState<PlannedExpenseCategory|'all'>('all');
  const [showArchived,setShowArchived]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);
  const plans=useQuery({queryKey:['planned-expenses','manage'],queryFn:({signal})=>api<{expenses:ManagedPlannedExpense[]}>('/planned-expenses/manage',{signal})});
  const expenses=plans.data?.expenses??[];
  const active=expenses.filter(expense=>!expense.archivedAt).sort(byAmountDescending);
  const archived=expenses.filter(expense=>Boolean(expense.archivedAt)).sort(byAmountDescending);
  const visible=filter==='all'?active:active.filter(expense=>expense.category===filter);
  const newLink=<Link className={mobile?'ib lime':'btn sm'} to={NEW_PATH} aria-label={mobile?'Nuova spesa prevista':undefined}><Plus aria-hidden="true"/>{!mobile&&'Nuova spesa'}</Link>;

  return <SettingsPanel cap="Spese previste" title="Spese previste" action={mobile?newLink:undefined} footer={mobile?undefined:<><span className="foot-note mono">{active.length} {active.length===1?'attiva':'attive'} · {archived.length} {archived.length===1?'archiviata':'archiviate'}</span>{newLink}</>}>
    {mobile&&expenses.length>0&&<span className="cap sub-count">{active.length} {active.length===1?'attiva':'attive'}</span>}
    {plans.isLoading?<div className="skeleton card"/>:plans.isError?<p className="form-error">Impossibile caricare le spese previste.</p>:expenses.length===0?<div className="empty"><span className="empty-icon"><CalendarClock/></span><h3>Nessuna spesa prevista</h3><p>Crea abbonamenti, rate o stime mensili da tenere sotto controllo.</p><Link className="btn sm" to={NEW_PATH}>Crea spesa</Link></div>:<>
      <div className="chip-row" role="group" aria-label="Filtra per categoria">{filters.map(item=><button key={item.value} type="button" className="chip" aria-pressed={filter===item.value} onClick={()=>setFilter(item.value)}>{item.label}</button>)}</div>
      <div className="manage-list">
        {visible.length===0&&<p className="sub-note">Nessuna spesa attiva in questa categoria.</p>}
        {visible.map(expense=><article className="manage-row" key={expense.id}>
          <CategorySquare expense={expense}/>
          <span className="grow"><strong className="manage-name">{expense.name}</strong><small>{categoryLabels[expense.category]} · {frequencyLabels[expense.frequency]} · {expense.bucketName}</small></span>
          <span className="manage-amount"><span className="mono">{formatEuro(expense.amountCents,hidden)}</span><span className={`tag${expense.amountMode==='estimated'?' est':''}`}>{expense.amountMode==='estimated'?'Stimata':'Fissa'}</span></span>
          <Link className="act-btn" to={editPath(expense)} aria-label={`Modifica ${expense.name}`} title="Modifica"><Pencil aria-hidden="true"/></Link>
          <button type="button" className="act-btn neg" onClick={()=>setPending({kind:'archive',expense})} aria-label={`Archivia ${expense.name}`} title="Archivia"><Archive aria-hidden="true"/></button>
        </article>)}
      </div>
      {archived.length>0&&<section className="archive-group">
        <button type="button" className="archive-toggle" onClick={()=>setShowArchived(value=>!value)} aria-expanded={showArchived}><span><Archive aria-hidden="true"/>Archiviate · {archived.length}</span><ChevronDown aria-hidden="true"/></button>
        {showArchived&&<div className="manage-list">{archived.map(expense=><article className="manage-row muted" key={expense.id}>
          <CategorySquare expense={expense}/>
          <span className="grow"><strong className="manage-name">{expense.name}</strong><small>{categoryLabels[expense.category]} · {frequencyLabels[expense.frequency]} · {expense.bucketName}</small></span>
          <button type="button" className="act-btn neg" onClick={()=>setPending({kind:'delete',expense})} aria-label={`Elimina definitivamente ${expense.name}`} title="Elimina definitivamente"><Trash2 aria-hidden="true"/></button>
        </article>)}</div>}
      </section>}
    </>}
    {pending&&<PlannedConfirmSheet pending={pending} onClose={()=>setPending(null)}/>}
  </SettingsPanel>;
}

function CategorySquare({expense}:{expense:ManagedPlannedExpense}){
  const Icon=expense.category==='one_time'?undefined:categoryIcons[expense.category];
  return <span className="category-square" style={{background:expense.bucketColor??'var(--mu)'}} role="img" aria-label={categoryLabels[expense.category]}>{Icon?<Icon aria-hidden="true"/>:<b aria-hidden="true">1</b>}</span>;
}

function PlannedConfirmSheet({pending,onClose}:{pending:Pending;onClose:()=>void}){
  const qc=useQueryClient();
  const {kind,expense}=pending;
  const mutation=useMutation({
    mutationFn:()=>api(kind==='archive'?`/planned-expenses/${expense.id}`:`/planned-expenses/${expense.id}/permanent`,{method:'DELETE'}),
    onSuccess:()=>{void qc.invalidateQueries({queryKey:['dashboard']});void qc.invalidateQueries({queryKey:['planned-expenses']});onClose()},
  });
  const archive=kind==='archive';
  return <Modal title={archive?'Archiviare spesa prevista?':'Eliminare definitivamente?'} onClose={onClose}><div className="confirm-sheet">
    <span className="confirm-icon danger">{archive?<Archive aria-hidden="true"/>:<Trash2 aria-hidden="true"/>}</span>
    <p>{archive?'Vuoi archiviare':'Eliminare definitivamente'} <strong>{expense.name}</strong>?</p>
    <small>{archive?'Non sarà più proposta nei mesi successivi. Gli addebiti già registrati resteranno nello storico.':'La spesa archiviata e le sue occorrenze verranno rimosse. I movimenti reali resteranno nello storico e i saldi non cambieranno.'}</small>
    {mutation.isError&&<p className="form-error" role="alert">{archive?'Impossibile archiviare la spesa. Riprova.':'Impossibile eliminare la spesa. Riprova.'}</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={onClose} disabled={mutation.isPending}>Annulla</button><button type="button" className="btn danger" onClick={()=>mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending?(archive?'Archiviazione…':'Eliminazione…'):(archive?'Archivia':'Elimina definitivamente')}</button></div>
  </div></Modal>;
}

function byAmountDescending(left:ManagedPlannedExpense,right:ManagedPlannedExpense){
  const difference=BigInt(right.amountCents)-BigInt(left.amountCents);
  return difference>0n?1:difference<0n?-1:0;
}
