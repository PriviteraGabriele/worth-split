import { HIDDEN_AMOUNT,euroParts } from '../lib/money';

/** Amount in the Grafite style: "€48.230" with the decimals faded. */
export function Money({cents,hidden=false,sign=false,className}:{cents:string|bigint;hidden?:boolean;sign?:boolean;className?:string}){
  if(hidden)return <span className={className}>{HIDDEN_AMOUNT}</span>;
  const {negative,whole,fraction}=euroParts(cents);
  const prefix=negative?'−':sign&&BigInt(cents)>0n?'+':'';
  return <span className={className}>{prefix}€{whole}<span className="dec">,{fraction}</span></span>;
}
