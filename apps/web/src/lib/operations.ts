import type { Operation } from '../types';
import { formatEuro } from './money';

export type OperationSummary={
  title:string;
  subtitle:string;
  /** Signed net amount; transfers are neutral and carry the moved amount. */
  amountCents:bigint;
  tone:'positive'|'negative'|'neutral';
  icon:Operation['kind'];
};

const shortDate=new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'short'});
const time=new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit'});

export function operationDay(occurredAt:string){
  const parts=shortDate.formatToParts(new Date(occurredAt));
  return {day:parts.find(part=>part.type==='day')?.value??'',month:(parts.find(part=>part.type==='month')?.value??'').replace('.','')};
}
export function operationTime(occurredAt:string){return time.format(new Date(occurredAt))}

export function summarizeOperation(operation:Operation,hidden:boolean):OperationSummary{
  const note=operation.note?.trim();
  const net=operation.entries.reduce((sum,entry)=>sum+BigInt(entry.amountCents),0n);
  const tone=(value:bigint)=>value>0n?'positive':value<0n?'negative':'neutral' as const;
  if(operation.kind==='transfer'){
    const from=operation.entries.find(entry=>BigInt(entry.amountCents)<0n);
    const to=operation.entries.find(entry=>BigInt(entry.amountCents)>0n);
    const moved=to?BigInt(to.amountCents):0n;
    return {title:'Trasferimento',subtitle:`${from?.bucketName??'—'} → ${to?.bucketName??'—'}${note?` · ${note}`:''}`,amountCents:moved,tone:'neutral',icon:'transfer'};
  }
  if(operation.kind==='distribution'){
    const count=operation.entries.length;
    return {title:'Distribuzione',subtitle:`${note?.replace(/^Template:\s*/,'')||'Entrata'} · ${count} bucket`,amountCents:net,tone:tone(net),icon:'distribution'};
  }
  if(operation.kind==='rebalance'){
    const changed=operation.entries.filter(entry=>BigInt(entry.amountCents)!==0n);
    const subtitle=changed.map(entry=>{
      const before=BigInt(entry.balanceAfterCents)-BigInt(entry.amountCents);
      return `${entry.bucketName} ${formatEuro(before,hidden)} → ${formatEuro(entry.balanceAfterCents,hidden)}`;
    }).join(' · ')||'Nessuna variazione';
    return {title:'Ribilanciamento',subtitle,amountCents:net,tone:tone(net),icon:'rebalance'};
  }
  const entry=operation.entries[0];
  return {title:entry?.bucketName??'Rettifica',subtitle:note||(net>=0n?'Aggiunta manuale':'Sottrazione manuale'),amountCents:net,tone:tone(net),icon:'adjustment'};
}

export function formatOperationAmount(summary:OperationSummary,hidden:boolean){
  return formatEuro(summary.amountCents,hidden,{sign:summary.tone!=='neutral'});
}
