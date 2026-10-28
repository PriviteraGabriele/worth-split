import { Box,PiggyBank,TrendingUp,Wallet } from 'lucide-react';
import type { Bucket } from '../types';

const icons={spending:Wallet,saving:PiggyBank,investment:TrendingUp,other:Box} as const;

/** Solid square in the bucket colour with its type icon. */
export function BucketSquare({type,color,size=28}:{type:Bucket['type'];color:string;size?:number}){
  const Icon=icons[type];
  return <span className="bucket-square" style={{background:color,width:size,height:size,borderRadius:Math.round(size/3)}} aria-hidden="true"><Icon/></span>;
}
