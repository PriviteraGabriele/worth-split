import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties } from 'react';
import { Check,ChevronDown } from 'lucide-react';

type Option={value:string;label:string;disabled?:boolean;color?:string};
type MenuPlacement='above'|'below';
type MenuLayout={placement:MenuPlacement;maxHeight:number};

const MENU_GAP=7;
const MENU_EDGE_MARGIN=8;
const MENU_MAX_HEIGHT=220;

function visibleBounds(root:HTMLElement){
  const viewport=window.visualViewport;
  let top=viewport?.offsetTop??0;
  let bottom=top+(viewport?.height??window.innerHeight);
  const modal=root.closest<HTMLElement>('.modal');

  if(modal){
    const modalRect=modal.getBoundingClientRect();
    top=Math.max(top,modalRect.top);
    bottom=Math.min(bottom,modalRect.bottom);
  }

  top+=MENU_EDGE_MARGIN;
  bottom-=MENU_EDGE_MARGIN;
  return {top,bottom:Math.max(top,bottom),modal};
}

export function SelectControl({name,options,value,defaultValue,placeholder='Seleziona',onChange}:{name?:string;options:Option[];value?:string;defaultValue?:string;placeholder?:string;onChange?:(value:string)=>void}){
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false);
  const [menuLayout,setMenuLayout]=useState<MenuLayout|null>(null);
  const [internal,setInternal]=useState(defaultValue??options[0]?.value??'');
  const selected=value??internal;
  const option=options.find(item=>item.value===selected);
  const optionCount=options.length;

  useEffect(()=>{
    function close(){setOpen(false);setMenuLayout(null)}
    function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))close()}
    function escape(event:KeyboardEvent){if(event.key==='Escape')close()}
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return()=>{
      document.removeEventListener('pointerdown',outside);
      document.removeEventListener('keydown',escape);
    };
  },[]);

  useLayoutEffect(()=>{
    if(!open||!root.current||!trigger.current||!menu.current)return;

    const rootElement=root.current;
    const triggerElement=trigger.current;
    const menuElement=menu.current;
    const viewport=window.visualViewport;
    const {modal}=visibleBounds(rootElement);
    let frame:number|null=null;

    function measure(){
      frame=null;
      const bounds=visibleBounds(rootElement);
      const triggerRect=triggerElement.getBoundingClientRect();
      const spaceAbove=Math.max(0,triggerRect.top-bounds.top-MENU_GAP);
      const spaceBelow=Math.max(0,bounds.bottom-triggerRect.bottom-MENU_GAP);
      const preferredHeight=Math.min(MENU_MAX_HEIGHT,menuElement.scrollHeight);
      const placement:MenuPlacement=spaceBelow<preferredHeight&&spaceAbove>spaceBelow?'above':'below';
      const availableHeight=placement==='above'?spaceAbove:spaceBelow;
      const nextLayout={placement,maxHeight:Math.max(0,Math.floor(Math.min(MENU_MAX_HEIGHT,availableHeight)))};
      setMenuLayout(current=>current?.placement===nextLayout.placement&&current.maxHeight===nextLayout.maxHeight?current:nextLayout);
    }

    function scheduleMeasure(){
      if(frame!==null)return;
      if(typeof window.requestAnimationFrame==='function'){
        frame=window.requestAnimationFrame(measure);
      }else{
        measure();
      }
    }

    measure();
    window.addEventListener('resize',scheduleMeasure,{passive:true});
    window.addEventListener('scroll',scheduleMeasure,{capture:true,passive:true});
    viewport?.addEventListener('resize',scheduleMeasure,{passive:true});
    viewport?.addEventListener('scroll',scheduleMeasure,{passive:true});
    modal?.addEventListener('scroll',scheduleMeasure,{passive:true});

    const resizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(rootElement);
    resizeObserver?.observe(triggerElement);
    resizeObserver?.observe(menuElement);
    if(modal)resizeObserver?.observe(modal);

    return()=>{
      if(frame!==null&&typeof window.cancelAnimationFrame==='function')window.cancelAnimationFrame(frame);
      window.removeEventListener('resize',scheduleMeasure);
      window.removeEventListener('scroll',scheduleMeasure,true);
      viewport?.removeEventListener('resize',scheduleMeasure);
      viewport?.removeEventListener('scroll',scheduleMeasure);
      modal?.removeEventListener('scroll',scheduleMeasure);
      resizeObserver?.disconnect();
    };
  },[open,optionCount]);

  function choose(next:string){setOpen(false);setMenuLayout(null);setInternal(next);onChange?.(next)}
  function toggle(){setMenuLayout(null);setOpen(current=>!current)}

  const placement=menuLayout?.placement??'below';
  const placementClass=open?` select-placement-${placement}`:'';
  const menuStyle:CSSProperties|undefined=menuLayout?{
    maxHeight:`${menuLayout.maxHeight}px`,
    top:placement==='above'?'auto':undefined,
    bottom:placement==='above'?`calc(100% + ${MENU_GAP}px)`:undefined,
  }:undefined;

  return <div className={`select-control${open?' open':''}${selected?' has-value':''}${placementClass}`} ref={root}>
    {name&&<input type="hidden" name={name} value={selected}/>}<button ref={trigger} type="button" className="select-trigger" onClick={toggle} aria-haspopup="listbox" aria-expanded={open}><span className={!option?'placeholder':''}>{option?.color&&<i className="select-color-dot" style={{background:option.color}}/>}{option?.label??placeholder}</span><ChevronDown/></button>
    {open&&<div ref={menu} className="select-options" role="listbox" tabIndex={-1} style={menuStyle}>{options.map(item=><button type="button" role="option" aria-selected={item.value===selected} className={`${item.value===selected?'selected':''} ${item.disabled?'disabled':''}`} onClick={event=>{event.preventDefault();event.stopPropagation();choose(item.value)}} disabled={item.disabled} key={item.value}><span>{item.color&&<i className="select-color-dot" style={{background:item.color}}/>}{item.label}</span>{item.value===selected&&<Check/>}</button>)}</div>}
  </div>;
}
