import { useRef,useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { Check,ChevronRight,Download,FileText,LockKeyhole,RotateCcw,Trash2,TriangleAlert,Upload,UserRound } from 'lucide-react';
import { Link,useNavigate } from 'react-router-dom';
import { ApiError,api } from '../../lib/api';
import { decryptBackup,encryptBackup,isEncryptedBackup } from '../../lib/backupCrypto';
import { refreshFinancialData } from '../../lib/queryInvalidation';
import { useMobileLayout } from '../../lib/useMobileLayout';
import type { DistributionTemplate } from '../../lib/templates';
import { Modal } from '../../components/Modal';
import { TextInputModal } from '../../components/TextInputModal';
import type { Dashboard,ManagedPlannedExpense } from '../../types';
import { SETTINGS_PATH,SettingsPanel } from './SettingsPanel';

type Summary={buckets:number;archivedBuckets:number;operations:number;templates:number;plannedExpenses:number;plannedExpenseOccurrences:number;plannedExpensePayments:number};
type ImportFile={name:string;size:number;encrypted:boolean};
type BackupExport={id:string;createdAt:string;protected:boolean;sizeBytes:number;bucketCount:number;operationCount:number;plannedExpenseCount:number;templateCount:number};
type ResetMode='partial'|'total';
const RESET_WORD='AZZERA';

/** Counts of what the account holds now, shared by the backup and reset pages. */
function useCurrentCounts(){
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
  const templates=useQuery({queryKey:['templates'],queryFn:({signal})=>api<{templates:DistributionTemplate[]}>('/templates',{signal})});
  const plans=useQuery({queryKey:['planned-expenses','manage'],queryFn:({signal})=>api<{expenses:ManagedPlannedExpense[]}>('/planned-expenses/manage',{signal})});
  return {
    buckets:dashboard.data?.buckets.length,
    templates:templates.data?.templates.length,
    planned:plans.data?.expenses.filter(expense=>!expense.archivedAt).length,
  };
}
const show=(value:number|undefined)=>value===undefined?'…':value.toLocaleString('it-IT');
const fileSize=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${Math.round(bytes/1024)} KB`:`${(bytes/1024/1024).toLocaleString('it-IT',{maximumFractionDigits:1})} MB`;
const today=()=>new Date().toISOString().slice(0,10);
// The server runs one export, import or reset per account at a time.
const BUSY_MESSAGE='È già in corso un’altra operazione sul backup. Riprova tra qualche secondo.';
const busy=(error:unknown)=>error instanceof ApiError&&error.code==='BACKUP_IN_PROGRESS';
const exportDate=new Intl.DateTimeFormat('it-IT',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const exportFileName=(entry:BackupExport)=>`worth-split-${entry.createdAt.slice(0,10)}.wsbackup`;

function refreshAll(qc:ReturnType<typeof useQueryClient>){
  refreshFinancialData(qc);
  void qc.invalidateQueries({queryKey:['templates']});
  void qc.invalidateQueries({queryKey:['planned-expenses']});
}

export function BackupPage(){
  const qc=useQueryClient();
  const navigate=useNavigate();
  const input=useRef<HTMLInputElement>(null);
  const counts=useCurrentCounts();
  const history=useQuery({queryKey:['backup-exports'],queryFn:({signal})=>api<{exports:BackupExport[]}>('/backup/exports',{signal})});
  const lastExport=history.data?.exports[0];
  const [sheet,setSheet]=useState<'export'|'export-password'|'import-password'|'import-confirm'|null>(null);
  const [message,setMessage]=useState<{text:string;error?:boolean}|null>(null);
  const [file,setFile]=useState<ImportFile|null>(null);
  const [pending,setPending]=useState<unknown>();
  const [summary,setSummary]=useState<Summary|null>(null);
  const [importing,setImporting]=useState(false);

  async function exportData(password?:string){
    try{
      const data=await api<unknown>(`/backup/export?protected=${password?'true':'false'}`);
      void qc.invalidateQueries({queryKey:['backup-exports']});
      const output=password?await encryptBackup(data,password):data;
      const url=URL.createObjectURL(new Blob([JSON.stringify(output)],{type:'application/json'}));
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.download=`worth-split-${today()}.wsbackup`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage({text:password?'Backup cifrato esportato. Conserva la password separatamente.':'Backup esportato senza password. Chiunque abbia il file può leggerne i dati.'});
      setSheet(null);
    }catch(error){setMessage({text:busy(error)?BUSY_MESSAGE:(error as Error).message||'Esportazione non riuscita.',error:true});setSheet(null)}
  }
  async function validate(data:unknown){
    const result=await api<{summary:Summary}>('/backup/validate',{method:'POST',body:JSON.stringify(data)});
    setPending(data);
    setSummary(result.summary);
    setSheet(null);
  }
  async function readFile(selected:File){
    setMessage(null);
    try{
      const data:unknown=JSON.parse(await selected.text());
      const encrypted=isEncryptedBackup(data);
      setFile({name:selected.name,size:selected.size,encrypted});
      if(encrypted){setPending(data);setSheet('import-password')}
      else await validate(data);
    }catch{setFile(null);setMessage({text:'Il file non è un backup valido.',error:true})}
  }
  async function unlock(password:string){
    try{await validate(await decryptBackup(pending,password))}
    catch{setFile(null);setPending(undefined);setSheet(null);setMessage({text:'Password o file non validi.',error:true})}
  }
  function cancelImport(){setFile(null);setPending(undefined);setSummary(null);setSheet(null)}
  async function confirmImport(){
    setImporting(true);
    try{
      await api('/backup/import',{method:'POST',body:JSON.stringify(pending)});
      refreshAll(qc);
      navigate(SETTINGS_PATH,{state:{message:'Backup importato correttamente.'}});
    }catch(error){
      setSheet(null);
      setMessage({text:busy(error)?BUSY_MESSAGE:'Importazione non riuscita. I dati attuali non sono stati modificati.',error:true});
    }finally{setImporting(false)}
  }

  const fileInput=<input ref={input} hidden type="file" accept=".wsbackup,.json,application/json" onChange={event=>{const selected=event.target.files?.[0];event.target.value='';if(selected)void readFile(selected)}}/>;
  const status=message&&<p className={message.error?'form-error':'status-message'} role={message.error?'alert':'status'}>{message.text}</p>;

  if(file&&summary)return <SettingsPanel cap="Backup · Importa" title="Importa backup" back="/impostazioni/backup" closeIcon footer={<button type="button" className="btn danger" onClick={()=>setSheet('import-confirm')}><Upload aria-hidden="true"/>Sostituisci i dati</button>}>
    {fileInput}
    <div className="file-card"><span className="file-icon"><FileText aria-hidden="true"/></span><span className="grow"><strong>{file.name}</strong><small className="mono">{fileSize(file.size)}{file.encrypted?' · cifrato':''}</small></span><button type="button" className="chip" onClick={()=>input.current?.click()}>Cambia</button></div>
    <span className="cap sub-section">Verifica del file</span>
    <ul className="check-card">
      <li><span className="rule-dot ok" aria-hidden="true"><Check/></span><span className="grow">Formato Worth Split valido</span></li>
      <li><span className="rule-dot ok" aria-hidden="true"><Check/></span><span className="grow">Bucket{summary.archivedBuckets?' (con archiviati)':''}</span><span className="mono">{summary.buckets}{summary.archivedBuckets?` + ${summary.archivedBuckets}`:''}</span></li>
      <li><span className="rule-dot ok" aria-hidden="true"><Check/></span><span className="grow">Operazioni</span><span className="mono">{summary.operations.toLocaleString('it-IT')}</span></li>
      <li><span className="rule-dot ok" aria-hidden="true"><Check/></span><span className="grow">Spese previste · pagamenti</span><span className="mono">{summary.plannedExpenses} · {summary.plannedExpensePayments}</span></li>
      <li><span className="rule-dot ok" aria-hidden="true"><Check/></span><span className="grow">Template</span><span className="mono">{summary.templates}</span></li>
    </ul>
    <div className="compare">
      <div><span className="cap">Dati attuali</span><b className="mono">{show(counts.buckets)} bucket</b><small>{show(counts.planned)} spese · {show(counts.templates)} template</small></div>
      <ChevronRight aria-hidden="true"/>
      <div className="next"><span className="cap">Dal backup</span><b className="mono">{summary.buckets} bucket</b><small>{summary.plannedExpenses} spese · {summary.templates} template</small></div>
    </div>
    <p className="notice neg"><TriangleAlert aria-hidden="true"/>L’import sostituisce tutti i dati attuali, comprese le preferenze. Se vuoi conservarli, esporta prima un backup.</p>
    {status}
    {sheet==='import-confirm'&&<Modal title="Importare il backup?" onClose={()=>!importing&&setSheet(null)}><div className="confirm-sheet">
      <span className="confirm-icon danger"><Upload aria-hidden="true"/></span>
      <p>I dati attuali saranno sostituiti completamente.</p>
      <small>Il backup contiene {summary.buckets} bucket, {summary.templates} template, {summary.plannedExpenses} spese previste e {summary.operations} operazioni.</small>
      <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setSheet(null)} disabled={importing}>Annulla</button><button type="button" className="btn danger" onClick={()=>void confirmImport()} disabled={importing}>{importing?'Importazione…':'Importa'}</button></div>
    </div></Modal>}
    <button type="button" className="text-btn center" onClick={cancelImport}>Annulla importazione</button>
  </SettingsPanel>;

  return <SettingsPanel cap="Backup" title="Backup e dati">
    {fileInput}
    <section className="hero-tile stat-hero four">
      <div className="wide row-between"><span className="cap">Ultimo backup</span><span className="mono hero-meta">{history.isLoading?'…':lastExport?exportDate.format(new Date(lastExport.createdAt)):'Mai'}</span></div>
      <div><b className="mono">{show(counts.buckets)}</b><small>bucket</small></div>
      <div><b className="mono">{show(counts.planned)}</b><small>spese</small></div>
      <div><b className="mono">{show(counts.templates)}</b><small>template</small></div>
    </section>
    {status}
    <div className="action-grid">
      <button type="button" className="big-action" onClick={()=>setSheet('export')}><span className="big-action-icon lime"><Download aria-hidden="true"/></span><span className="grow"><strong>Esporta backup</strong><small>Scarica un file con tutti i tuoi dati</small></span><ChevronRight aria-hidden="true"/></button>
      <button type="button" className="big-action" onClick={()=>input.current?.click()}><span className="big-action-icon"><Upload aria-hidden="true"/></span><span className="grow"><strong>Importa backup</strong><small>Ripristina da un file esportato in precedenza</small></span><ChevronRight aria-hidden="true"/></button>
    </div>
    <span className="cap sub-section">Esportazioni recenti</span>
    {history.isError?<p className="sub-note">Impossibile caricare lo storico delle esportazioni.</p>:history.data&&history.data.exports.length===0?<p className="sub-note">Non hai ancora esportato un backup.</p>:<ul className="export-list">{(history.data?.exports??[]).slice(0,5).map(entry=><li key={entry.id}>
      {entry.protected?<LockKeyhole aria-label="Protetto da password"/>:<FileText aria-hidden="true"/>}
      <span className="grow"><strong>{exportFileName(entry)}</strong><small>{exportDate.format(new Date(entry.createdAt))} · {entry.bucketCount} bucket · {entry.operationCount.toLocaleString('it-IT')} operazioni</small></span>
      <span className="mono mu">{fileSize(entry.sizeBytes)}</span>
    </li>)}</ul>}
    <div className="flow-spacer"/>
    <span className="cap danger-cap">Zona pericolosa</span>
    <Link className="danger-zone" to="/impostazioni/azzera"><span className="danger-zone-icon"><RotateCcw aria-hidden="true"/></span><span className="grow"><strong>Azzera dati</strong><small>Movimenti, saldi e, se vuoi, anche bucket e template</small></span><ChevronRight aria-hidden="true"/></Link>
    {sheet==='export'&&<Modal title="Esporta backup" onClose={()=>setSheet(null)}><div className="sheet-list">
      <div className="file-card flat"><span className="file-icon"><FileText aria-hidden="true"/></span><span className="grow"><strong>worth-split-{today()}.wsbackup</strong><small className="mono">Bucket, operazioni, spese previste, pagamenti, template e preferenze</small></span></div>
      <p className="note">Il file non contiene la tua password. Scegli come salvarlo.</p>
      <button type="button" className="sheet-option" onClick={()=>setSheet('export-password')}><LockKeyhole aria-hidden="true"/><span>Proteggi con password<small>Il file sarà cifrato: servirà la password per aprirlo</small></span></button>
      <button type="button" className="sheet-option" onClick={()=>void exportData()}><Download aria-hidden="true"/><span>Esporta senza password<small>Pronto da importare, ma leggibile da chiunque abbia il file</small></span></button>
    </div></Modal>}
    {sheet==='export-password'&&<TextInputModal title="Proteggi backup" label="Password di cifratura" type="password" minLength={12} submitLabel="Esporta backup protetto" onSubmit={exportData} onClose={()=>setSheet(null)}/>}
    {sheet==='import-password'&&<TextInputModal title="Apri backup" label="Password del backup" type="password" submitLabel="Continua" onSubmit={unlock} onClose={cancelImport}/>}
  </SettingsPanel>;
}

export function ResetPage(){
  const qc=useQueryClient();
  const navigate=useNavigate();
  const mobile=useMobileLayout();
  const counts=useCurrentCounts();
  const [mode,setMode]=useState<ResetMode>('partial');
  const [word,setWord]=useState('');
  const [confirming,setConfirming]=useState(false);
  const reset=useMutation({
    mutationFn:()=>api('/backup/reset',{method:'POST',body:JSON.stringify({mode,confirmation:mode==='partial'?'RESET_PARTIAL':'RESET_TOTAL'})}),
    onSuccess:()=>{
      refreshAll(qc);
      navigate(SETTINGS_PATH,{state:{message:mode==='partial'
        ?'Reset parziale completato: movimenti e pagamenti pianificati eliminati, bucket azzerati.'
        :'Reset totale completato: bucket, template, spese previste e movimenti eliminati.'}});
    },
  });
  const ready=word.trim().toUpperCase()===RESET_WORD;
  const removed=mode==='partial'
    ?[{label:'Tutti i movimenti',value:'storico completo'},{label:'Pagamenti delle spese previste',value:'tutti'},{label:'Saldi dei bucket',value:'portati a €0,00'}]
    :[{label:'Bucket e saldi',value:show(counts.buckets)},{label:'Movimenti',value:'storico completo'},{label:'Spese previste',value:show(counts.planned)},{label:'Template',value:show(counts.templates)}];
  const kept=mode==='partial'?'Restano bucket, template, spese previste, il tuo account e le preferenze.':'Restano il tuo account, la password e le preferenze.';

  return <SettingsPanel cap="Azzera" title="Azzera dati" back="/impostazioni/backup" lead="Scegli cosa eliminare. L’operazione non si può annullare." footer={<button type="button" className="btn danger" disabled={!ready} onClick={()=>{reset.reset();setConfirming(true)}}>{mode==='partial'?'Azzera dati':'Elimina tutto'}</button>}>
    <div className="reset-modes" role="radiogroup" aria-label="Tipo di reset">
      <button type="button" role="radio" aria-checked={mode==='partial'} className="reset-mode" onClick={()=>setMode('partial')}><RotateCcw aria-hidden="true"/><strong>Reset parziale</strong><small>Elimina i movimenti e azzera i saldi</small></button>
      <button type="button" role="radio" aria-checked={mode==='total'} className="reset-mode" onClick={()=>setMode('total')}><Trash2 aria-hidden="true"/><strong>Reset totale</strong><small>Elimina bucket, template e tutto lo storico</small></button>
    </div>
    <span className="cap sub-section">Verranno eliminati</span>
    <ul className="check-card">{removed.map(item=><li key={item.label}><span className="rule-dot bad" aria-hidden="true"><Trash2/></span><span className="grow">{item.label}</span><span className="mono">{item.value}</span></li>)}</ul>
    <p className="sub-note with-icon"><UserRound aria-hidden="true"/>{kept}</p>
    <Link className="export-first" to="/impostazioni/backup"><Download aria-hidden="true"/><span className="grow">Esporta prima un backup</span><ChevronRight aria-hidden="true"/></Link>
    <label className="field"><span className="cap">Scrivi <b>{RESET_WORD}</b> per confermare</span><span className="input on-surface"><input value={word} onChange={event=>setWord(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder={RESET_WORD}/></span></label>
    {!mobile&&<p className="sub-note">Il pulsante si attiva quando la parola di conferma è corretta.</p>}
    {confirming&&<Modal title={mode==='partial'?'Confermare il reset parziale?':'Confermare il reset totale?'} onClose={()=>!reset.isPending&&setConfirming(false)}><div className="confirm-sheet">
      <span className="confirm-icon danger"><TriangleAlert aria-hidden="true"/></span>
      <p>{mode==='partial'?'Stai per eliminare l’intero storico dei movimenti e portare a zero il saldo di ogni bucket.':'Stai per eliminare tutti i bucket, i template, le spese previste e l’intero storico dei movimenti.'}</p>
      <small>L’operazione è irreversibile.</small>
      {reset.isError&&<p className="form-error" role="alert">Reset non riuscito. Ricarica la pagina prima di riprovare.</p>}
      <div className="confirm-actions"><button type="button" className="btn outline" onClick={()=>setConfirming(false)} disabled={reset.isPending}>Annulla</button><button type="button" className="btn danger" onClick={()=>reset.mutate()} disabled={reset.isPending}>{reset.isPending?'Reset in corso…':'Azzera definitivamente'}</button></div>
    </div></Modal>}
  </SettingsPanel>;
}
