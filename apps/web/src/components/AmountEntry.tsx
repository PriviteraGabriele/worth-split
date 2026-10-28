import type { ReactNode } from 'react';
import { euroParts,safeCents,sanitizeDecimalInput } from '../lib/money';
import { useMobileLayout } from '../lib/useMobileLayout';

/**
 * Large amount readout backed by a real input. On phones the system keyboard
 * stays closed (the on-screen keypad edits the value); on desktop the field
 * accepts typing directly.
 */
export function AmountEntry({value,onChange,label,prefix='',hint,autoFocus}:{value:string;onChange:(value:string)=>void;label:string;prefix?:string;hint?:ReactNode;autoFocus?:boolean}){
  const mobile=useMobileLayout();
  const {whole,fraction}=euroParts(safeCents(value));
  return <div>
    <label className="amount-display">
      <span className="amount" aria-hidden="true">{prefix}€{whole}<span className="dec">,{fraction}</span></span>
      <input aria-label={label} inputMode={mobile?'none':'decimal'} autoComplete="off" value={value} onChange={event=>onChange(sanitizeDecimalInput(event.currentTarget.value))} autoFocus={autoFocus&&!mobile}/>
    </label>
    {hint&&<div className="amount-hint">{hint}</div>}
  </div>;
}
