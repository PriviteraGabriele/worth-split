import { useEffect,useId,useRef,type MouseEvent as ReactMouseEvent,type PointerEvent as ReactPointerEvent,type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { isEditableElement } from '../lib/viewport';

const focusableSelector='button:not([disabled]),a[href],input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: a bottom sheet on phones, a centred card on desktop.
 * `variant="drawer"` is the desktop side panel used by settings sub-pages,
 * with an optional eyebrow above the title and a sticky footer.
 */
export function Modal({title,onClose,actions,children,variant='sheet',eyebrow,footer}:{title:string;onClose:()=>void;actions?:ReactNode;children:ReactNode;variant?:'sheet'|'drawer';eyebrow?:string;footer?:ReactNode}){
  const dialogRef=useRef<HTMLElement>(null);
  const onCloseRef=useRef(onClose);
  const titleId=useId();
  const keepOpenAfterKeyboardDismiss=useRef(false);

  useEffect(()=>{onCloseRef.current=onClose},[onClose]);

  useEffect(()=>{
    const dialog=dialogRef.current;
    if(!dialog)return;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const appRoot=document.getElementById('root');
    const currentCount=Number(document.body.dataset.modalCount??'0')+1;
    document.body.dataset.modalCount=String(currentCount);
    document.body.classList.add('modal-open');
    appRoot?.setAttribute('inert','');

    const focusTimer=window.setTimeout(()=>{
      const isMobile=document.documentElement.dataset.mobileUi==='true';
      const preferred=dialog.querySelector<HTMLElement>('[data-auto-focus]');
      (isMobile?dialog:preferred??dialog).focus({preventScroll:true});
    },document.documentElement.dataset.mobileUi==='true'?0:180);

    const handleKeyDown=(event:KeyboardEvent)=>{
      // Only the topmost dialog reacts when a sheet is open above a drawer.
      const dialogs=document.querySelectorAll('.modal');
      if(dialogs[dialogs.length-1]!==dialog)return;
      if(event.key==='Escape'){
        if(dialog.querySelector('.select-control.open'))return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if(event.key!=='Tab')return;
      const focusable=[...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if(!focusable.length){event.preventDefault();dialog.focus({preventScroll:true});return}
      const first=focusable[0]!;
      const last=focusable.at(-1)!;
      if(document.activeElement===dialog){event.preventDefault();(event.shiftKey?last:first).focus();return}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    };
    document.addEventListener('keydown',handleKeyDown);

    return()=>{
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown',handleKeyDown);
      const nextCount=Math.max(0,Number(document.body.dataset.modalCount??'1')-1);
      if(nextCount){document.body.dataset.modalCount=String(nextCount)}
      else{
        delete document.body.dataset.modalCount;
        document.body.classList.remove('modal-open');
        appRoot?.removeAttribute('inert');
      }
      if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
    };
  },[]);

  function handleBackdropPointerDown(event:ReactPointerEvent<HTMLDivElement>){
    if(event.target!==event.currentTarget)return;
    const active=document.activeElement;
    if(document.documentElement.dataset.mobileUi==='true'&&isEditableElement(active)){
      active.blur();
      keepOpenAfterKeyboardDismiss.current=true;
    }
  }

  function handleBackdropClick(event:ReactMouseEvent<HTMLDivElement>){
    if(event.target!==event.currentTarget)return;
    event.preventDefault();
    event.stopPropagation();
    if(keepOpenAfterKeyboardDismiss.current){
      keepOpenAfterKeyboardDismiss.current=false;
      return;
    }
    onClose();
  }

  function keepPointerInside(event:ReactPointerEvent<HTMLElement>){event.stopPropagation()}
  return createPortal(
    <div className={`modal-backdrop${variant==='drawer'?' drawer-backdrop':''}`} role="presentation" onPointerDown={handleBackdropPointerDown} onClick={handleBackdropClick}>
      <section ref={dialogRef} className={`modal${variant==='drawer'?' drawer':''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onPointerDown={keepPointerInside}>
        <header>{eyebrow?<div className="modal-heading"><span className="cap">{eyebrow}</span><h2 id={titleId}>{title}</h2></div>:<h2 id={titleId}>{title}</h2>}<div className="modal-header-actions">{actions}<button className={variant==='drawer'?'ib':'icon-button'} onClick={onClose} aria-label="Chiudi" title="Chiudi"><X/></button></div></header>
        {variant==='drawer'?<div className="drawer-body">{children}</div>:children}
        {footer&&<footer className="drawer-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
