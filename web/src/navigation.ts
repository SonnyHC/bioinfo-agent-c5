export type AnalysisView = 'analysis' | 'history';
export type MainView = 'chat' | 'tutorial' | 'genomes' | 'skills' | AnalysisView;
export interface AnalysisRequest { plan?: string; run?: string; dataset?: string }
export const viewLabels: Record<MainView, string> = {chat:'AI 对话',tutorial:'使用教程',genomes:'参考基因组',skills:'数据分析技能',analysis:'数据与绘图',history:'运行记录'};
const isView = (value: string | null): value is MainView => value !== null && Object.hasOwn(viewLabels, value);

// Only known, same-site app destinations can become clickable model/tool links.
export function safeAppLink(value: string): string | undefined {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f]/.test(value)) return;
  let url: URL;
  try { url = new URL(value, 'https://bioinfobuddy.invalid'); } catch { return; }
  if (url.origin !== 'https://bioinfobuddy.invalid' || !['/', '/workbench', '/workbench/'].includes(url.pathname) || url.hash) return;
  for (const [key, item] of url.searchParams) {
    if (!['view','plan','run','dataset'].includes(key) || url.searchParams.getAll(key).length !== 1) return;
    if (key === 'view' ? !isView(item) : !/^[a-zA-Z0-9_-]{1,100}$/.test(item)) return;
  }
  const legacy = url.pathname !== '/';
  const linkedAnalysis = url.searchParams.has('plan') || url.searchParams.has('run');
  if (legacy || linkedAnalysis) url.searchParams.set('view', 'analysis');
  // Stable query order keeps generated links easy to compare and share.
  const query = new URLSearchParams();
  for (const key of ['view','plan','run','dataset']) if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key)!);
  return '/' + (query.size ? '?' + query.toString() : '');
}
export function appRoute(value: string): { view: MainView; request: AnalysisRequest } {
  const link = safeAppLink(value) ?? '/';
  const query = new URL(link, 'https://bioinfobuddy.invalid').searchParams;
  const view = query.get('view');
  return {view:isView(view) ? view : 'chat', request:{...(query.has('plan') ? {plan:query.get('plan')!} : {}),...(query.has('run') ? {run:query.get('run')!} : {}),...(query.has('dataset') ? {dataset:query.get('dataset')!} : {})}};
}
export function messageParts(text: string): { text: string; href?: string }[] {
  return text.split(/(\[[^\]]+\]\([^\s)]+\))/g).map(part => {
    const match = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    const href = match && safeAppLink(match[2]);
    return href ? {text:match![1],href} : {text:part};
  });
}
