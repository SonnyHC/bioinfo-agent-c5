import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/app.ts';

test('local workflow preserves input, requires human approval, and exports real artifacts', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c5-api-'));
  const token = 'test-only-token';
  const { app } = await createApp({ dataDir, token });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(dataDir, { recursive: true, force: true }); });
  const call = async (url: string, body?: unknown, extra: Record<string, string> = {}) => {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const crossOrigin = await call('/api/examples/wide', {}, { Origin: 'https://unrelated.example' });
  assert.equal(crossOrigin.status, 403);
  const dataset = await call('/api/examples/wide', {});
  assert.equal(dataset.status, 201);
  assert(dataset.body.rows > 0);
  assert.equal(dataset.body.inputPath, undefined, 'local paths are not exposed');
  const numeric = dataset.body.columns.filter((c: any) => c.type === 'number').map((c: any) => c.name);
  const config = { datasetId: dataset.body.id, chart: 'box', layout: 'wide', valueColumns: numeric.slice(0, 2), missing: 'error' };
  const injection = await call('/api/plans', { ...config, code: 'arbitrary code', status: 'approved' });
  assert.equal(injection.status, 400);
  const draft = await call('/api/plans', config);
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.status, 'draft');
  assert.equal((await call(`/api/plans/${draft.body.id}/run`, {})).status, 409);
  const agentApproval = await call(`/api/plans/${draft.body.id}/approve`, {}, { 'X-Bioinfo-Token': token });
  assert.equal(agentApproval.status, 403);
  assert.equal((await call(`/api/plans/${draft.body.id}/approve`, {})).status, 200);
  const run = await call(`/api/plans/${draft.body.id}/run`, {});
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.status, 'completed');
  assert(run.body.artifacts.length >= 7);
  const duplicate = await call(`/api/plans/${draft.body.id}/run`, {});
  assert.equal(duplicate.body.id, run.body.id, 'repeated submission does not rerun');
  const image = await fetch(base + run.body.artifacts.find((a: any) => a.name === 'chart.png').url);
  const png = Buffer.from(await image.arrayBuffer());
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const bundle = await fetch(base + run.body.artifacts.find((a: any) => a.name === 'bundle.zip').url);
  assert.equal(Buffer.from(await bundle.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.equal((await call(`/api/datasets/${dataset.body.id}`)).body.sha256, dataset.body.sha256);
  const unauthorizedFile = await fetch(`${base}/api/runs/${run.body.id}/artifacts/connection.json`);
  assert.equal(unauthorizedFile.status, 404);
  assert.equal((await call('/api/datasets', undefined, { 'X-Bioinfo-Token': 'incorrect' })).status, 401);
});

test('file uploads reject invalid content and preserve quoted cells', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c5-upload-'));
  const { app } = await createApp({ dataDir });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(dataDir, { recursive: true, force: true }); });
  async function upload(text: string, filename: string) {
    const form = new FormData(); form.append('file', new Blob([text]), filename);
    const response = await fetch(base + '/api/datasets', { method: 'POST', body: form });
    return { status: response.status, body: await response.json() as any };
  }
  assert.equal((await upload('print(1)', 'run.r')).status, 400);
  assert.equal((await upload('x,x\n1,2', 'duplicate.csv')).status, 422);
  const quoted = await upload('group,value\n"A, first",1.5\nB,2.5\n', 'quoted.csv');
  assert.equal(quoted.status, 201, JSON.stringify(quoted.body));
  assert.equal(quoted.body.preview[0].group, 'A, first');
});
