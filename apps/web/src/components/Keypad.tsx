import { Delete } from 'lucide-react';
import { sanitizeDecimalInput } from '../lib/money';

const keys=['1','2','3','4','5','6','7','8','9',',','0'] as const;

/** Numeric keypad for euro amounts; the value uses Italian decimal notation. */
export function Keypad({value,onChange,disabled}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
  function press(key:string){
    if(key===','&&value.includes(','))return;
    const base=value==='0'&&key!==','?'':value;
    onChange(sanitizeDecimalInput(`${base||(key===','?'0':'')}${key}`));
  }
  return <div className="keypad" role="group" aria-label="Tastierino numerico">
    {keys.map(key=><button type="button" key={key} onClick={()=>press(key)} disabled={disabled} aria-label={key===','?'Virgola':key}>{key}</button>)}
    <button type="button" onClick={()=>onChange(value.slice(0,-1))} disabled={disabled} aria-label="Cancella"><Delete aria-hidden="true"/></button>
  </div>;
}
