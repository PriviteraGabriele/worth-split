import { useState,type FormEvent } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate,Pencil,Plus,Split,Trash2 } from 'lucide-react';
import { Link,Navigate,useNavigate,useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatEuro,normalizePercentageInput,safeCents,sanitizeDecimalInput } from '../../lib/money';
import { useAmountPrivacy } from '../../lib/amountPrivacyContext';
import { useMobileLayout } from '../../lib/useMobileLayout';
import { formatPercentage,percentageToBasisPoints,templateInputs,templateShares,templateTotalCents,type DistributionTemplate,type TemplateMode } from '../../lib/templates';
import { Modal } from '../../components/Modal';
import type { Bucket,Dashboard } from '../../types';
import { SettingsPanel } from './SettingsPanel';

const LIST_PATH='/impostazioni/template';
type TemplateItemInput={bucketId:string;amountCents?:string;percentageBasisPoints?:number};

function useTemplates(){
  return useQuery({queryKey:['templates'],queryFn:({signal})=>api<{templates:DistributionTemplate[]}>('/templates',{signal})});
}
function useDashboard(){
  return useQuery({queryKey:['dashboard'],queryFn:({signal})=>api<Dashboard>('/dashboard',{signal})});
}

export function TemplatesPage(){
  const {hidden}=useAmountPrivacy();
  const mobile=useMobileLayout();
  const templates=useTemplates();
  const dashboard=useDashboard();
  const [deleting,setDeleting]=useState<DistributionTemplate|null>(null);
  const buckets=dashboard.data?.buckets??[];
  const list=templates.data?.templates??[];
  const newLink=<Link className={mobile?'ib lime':'btn sm'} to={`${LIST_PATH}/nuovo`} aria-label={mobile?'Nuovo template':undefined}><Plus aria-hidden="true"/>{!mobile&&'Nuovo template'}</Link>;

  return <SettingsPanel cap="Template" title="Template" lead="Ripartizioni salvate da applicare in un tocco quando distribuisci un’entrata." action={mobile?newLink:undefined} footer={mobile?undefined:<><span className="foot-note">I template non modificano le distribuzioni già registrate.</span>{newLink}</>}>
    {templates.isLoading?<div className="skeleton card"/>:templates.isError?<p className="form-error">Impossibile caricare i template.</p>:list.length===0?<div className="empty"><span className="empty-icon"><LayoutTemplate/></span><h3>Nessun template</h3><p>Salva una ripartizione ricorrente per riutilizzarla velocemente.</p><Link className="btn sm" to={`${LIST_PATH}/nuovo`}>Crea template</Link></div>
      :<div className="template-list">{list.map(template=>{
        const shares=templateShares(template,buckets);
        const percentage=template.mode==='percentage';
        const summary=percentage?`${formatPercentage(template.items.reduce((sum,item)=>sum+(item.percentageBasisPoints??0),0))} del totale`:formatEuro(templateTotalCents(template),hidden);
        return <article className="tile template-tile" key={template.id}>
          <div className="template-head"><span className="template-kind" aria-label={percentage?'Percentuali':'Importi fissi'}>{percentage?'%':'€'}</span><span className="grow"><strong>{template.name}</strong><small className="mono">{template.items.length} bucket · {summary}</small></span></div>
          {shares.length>0&&<span className="share-bar" aria-hidden="true">{shares.map(share=><i key={share.bucketId} style={{flex:share.weight,background:share.color}}/>)}</span>}
          <ul className="legend">{shares.map(share=><li key={share.bucketId}><i style={{background:share.color}} aria-hidden="true"/>{share.name} <b className="mono">{percentage?formatPercentage(share.basisPoints??0):formatEuro(share.amountCents??'0',hidden)}</b></li>)}</ul>
          <div className="template-actions">
            <Link className="btn ink sm grow" to={`/sposta/distribuisci?template=${template.id}`}><Split aria-hidden="true"/>Usa per distribuire</Link>
            <Link className="act-btn" to={`${LIST_PATH}/${template.id}`} aria-label={`Modifica ${template.name}`} title="Modifica"><Pencil aria-hidden="true"/></Link>
            <button type="button" className="act-btn neg" onClick={()=>setDeleting(template)} aria-label={`Elimina ${template.name}`} title="Elimina"><Trash2 aria-hidden="true"/></button>
          </div>
        </article>;
      })}</div>}
    {deleting&&<DeleteTemplateSheet template={deleting} onClose={()=>setDeleting(null)}/>}
  </SettingsPanel>;
}

function DeleteTemplateSheet({template,onClose}:{template:DistributionTemplate;onClose:()=>void}){
  const qc=useQueryClient();
  const remove=useMutation({
    mutationFn:()=>api(`/templates/${template.id}`,{method:'DELETE'}),
    onSuccess:()=>{
      qc.setQueryData<{templates:DistributionTemplate[]}>(['templates'],current=>current&&{templates:current.templates.filter(item=>item.id!==template.id)});
      void qc.invalidateQueries({queryKey:['templates']});
      onClose();
    },
  });
  return <Modal title="Eliminare template?" onClose={onClose}><div className="confirm-sheet">
    <span className="confirm-icon danger"><Trash2 aria-hidden="true"/></span>
    <p>Vuoi eliminare <strong>{template.name}</strong>?</p>
    <small>Questa azione non modifica le distribuzioni già registrate.</small>
    {remove.isError&&<p className="form-error" role="alert">Impossibile eliminare il template.</p>}
    <div className="confirm-actions"><button type="button" className="btn outline" onClick={onClose} disabled={remove.isPending}>Annulla</button><button type="button" className="btn danger" onClick={()=>remove.mutate()} disabled={remove.isPending}>{remove.isPending?'Eliminazione…':'Elimina'}</button></div>
  </div></Modal>;
}

export function TemplateEditorPage(){
  const {id}=useParams();
  const templates=useTemplates();
  const dashboard=useDashboard();
  const title=id?'Modifica template':'Nuovo template';
  if(dashboard.isLoading||(id&&templates.isLoading))return <SettingsPanel cap={id?'Template · Modifica':'Template · Nuovo'} title={title} back={LIST_PATH} closeIcon><div className="skeleton card"/></SettingsPanel>;
  const template=id?templates.data?.templates.find(item=>item.id===id):undefined;
  if(id&&!template)return <Navigate to={LIST_PATH} replace/>;
  return <TemplateEditor key={id??'new'} template={template} buckets={dashboard.data?.buckets??[]}/>;
}

function TemplateEditor({template,buckets}:{template?:DistributionTemplate;buckets:Bucket[]}){
  const {hidden}=useAmountPrivacy();
  const qc=useQueryClient();
  const navigate=useNavigate();
  const [name,setName]=useState(template?.name??'');
  const [mode,setMode]=useState<TemplateMode>(template?.mode??'percentage');
  const [values,setValues]=useState<Record<string,string>>(()=>template?templateInputs(template):{});
  const [error,setError]=useState('');
  const items=buckets.flatMap<TemplateItemInput>(bucket=>{
    const value=values[bucket.id]??'';
    if(mode==='fixed'){const amount=safeCents(value);return amount>0n?[{bucketId:bucket.id,amountCents:amount.toString()}]:[]}
    const percentageBasisPoints=percentageToBasisPoints(value);
    return percentageBasisPoints>0?[{bucketId:bucket.id,percentageBasisPoints}]:[];
  });
  const percentageTotal=items.reduce((sum,item)=>sum+(item.percentageBasisPoints??0),0);
  const fixedTotal=items.reduce((sum,item)=>sum+BigInt(item.amountCents??'0'),0n);
  const weightOf=(item:TemplateItemInput)=>mode==='percentage'?item.percentageBasisPoints??0:Number(BigInt(item.amountCents??'0'));
  const colors=new Map(buckets.map(bucket=>[bucket.id,bucket.color]));
  const filled=new Set(items.map(item=>item.bucketId));
  const save=useMutation({
    mutationFn:()=>{
      const body=JSON.stringify({name:name.trim(),mode,items});
      return template?api(`/templates/${template.id}`,{method:'PUT',body}):api('/templates',{method:'POST',body});
    },
    onSuccess:()=>{void qc.invalidateQueries({queryKey:['templates']});navigate(LIST_PATH)},
  });

  function change(bucketId:string,value:string){setValues(current=>({...current,[bucketId]:sanitizeDecimalInput(value)}));setError('')}
  function changeMode(next:TemplateMode){if(next===mode)return;setMode(next);setValues({});setError('')}
  function submit(event:FormEvent){
    event.preventDefault();
    if(!name.trim()){setError('Inserisci un nome per il template.');return}
    if(!items.length){setError('Inserisci almeno un valore.');return}
    if(mode==='percentage'&&percentageTotal!==10000){setError('Le percentuali devono totalizzare 100%.');return}
    save.mutate();
  }

  const complete=mode==='percentage'?percentageTotal===10000:fixedTotal>0n;
  return <SettingsPanel cap={template?'Template · Modifica':'Template · Nuovo'} title={template?'Modifica template':'Nuovo template'} back={LIST_PATH} closeIcon footer={<button type="submit" form="template-form" className="btn" disabled={save.isPending}>{save.isPending?'Salvataggio…':'Salva template'}</button>}>
    <form id="template-form" className="sub-form" onSubmit={submit}>
      <label className="field"><span className="cap">Nome template</span><span className="input on-surface"><input value={name} onChange={event=>{setName(event.target.value);setError('')}} placeholder="Es. Stipendio" maxLength={60} required enterKeyHint="next"/></span></label>
      <div className="field"><span className="cap" id="template-mode">Tipo di ripartizione</span><div className="pills" role="radiogroup" aria-labelledby="template-mode"><button type="button" role="radio" aria-checked={mode==='fixed'} onClick={()=>changeMode('fixed')}>Importi fissi</button><button type="button" role="radio" aria-checked={mode==='percentage'} onClick={()=>changeMode('percentage')}>Percentuali</button></div></div>
      <span className="share-bar tall" aria-hidden="true">{items.map(item=><i key={item.bucketId} style={{flex:weightOf(item),background:colors.get(item.bucketId)}}/>)}</span>
      {buckets.length===0?<p className="sub-note">Crea prima almeno un bucket.</p>:<div className="template-rows">{buckets.map((bucket,index)=>{
        const value=values[bucket.id]??'';
        return <label key={bucket.id} className={`template-row${filled.has(bucket.id)?'':' zero'}`}>
          <i className="dot" style={{background:bucket.color}} aria-hidden="true"/>
          <span className="grow">{bucket.name}</span>
          <span className="template-input mono">{mode==='fixed'&&<span aria-hidden="true">€</span>}<input inputMode="decimal" aria-label={`${bucket.name}, ${mode==='fixed'?'importo in euro':'percentuale'}`} enterKeyHint={index===buckets.length-1?'done':'next'} placeholder={mode==='fixed'?'0,00':'0'} value={value} onChange={event=>change(bucket.id,event.target.value)} onBlur={event=>{if(mode==='percentage')setValues(current=>({...current,[bucket.id]:normalizePercentageInput(event.target.value)}))}}/>{mode==='percentage'&&<span aria-hidden="true">%</span>}</span>
        </label>;
      })}</div>}
      <div className="template-total mono"><span>{mode==='percentage'?'Si applica al totale distribuito':'Totale della distribuzione'}</span><b className={complete?'ok':'pending'}>Totale {mode==='percentage'?formatPercentage(percentageTotal):formatEuro(fixedTotal,hidden)}</b></div>
      {(error||save.isError)&&<p className="form-error" role="alert">{error||'Impossibile salvare il template.'}</p>}
    </form>
  </SettingsPanel>;
}
