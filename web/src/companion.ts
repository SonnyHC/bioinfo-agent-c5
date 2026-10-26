const BASE = 'http://127.0.0.1:4317';
const KEY = 'bioinfobuddy-companion-token';
export function companionConnected() { return !!sessionStorage.getItem(KEY); }
export const COMPANION_CHANGE = 'bioinfobuddy-companion-change';
export function disconnectCompanion() { sessionStorage.removeItem(KEY); window.dispatchEvent(new Event(COMPANION_CHANGE)); }
export async function companionFetch(route: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(BASE + route, { ...init, headers: { ...(route === '/pair' ? {} : { Authorization: `Bearer ${sessionStorage.getItem(KEY) || ''}` }), ...init.headers },
      // Supported browsers may request permission to connect to the user's computer.
      targetAddressSpace: 'loopback',
    } as RequestInit);
  } catch {
    if (init.signal?.aborted) throw init.signal.reason;
    throw new Error('无法连接本地助手。请启动助手，并允许浏览器访问本机网络。');
  }
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    if (response.status === 401 && route !== '/pair' && (route !== '/chat' || value.code === 'COMPANION_AUTH_REQUIRED')) disconnectCompanion();
    throw new Error(value.error || `本地助手返回 ${response.status}`);
  }
  return response;
}
export async function companion<T = Record<string, unknown>>(route: string, value?: unknown): Promise<T> {
  return (await companionFetch(route, value === undefined ? {} : { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(value) })).json();
}
export async function pairCompanion(code: string) {
  const result = await companion<{token:string}>('/pair', {code});
  sessionStorage.setItem(KEY, result.token);
  window.dispatchEvent(new Event(COMPANION_CHANGE));
}
export type LocalKind = 'tables' | 'fastq' | 'single-cell' | 'r-script';
export interface LocalSkill { id: LocalKind; name: string; version: string; runtime: string; description: string; extensions: string[]; installed?: boolean }
export interface LocalProfile {
  columns?: (string | {name: string; type: string; missing: number})[];
  preview?: Record<string, unknown>[]; rowCount?: number; rows?: number; cells?: number; genes?: number;
  embeddings?: string[]; annotations?: string[]; code?: string; note?: string; sampledReads?: number;
}
export interface LocalDataset { id: string; name: string; kind: LocalKind; size: number; sha256: string; createdAt: string; profile?: LocalProfile }
export interface LocalPlan {
  id: string; datasetId: string; template: string; params: Record<string, unknown>; dataId?: string | null;
  sourceSha256: string; status: string; createdAt: string; steps: string[]; warnings: string[];
  preview: Record<string, unknown>[]; outputColumns?: string[]; inputRows?: number; outputRows?: number; droppedRows?: number;
}
export interface LocalRun { id: string; planId: string; datasetId: string; name: string; template: string; status: 'running' | 'completed' | 'failed'; createdAt: string; artifacts: string[]; summary?: Record<string, unknown>; error?: string }
export interface LocalStatus { version: string; skills: LocalSkill[]; datasets: LocalDataset[]; runs: LocalRun[]; dataDir: string }
export interface LocalJob { id: string; status: 'running' | 'completed' | 'failed'; log: string; error?: string; result?: unknown }
export async function waitJob(id: string, changed: (job:LocalJob)=>void, signal?:AbortSignal): Promise<unknown> {
  for (;;) {
    signal?.throwIfAborted();
    const value=await companion<LocalJob>(`/jobs/${id}`); changed(value);
    if(value.status==='completed')return value.result;
    if(value.status==='failed')throw new Error(value.error || '任务失败。');
    await new Promise<void>((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',aborted);resolve();};const timer=setTimeout(done,1000);const aborted=()=>{clearTimeout(timer);reject(new Error('已停止等待；任务仍在本地助手运行。'));};signal?.addEventListener('abort',aborted,{once:true});});
  }
}
