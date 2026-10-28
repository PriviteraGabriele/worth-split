import { useMemo,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChartNoAxesCombined } from 'lucide-react';
import { api } from '../lib/api';
import { formatEuro } from '../lib/money';
import { useAmountPrivacy } from '../lib/amountPrivacyContext';
import { useMobileLayout } from '../lib/useMobileLayout';
import { formatMonth,shortMonth } from '../lib/planned';
import type { TrendMonth } from '../types';
import { Money } from '../components/Money';

type Range='6'|'12'|'all';
const ranges:{value:Range;label:string}[]=[{value:'6',label:'6M'},{value:'12',label:'1A'},{value:'all',label:'MAX'}];
const emptyMonths:TrendMonth[]=[];

function percentChange(from:bigint,to:bigint){
  if(from<=0n)return null;
  return Number((to-from)*1000n/from)/10;
}
function formatPercent(value:number){return `${value>=0?'+':'−'}${Math.abs(value).toLocaleString('it-IT',{maximumFractionDigits:1})}%`}
function compactThousands(cents:bigint){return `${(Number(cents/100n)/1000).toLocaleString('it-IT',{maximumFractionDigits:1})}k`}

export function Trends(){
  const {hidden}=useAmountPrivacy();
  const mobile=useMobileLayout();
  const {data,isLoading}=useQuery({queryKey:['trends'],queryFn:({signal})=>api<{months:TrendMonth[]}>('/trends',{signal})});
  const months=data?.months??emptyMonths;
  const [range,setRange]=useState<Range>('12');
  const [selected,setSelected]=useState('');
  const activeIndex=Math.max(0,selected?months.findIndex(month=>month.month===selected):months.length-1);
  const active=months[activeIndex];
  const view=useMemo(()=>{
    if(!active)return null;
    const length=range==='all'?activeIndex+1:Number(range);
    const start=Math.max(0,activeIndex-length+1);
    const visibleMonths=months.slice(start,activeIndex+1);
    const previous=activeIndex>0?months[activeIndex-1]:undefined;
    const first=visibleMonths[0]!;
    const activeTotal=BigInt(active.totalCents);
    const monthChange=previous?activeTotal-BigInt(previous.totalCents):null;
    const periodChange=activeTotal-BigInt(first.totalCents);
    let best:{month:TrendMonth;change:bigint}|null=null;
    for(let index=Math.max(1,start);index<=activeIndex;index+=1){
      const change=BigInt(months[index]!.totalCents)-BigInt(months[index-1]!.totalCents);
      if(!best||change>best.change)best={month:months[index]!,change};
    }
    const values=visibleMonths.map(month=>BigInt(month.totalCents));
    const max=values.reduce((acc,value)=>value>acc?value:acc,0n);
    const min=values.reduce((acc,value)=>value<acc?value:acc,values[0]??0n);
    const floor=min>0n?min-(max-min)/3n:0n;
    const span=max-floor>0n?max-floor:1n;
    const bars=visibleMonths.map((month,index)=>({month,height:Math.max(3,Number((values[index]!-floor)*1000n/span)/10)}));
    const previousBalances=new Map(previous?.buckets.map(bucket=>[bucket.id,BigInt(bucket.balanceCents)])??[]);
    const included=active.buckets.filter(bucket=>bucket.includeInTotal);
    const includedTotal=included.reduce((sum,bucket)=>sum+BigInt(bucket.balanceCents),0n);
    const composition=included.map(bucket=>{
      const balance=BigInt(bucket.balanceCents);
      const before=previousBalances.get(bucket.id);
      return {bucket,balance,share:includedTotal>0n?Number(balance*1000n/includedTotal)/10:0,delta:before===undefined?null:balance-before};
    }).sort((a,b)=>b.balance>a.balance?1:b.balance<a.balance?-1:0);
    const spanMonths=visibleMonths.length;
    return {visibleMonths,previous,monthChange,periodChange,periodPercent:percentChange(BigInt(first.totalCents),activeTotal),best,bars,composition,spanMonths,averageChange:spanMonths>1?periodChange/BigInt(spanMonths-1):null};
  },[active,activeIndex,months,range]);

  const header=<header className={mobile?'screen-head':'desk-head'}><h1>Andamento</h1><div className="pills mono-pills" role="group" aria-label="Periodo">{ranges.map(item=><button key={item.value} type="button" aria-pressed={range===item.value} onClick={()=>setRange(item.value)}>{item.label}</button>)}</div></header>;
  if(isLoading)return <div className="screen">{header}<div className="skeleton card"/></div>;
  if(!active||!view)return <div className="screen">{header}<div className="empty"><span className="empty-icon"><ChartNoAxesCombined/></span><h3>Nessun andamento disponibile</h3><p>I dati compariranno qui dopo le prime operazioni.</p></div></div>;

  const changeTone=(value:bigint|null)=>value===null?'':value>=0n?'pos':'neg';
  const chip=view.periodPercent!==null&&view.spanMonths>1&&<span className="lime-chip">{formatPercent(view.periodPercent)} {view.spanMonths}m</span>;
  const chart=<>
    <div className="trend-bars" role="group" aria-label={`Patrimonio mensile da ${formatMonth(view.visibleMonths[0]!.month)} a ${formatMonth(active.month)}`}>
      {view.bars.map(({month,height})=><button type="button" key={month.month} className={`trend-bar${month.month===active.month?' on':''}`} onClick={()=>setSelected(month.month)} aria-label={`${formatMonth(month.month)}: ${formatEuro(month.totalCents,hidden)}`} aria-pressed={month.month===active.month}>
        {!mobile&&<span className="mono trend-bar-value">{hidden?'••':compactThousands(BigInt(month.totalCents))}</span>}
        <span className="trend-bar-fill" style={{height:`${height}%`}}/>
      </button>)}
    </div>
    <div className="trend-labels mono">{view.visibleMonths.map(month=><span key={month.month}>{mobile?shortMonth(month.month).charAt(0):shortMonth(month.month)}</span>)}</div>
  </>;
  const composition=<section className={mobile?'tile':'tile s12'} aria-label="Composizione del patrimonio">
    <div className={mobile?'':'row-between'}><span className="cap">{mobile?'Composizione · variazione mese':'Bucket · composizione e variazione'}</span>{!mobile&&<div className="stack-bar narrow">{view.composition.map(item=><span key={item.bucket.id} style={{flex:item.share,background:item.bucket.color}}/>)}</div>}</div>
    {mobile&&<div className="stack-bar">{view.composition.map(item=><span key={item.bucket.id} style={{flex:item.share,background:item.bucket.color}}/>)}</div>}
    <div className="comp-rows">{view.composition.map(item=><div key={item.bucket.id} className="comp-row">
      <span className="comp-name"><i className="dot" style={{background:item.bucket.color}}/>{item.bucket.name}</span>
      {!mobile&&<span className="comp-bar"><span style={{width:`${item.share}%`,background:item.bucket.color}}/></span>}
      {mobile?<span className="mono mu">{item.share.toLocaleString('it-IT',{maximumFractionDigits:1})}%</span>:<span className="mono comp-value">{formatEuro(item.balance,hidden)}</span>}
      <span className={`mono comp-delta ${changeTone(item.delta)}`}>{item.delta===null?'—':formatEuro(item.delta,hidden,{sign:true})}</span>
    </div>)}</div>
  </section>;
  const prevLabel=view.previous?`vs ${shortMonth(view.previous.month).toLowerCase()}`:'vs mese prima';

  if(mobile)return <div className="screen trends">
    {header}
    <section className="tile">
      <div className="row-between top"><div><div className="cap">{formatMonth(active.month)}</div><Money className="mono trend-total" cents={active.totalCents} hidden={hidden}/></div>{chip}</div>
      {chart}
    </section>
    <div className="grid-2">
      <div className="tile"><div className="cap">{prevLabel}</div><div className={`mono trend-delta ${changeTone(view.monthChange)}`}>{view.monthChange===null?'Primo mese':formatEuro(view.monthChange,hidden,{sign:true})}</div></div>
      <div className="tile"><div className="cap">{view.spanMonths} {view.spanMonths===1?'mese':'mesi'}</div><div className={`mono trend-delta ${changeTone(view.periodChange)}`}>{formatEuro(view.periodChange,hidden,{sign:true})}</div></div>
    </div>
    {composition}
  </div>;

  return <div className="screen trends trends-desktop">
    {header}
    <div className="bento">
      <section className="tile s8 trend-chart">
        <div className="row-between top"><div><div className="cap">Patrimonio · {formatMonth(active.month).toLowerCase()}</div><Money className="mono trend-total big" cents={active.totalCents} hidden={hidden}/></div>{view.periodPercent!==null&&view.spanMonths>1&&<span className="lime-chip">{formatPercent(view.periodPercent)} in {view.spanMonths} mesi</span>}</div>
        {chart}
      </section>
      <div className="s4 trend-side">
        <div className="hero-tile"><div className="cap">{prevLabel}</div><div className="mono trend-side-amount">{view.monthChange===null?'Primo mese':formatEuro(view.monthChange,hidden,{sign:true})}</div>{view.previous&&view.monthChange!==null&&<div className="mono trend-side-sub">{(()=>{const value=percentChange(BigInt(view.previous.totalCents),BigInt(active.totalCents));return value===null?'':formatPercent(value)})()}</div>}</div>
        <div className="tile"><div className="cap">In {view.spanMonths} {view.spanMonths===1?'mese':'mesi'}</div><div className={`mono trend-side-amount ${changeTone(view.periodChange)}`}>{formatEuro(view.periodChange,hidden,{sign:true})}</div>{view.averageChange!==null&&<div className="mono trend-side-sub mu">media {formatEuro(view.averageChange,hidden,{sign:true})} / mese</div>}</div>
        <div className="tile"><div className="cap">Mese migliore</div>{view.best?<><div className="trend-best">{formatMonth(view.best.month.month)}</div><div className="mono trend-side-sub mu">{formatEuro(view.best.change,hidden,{sign:true})}</div></>:<div className="trend-best">—</div>}</div>
      </div>
      {composition}
    </div>
  </div>;
}
