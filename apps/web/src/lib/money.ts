const euroFormatter=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'});

export function formatMoney(cents:string, hidden=false):string {
  if (hidden) return '••••••';
  return euroFormatter.format(Number(BigInt(cents))/100);
}
export function eurosToCents(value:string):string {
  const normalized=value.trim().replace(/\s/g,'').replace(',','.');
  if(!/^\d+(\.\d{0,2})?$/.test(normalized)) throw new Error('Inserisci un importo valido');
  const [whole,fraction='']=normalized.split('.'); return (BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'))).toString();
}
export function centsToInput(value:string):string {
  const cents=BigInt(value);
  const sign=cents<0n?'-':'';
  const absolute=cents<0n?-cents:cents;
  const whole=absolute/100n;
  const fraction=(absolute%100n).toString().padStart(2,'0');
  return fraction==='00'?`${sign}${whole}`:`${sign}${whole},${fraction}`;
}
export function sanitizeDecimalInput(value:string):string {
  const normalized=value.replace('.',',').replace(/[^\d,]/g,'');
  const [whole='',...fractions]=normalized.split(',');
  return fractions.length?`${whole},${fractions.join('').slice(0,2)}`:whole;
}
export function normalizePercentageInput(value:string):string {
  const sanitized=sanitizeDecimalInput(value);
  const [whole,fraction]=sanitized.split(',');
  if(fraction===undefined)return whole;
  const trimmed=fraction.replace(/0+$/,'');
  return trimmed?`${whole},${trimmed}`:whole;
}
export function percent(part:string,total:string):number { return BigInt(total)===0n?0:Number(BigInt(part)*1000n/BigInt(total))/10; }

export const HIDDEN_AMOUNT='••••••';

/**
 * Formats integer cents as "€1.234,56" using string arithmetic only, so large
 * balances never lose precision. `sign` prefixes "+" for positive values.
 */
export function formatEuro(cents:string|bigint,hidden=false,{sign=false}:{sign?:boolean}={}):string {
  if(hidden)return HIDDEN_AMOUNT;
  const {negative,whole,fraction}=euroParts(cents);
  const prefix=negative?'−':sign&&BigInt(cents)>0n?'+':'';
  return `${prefix}€${whole},${fraction}`;
}

export function euroParts(cents:string|bigint){
  const value=BigInt(cents);
  const negative=value<0n;
  const absolute=negative?-value:value;
  const whole=(absolute/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const fraction=(absolute%100n).toString().padStart(2,'0');
  return {negative,whole,fraction};
}

/** Parses an amount typed in Italian notation, returning 0 for empty or invalid input. */
export function safeCents(value:string):bigint {
  try{return value.trim()?BigInt(eurosToCents(value)):0n}catch{return 0n}
}

/** Like formatEuro but drops ",00" so short previews fit narrow tiles. */
export function formatEuroCompact(cents:string|bigint,hidden=false):string {
  const full=formatEuro(cents,hidden);
  return full.endsWith(',00')?full.slice(0,-3):full;
}
