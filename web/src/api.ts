import { unzipSync } from 'fflate';
import { list, read, save } from './storage';
import type { Dataset, Plan, Run } from './types';

type SavedDataset = Dataset & { file: Blob };
type SavedRun = Omit<Run, 'artifacts'> & { files: { name: string; blob: Blob }[] };
type SavedPlan = Plan & { sourceSha256: string };
const urls = new Map<string, string>();
const types: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip', json: 'application/json', csv: 'text/csv', py: 'text/plain', txt: 'text/plain' };

function publicDataset({ file: _file, ...data }: SavedDataset): Dataset { return data; }
function publicRun({ files, ...run }: SavedRun): Run {
  return { ...run, artifacts: files.map(file => {
    const key = `${run.id}/${file.name}`;
    if (!urls.has(key)) urls.set(key, URL.createObjectURL(file.blob));
    return { name: file.name, url: urls.get(key)! };
  }) };
}

async function encoded(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}

async function analysis(action: string, dataset?: Pick<SavedDataset, 'name' | 'file'>, config?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/analysis', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(dataset ? { name: dataset.name, file: await encoded(dataset.file) } : {}), config }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `分析服务返回 ${response.status}，请稍后重试。`);
  }
  return response;
}

export async function importDataset(file: File, signal?: AbortSignal) {
  if (!/\.(csv|tsv|xlsx)$/i.test(file.name)) throw new Error('请选择 CSV、TSV 或 XLSX 文件。');
  if (!file.size || file.size > 2 * 1024 * 1024) throw new Error('请选择非空且不超过 2 MB 的文件。');
  const initial = { id: crypto.randomUUID(), name: file.name, file, createdAt: new Date().toISOString() };
  const profile = await (await analysis('inspect', initial, undefined, signal)).json();
  signal?.throwIfAborted();
  return publicDataset(await save('datasets', { ...profile, ...initial } as SavedDataset));
}

const runLocks = new Set<string>();
async function runPlan(id: string, signal?: AbortSignal): Promise<Run> {
  if (runLocks.has(id)) throw new Error('此方案正在运行，请稍候。');
  runLocks.add(id);
  try {
    const plan = await read<SavedPlan>('plans', id);
    if (plan.status !== 'approved') throw new Error('此方案尚未确认，无法运行。');
    const dataset = await read<SavedDataset>('datasets', plan.datasetId);
    const record = { id: crypto.randomUUID(), planId: id, datasetId: dataset.id, createdAt: new Date().toISOString() };
    let result: SavedRun;
    try {
      const response = await analysis('render', dataset, plan, signal);
      const zip = new Uint8Array(await response.arrayBuffer());
      const entries = unzipSync(zip);
      const summary = JSON.parse(new TextDecoder().decode(entries['summary.json']));
      const files = Object.entries(entries).map(([name, data]) => ({ name, blob: new Blob([new Uint8Array(data)], { type: types[name.split('.').pop()!] || 'application/octet-stream' }) }));
      files.push({ name: 'bundle.zip', blob: new Blob([zip], { type: 'application/zip' }) });
      result = { ...record, status: 'completed', summary, files };
    } catch (reason) {
      result = { ...record, status: 'failed', summary: { rows: 0 }, files: [], error: reason instanceof Error ? reason.message : '绘图失败。' };
      await save('runs', result);
      throw reason;
    }
    // Don't replace successful output with a failed record if persistence fails.
    await save('runs', result);
    return publicRun(result);
  } finally { runLocks.delete(id); }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  let result: unknown;
  if (path === '/status') result = await (await analysis('status')).json();
  else if (path === '/datasets' && method === 'POST') {
    const file = (init?.body as FormData).get('file');
    if (!(file instanceof File)) throw new Error('请选择数据文件。');
    result = await importDataset(file, init?.signal ?? undefined);
  } else if (path === '/datasets') result = { datasets: (await list<SavedDataset>('datasets')).map(publicDataset) };
  else if (/^\/datasets\/[^/]+$/.test(path)) result = publicDataset(await read<SavedDataset>('datasets', path.split('/')[2]));
  else if (path === '/plans' && method === 'POST') {
    const dataset = await read<SavedDataset>('datasets', body.datasetId);
    const config = Object.fromEntries(['chart', 'layout', 'x', 'y', 'group', 'valueColumns', 'missing', 'title', 'xLabel', 'yLabel'].filter(key => body[key] !== undefined).map(key => [key, body[key]]));
    const preview = await (await analysis('preview', dataset, config, init?.signal ?? undefined)).json();
    result = await save('plans', { ...config, ...preview, datasetId: dataset.id, sourceSha256: dataset.sha256,
      id: crypto.randomUUID(), status: 'draft', createdAt: new Date().toISOString() });
  } else if (path === '/plans') result = { plans: await list<Plan>('plans') };
  else if (/^\/plans\/[^/]+\/approve$/.test(path) && method === 'POST') {
    const plan = await read<SavedPlan>('plans', path.split('/')[2]);
    result = await save('plans', { ...plan, status: 'approved' });
  } else if (/^\/plans\/[^/]+\/run$/.test(path) && method === 'POST') result = await runPlan(path.split('/')[2], init?.signal ?? undefined);
  else if (/^\/plans\/[^/]+$/.test(path)) result = await read<Plan>('plans', path.split('/')[2]);
  else if (path === '/runs') result = { runs: (await list<SavedRun>('runs')).map(publicRun) };
  else if (/^\/runs\/[^/]+$/.test(path)) result = publicRun(await read<SavedRun>('runs', path.split('/')[2]));
  else throw new Error('不支持此操作。');
  return result as T;
}

export const post = <T>(path: string, body?: unknown, signal?: AbortSignal) => api<T>(path, {
  method: 'POST', signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
