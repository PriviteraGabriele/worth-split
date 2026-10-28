import { centsToInput } from './money';
import type { Bucket } from '../types';

export type TemplateMode='fixed'|'percentage';
export type DistributionTemplate={id:string;name:string;mode:TemplateMode;items:{bucketId:string;bucketName?:string;amountCents:string|null;percentageBasisPoints:number|null;sortOrder?:number}[]};

export const percentageToBasisPoints=(value:string)=>{const match=value.trim().replace('.',',').match(/^(\d+)(?:,(\d{1,2}))?$/);return match?Number(match[1])*100+Number((match[2]??'').padEnd(2,'0')):0};
export const basisPointsToInput=(value:number)=>value%100===0?`${value/100}`:`${Math.floor(value/100)},${String(value%100).padStart(2,'0')}`;
export const formatPercentage=(value:number)=>`${(value/100).toLocaleString('it-IT',{maximumFractionDigits:2})}%`;

/** Coloured weights of a template, in item order, for its share bar. */
export function templateShares(template:DistributionTemplate,buckets:Bucket[]){
  const byId=new Map(buckets.map(bucket=>[bucket.id,bucket]));
  return template.items.map(item=>{
    const bucket=byId.get(item.bucketId);
    return {bucketId:item.bucketId,name:bucket?.name??item.bucketName??'Bucket',color:bucket?.color??'var(--mu)',weight:template.mode==='percentage'?item.percentageBasisPoints??0:Number(BigInt(item.amountCents??'0')),amountCents:item.amountCents,basisPoints:item.percentageBasisPoints};
  }).filter(share=>share.weight>0);
}

export function templateTotalCents(template:DistributionTemplate){
  return template.items.reduce((sum,item)=>sum+BigInt(item.amountCents??'0'),0n);
}

/** Input values (per bucket) that reproduce a saved template in an editor. */
export function templateInputs(template:DistributionTemplate){
  return Object.fromEntries(template.items.map(item=>[item.bucketId,template.mode==='fixed'?centsToInput(item.amountCents??'0'):basisPointsToInput(item.percentageBasisPoints??0)]));
}
