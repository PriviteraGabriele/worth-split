import { useId,useState,type ChangeEvent,type FormEvent } from 'react';
import { Modal } from './Modal';
import { PasswordInput } from './PasswordInput';

export function TextInputModal({title,label,type='text',submitLabel,onSubmit,onClose,minLength}:{title:string;label:string;type?:'text'|'password';submitLabel:string;onSubmit:(value:string)=>void|Promise<void>;onClose:()=>void;minLength?:number}){
  const errorId=useId();
  const [value,setValue]=useState('');
  const [submitted,setSubmitted]=useState(false);
  const tooShort=minLength!==undefined&&value.length>0&&value.length<minLength;
  const error=tooShort
    ?type==='password'?`La password deve contenere almeno ${minLength} caratteri.`:`Inserisci almeno ${minLength} caratteri.`
    :submitted&&!value?'Inserisci un valore.':'';
  function change(event:ChangeEvent<HTMLInputElement>){setValue(event.currentTarget.value)}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setSubmitted(true);
    if(!value||tooShort)return;
    await onSubmit(value);
  }
  const validationProps={minLength,required:true,'aria-invalid':Boolean(error),'aria-describedby':error?errorId:undefined,'aria-errormessage':error?errorId:undefined,onChange:change};
  return <Modal title={title} onClose={onClose}><form className="stack" onSubmit={submit} noValidate><label>{label}{type==='password'?<PasswordInput name="value" {...validationProps} data-auto-focus enterKeyHint="done" autoComplete="off"/>:<input name="value" {...validationProps} data-auto-focus enterKeyHint="done" autoComplete="off"/>}</label>{error&&<p className="form-error" id={errorId} role="alert">{error}</p>}<div className="edit-actions"><button type="button" className="secondary" onClick={onClose}>Annulla</button><button className="primary">{submitLabel}</button></div></form></Modal>;
}
