import { useSyncExternalStore } from 'react';

// lib/viewport.ts owns the phone/desktop decision and publishes it on <html>.
// Without that attribute (tests, first paint) the phone layout is assumed.
function read(){return document.documentElement.dataset.mobileUi!=='false'}

function subscribe(notify:()=>void){
  const observer=new MutationObserver(notify);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-mobile-ui']});
  return()=>observer.disconnect();
}

export function useMobileLayout(){return useSyncExternalStore(subscribe,read,()=>true)}
