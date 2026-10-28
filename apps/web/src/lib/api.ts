export class ApiError extends Error { constructor(public status:number, public code:string) { super(code); } }
export async function api<T>(path:string, init?:RequestInit):Promise<T> {
  const headers=new Headers(init?.headers);
  if(init?.body!=null&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const response = await fetch(`/api${path}`, { ...init, credentials:'include', headers });
  if (!response.ok) { const body = await response.json().catch(() => ({ error:'NETWORK_ERROR' })); throw new ApiError(response.status, body.error); }
  return response.status === 204 ? undefined as T : response.json();
}
export const newKey = () => crypto.randomUUID();
