import type { ReactNode } from 'react';
import { ChevronLeft,X } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Header of a full-screen task: leading back/close link, centred title, trailing slot. */
export function FlowHeader({to,kind='back',title,trailing}:{to:string;kind?:'back'|'close';title:ReactNode;trailing?:ReactNode}){
  return <header className="flow-header">
    <Link className="ib" to={to} aria-label={kind==='back'?'Indietro':'Chiudi'}>{kind==='back'?<ChevronLeft aria-hidden="true"/>:<X aria-hidden="true"/>}</Link>
    {title}
    {trailing??<span aria-hidden="true"/>}
  </header>;
}
