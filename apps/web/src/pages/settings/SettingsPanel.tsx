import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link,useNavigate } from 'react-router-dom';
import { FlowHeader } from '../../components/FlowHeader';
import { Modal } from '../../components/Modal';
import { useMobileLayout } from '../../lib/useMobileLayout';

export const SETTINGS_PATH='/impostazioni';

/**
 * Shell of every settings sub-page: a full-screen page on phones and a side
 * drawer over the settings bento on desktop. `cap` names the section
 * ("Bucket", or "Bucket · Nuovo" for nested steps). `back` is where the
 * leading button goes; on desktop the drawer always closes to the settings home.
 */
export function SettingsPanel({cap,title,lead,back=SETTINGS_PATH,closeIcon=false,action,footer,children}:{
  cap:string;
  title:string;
  lead?:ReactNode;
  back?:string;
  closeIcon?:boolean;
  action?:ReactNode;
  footer?:ReactNode;
  children:ReactNode;
}){
  const mobile=useMobileLayout();
  const navigate=useNavigate();
  if(mobile)return <div className="flow settings-sub">
    <FlowHeader to={back} kind={closeIcon?'close':'back'} title={<span className="cap">{cap.includes('·')?cap:`Impostazioni · ${cap}`}</span>} trailing={action}/>
    <h1 className="sub-title">{title}</h1>
    {lead&&<p className="sub-lead">{lead}</p>}
    {children}
    {footer&&<><div className="flow-spacer"/><div className="sub-foot">{footer}</div></>}
  </div>;
  const nested=back!==SETTINGS_PATH;
  return <Modal variant="drawer" title={title} eyebrow={`Impostazioni · ${cap}`} onClose={()=>navigate(SETTINGS_PATH)} footer={footer} actions={<>{action}{nested&&<Link className="ib" to={back} aria-label="Indietro" title="Indietro"><ChevronLeft aria-hidden="true"/></Link>}</>}>
    {lead&&<p className="sub-lead">{lead}</p>}
    {children}
  </Modal>;
}
