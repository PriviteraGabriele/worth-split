import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter,Route,Routes } from 'react-router-dom';

/**
 * Renders a page inside a fresh query client and an in-memory router.
 * `routes` maps paths to elements so tests can follow in-app links.
 */
export function renderPage({path='/',routes}:{path?:string;routes:Record<string,ReactElement>}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  const result=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>{Object.entries(routes).map(([routePath,element])=><Route key={routePath} path={routePath} element={element}/>)}</Routes></MemoryRouter></QueryClientProvider>);
  return {client,...result};
}
