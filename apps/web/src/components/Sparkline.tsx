import type { TrendMonth } from '../types';

const WIDTH=350;
const HEIGHT=140;

/** Thin line of the monthly totals; geometry only, figures stay in cents elsewhere. */
export function Sparkline({months,className}:{months:TrendMonth[];className?:string}){
  if(months.length<2)return null;
  const values=months.map(month=>Number(BigInt(month.totalCents)/100n));
  const min=Math.min(...values);
  const max=Math.max(...values);
  const span=Math.max(max-min,1);
  const step=WIDTH/(values.length-1);
  const points=values.map((value,index)=>`${(index*step).toFixed(1)},${(HEIGHT-4-((value-min)/span)*(HEIGHT-8)).toFixed(1)}`).join(' ');
  return <svg className={className} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/></svg>;
}
