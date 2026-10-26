import test from 'node:test';
import assert from 'node:assert/strict';
import { connection, resourceId, callApi, workbenchUrl } from '../lib/client.js';
import { createTools } from '../lib/tools.js';
import * as bioinfoTools from '../lib/tools.js';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

test('plugin mounts into the real Cordis + Harness tool registry', async () => {
  const ctx = new Context();
  const fibers = [];
  try {
    fibers.push(await ctx.plugin(SystemPrompt, {}));
    fibers.push(await ctx.plugin(ToolRuntime, {}));
    fibers.push(await ctx.plugin(bioinfoTools));
    const names = ctx.tools.schemas().map((schema) => schema.name);
    assert.deepEqual(names.sort(), ['bio_get_run', 'bio_inspect_dataset', 'bio_list_datasets', 'bio_open_workbench', 'bio_preview_plan', 'bio_run_approved_plan']);
    assert(!names.some((name) => /bash|shell|python|approve|exec|write/.test(name) && name !== 'bio_run_approved_plan'));
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose();
  }
});

test('connection accepts only loopback and never includes credentials in errors', () => {
  assert.deepEqual(connection({ BIOINFO_BASE_URL: 'http://127.0.0.1:4318', BIOINFO_TOKEN: 'local-test' }), { baseUrl: 'http://127.0.0.1:4318', token: 'local-test' });
  for (const baseUrl of ['https://example.com', 'http://example.com', 'http://127.0.0.1:4318/other', 'http://secret:pass@127.0.0.1:4318', 'http://127.0.0.1:4318/?token=secret']) {
    assert.throws(() => connection({ BIOINFO_BASE_URL: baseUrl, BIOINFO_TOKEN: 'test' }), /127.0.0.1/);
  }
});

test('untrusted IDs cannot alter endpoint paths', () => {
  assert.equal(resourceId('dataset_01-abc'), 'dataset_01-abc');
  for (const id of ['../approve', 'a/run?approve=1', '/etc/passwd', '', 1]) assert.throws(() => resourceId(id), /Invalid resource ID/);
});

test('workbench links carry only validated resource IDs and no authentication token', () => {
  const env = { BIOINFO_BASE_URL: 'http://127.0.0.1:4318', BIOINFO_TOKEN: 'private-test-token' };
  assert.equal(workbenchUrl({}, env), 'http://127.0.0.1:4318/workbench');
  assert.equal(workbenchUrl({ planId: 'plan_1', runId: 'run-2' }, env), 'http://127.0.0.1:4318/workbench?plan=plan_1&run=run-2');
  assert.throws(() => workbenchUrl({ planId: '../credentials' }, env), /Invalid resource ID/);
});

test('approval endpoint is never exposed to agent', async () => {
  await assert.rejects(callApi('/api/plans/abc/approve', { method: 'POST' }), /not exposed/);
});

test('actual Harness tool definitions validate arguments and filter extra plan fields', async () => {
  const definitions = createTools();
  assert.deepEqual(definitions.map((tool) => tool.name), ['bio_open_workbench', 'bio_list_datasets', 'bio_inspect_dataset', 'bio_preview_plan', 'bio_run_approved_plan', 'bio_get_run']);
  const preview = definitions.find((tool) => tool.name === 'bio_preview_plan');
  await assert.rejects(preview.execute({ datasetId: 'abc', chart: 'arbitrary-code', layout: 'long', missing: 'error' }, {}), /chart/);
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.BIOINFO_BASE_URL;
  const originalToken = process.env.BIOINFO_TOKEN;
  process.env.BIOINFO_BASE_URL = 'http://127.0.0.1:4318';
  process.env.BIOINFO_TOKEN = 'test-token';
  let call;
  globalThis.fetch = async (url, options) => { call = { url, options }; return new Response(JSON.stringify({ id: 'plan_1', approved: false }), { status: 200 }); };
  try {
    const open = definitions.find((tool) => tool.name === 'bio_open_workbench');
    assert.deepEqual(await open.execute({ planId: 'plan_1' }, {}), { workbenchUrl: 'http://127.0.0.1:4318/workbench?plan=plan_1' });
    assert.equal(call, undefined, 'opening the workbench is a link, with no API call or browser launch');
    const plan = await preview.execute({ datasetId: 'abc', chart: 'box', layout: 'long', missing: 'error', approved: true, command: 'rm -rf x', path: '/private/data' }, {});
    assert.equal(plan.workbenchUrl, 'http://127.0.0.1:4318/workbench?plan=plan_1');
    const body = JSON.parse(call.options.body);
    assert.deepEqual(body, { datasetId: 'abc', chart: 'box', layout: 'long', missing: 'error' });
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers['X-Bioinfo-Token'], 'test-token');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'approval required' }), { status: 409 });
    await assert.rejects(definitions.find((tool) => tool.name === 'bio_run_approved_plan').execute({ planId: 'plan_1' }, {}), /确认字段与处理步骤后重试/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.BIOINFO_BASE_URL; else process.env.BIOINFO_BASE_URL = originalBase;
    if (originalToken === undefined) delete process.env.BIOINFO_TOKEN; else process.env.BIOINFO_TOKEN = originalToken;
  }
});
