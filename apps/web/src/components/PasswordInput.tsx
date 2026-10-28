import { useLayoutEffect,useRef,useState,type InputHTMLAttributes,type PointerEvent } from 'react';
import { Eye,EyeOff } from 'lucide-react';

export function PasswordInput(props:Omit<InputHTMLAttributes<HTMLInputElement>,'type'>){
  const [visible,setVisible]=useState(false);
  const inputRef=useRef<HTMLInputElement>(null);
  const selectionRef=useRef<{start:number|null;end:number|null;direction:'forward'|'backward'|'none'|null}|null>(null);

  useLayoutEffect(()=>{
    const input=inputRef.current,selection=selectionRef.current;
    if(!input||!selection)return;
    input.focus({preventScroll:true});
    if(selection.start!==null&&selection.end!==null)input.setSelectionRange(selection.start,selection.end,selection.direction??undefined);
    selectionRef.current=null;
  },[visible]);

  function keepInputFocused(event:PointerEvent<HTMLButtonElement>){event.preventDefault()}
  function toggleVisibility(){
    const input=inputRef.current;
    selectionRef.current=input&&document.activeElement===input?{start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}:null;
    setVisible(value=>!value);
  }

  return <div className="password-control"><input {...props} ref={inputRef} type={visible?'text':'password'}/><button type="button" onPointerDown={keepInputFocused} onClick={toggleVisibility} aria-label={visible?'Nascondi password':'Mostra password'} title={visible?'Nascondi password':'Mostra password'}>{visible?<EyeOff/>:<Eye/>}</button></div>;
}
