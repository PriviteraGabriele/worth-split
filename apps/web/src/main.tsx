import { StrictMode } from 'react';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import { createRoot } from 'react-dom/client';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { installViewportEnvironment } from './lib/viewport';
import { installTheme } from './lib/theme';
import './styles/foundation.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/dialogs.css';
import './styles/settings.css';

installTheme();
installViewportEnvironment();

const client=new QueryClient({defaultOptions:{queries:{staleTime:15_000,retry:1}}});
let invalidFocusPending=false;
document.addEventListener('invalid',event=>{
  event.preventDefault();
  const field=event.target;
  if(!(field instanceof HTMLElement))return;
  field.setAttribute('aria-invalid','true');
  if(invalidFocusPending)return;
  invalidFocusPending=true;
  requestAnimationFrame(()=>{
    field.focus({preventScroll:true});
    field.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
    setTimeout(()=>{invalidFocusPending=false},0);
  });
},true);
document.addEventListener('input',event=>{
  if(event.target instanceof HTMLElement)event.target.removeAttribute('aria-invalid');
},true);
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></StrictMode>);
