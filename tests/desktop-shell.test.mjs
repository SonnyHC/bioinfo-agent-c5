import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import protocol from '../desktop/protocol.cjs';
import environment from '../desktop/environment.cjs';

const { APP_ORIGIN, externalURL, isWorkbench, protocolHandler } = protocol;
const { environmentCommand } = environment;
const post = (pathname, body, origin = APP_ORIGIN) => new Request(APP_ORIGIN + pathname, {
  method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
});

test('the stable workbench origin resolves routes and serves only packaged renderer content', async t => {
  const client = await mkdtemp(path.join(tmpdir(), 'biobuddy-routes-'));
  t.after(() => rm(client, { recursive: true, force: true }));
  await writeFile(path.join(client, 'desktop.html'), '<p>Workbench</p>');
  const serve = protocolHandler({ client, fetchFile: async url => new Response(await readFile(fileURLToPath(url))) });
  for (const route of ['/', '/?view=chat', '/workbench/?run=example']) {
    const response = await serve(new Request(APP_ORIGIN + route));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(await response.text(), '<p>Workbench</p>');
  }
  for (const route of ['/desktop/main.cjs', '/config/model-providers.json', '/particle/NOTICE', '/assets/missing.js']) {
    assert.equal((await serve(new Request(APP_ORIGIN + route))).status, 404);
  }
  assert.ok(isWorkbench(APP_ORIGIN + '/?view=tutorial'));
  assert.equal(isWorkbench('https://workbench/'), false);
  assert.equal(isWorkbench(APP_ORIGIN + '/resources/v1/example.md'), false);
  assert.equal(externalURL('https://www.ncbi.nlm.nih.gov/'), 'https://www.ncbi.nlm.nih.gov/');
  assert.equal(externalURL('file:///example.txt'), undefined);
  assert.equal(externalURL(APP_ORIGIN + '/'), undefined);
});

test('local APIs validate method, JSON, origin and size before calling handlers', async () => {
  const calls = [];
  const serve = protocolHandler({
    inspectRequest: body => { calls.push(body.action); return { status: 200, data: { mode: 'desktop' } }; },
    chatRequest: () => { calls.push('chat'); return { status: 400, data: { error: '需要模型设置' } }; },
  });
  const status = await serve(post('/api/analysis', { action: 'status' }));
  assert.deepEqual(await status.json(), { mode: 'desktop' });
  assert.equal((await serve(post('/api/chat', {}))).status, 400);
  assert.equal((await serve(post('/api/chat', {}, 'https://example.org'))).status, 403);
  assert.equal((await serve(new Request(APP_ORIGIN + '/api/analysis'))).status, 405);
  assert.equal((await serve(new Request(APP_ORIGIN + '/api/chat', { method: 'POST', body: 'text' }))).status, 415);
  assert.equal((await serve(post('/api/chat', 'x'.repeat(512_000)))).status, 400);
  assert.deepEqual(calls, ['status', 'chat']);
});

test('installation launches a known platform action with separate executable arguments', () => {
  for (const prefix of ['single-cell', 'spatial', 'case-single-cell', 'case-spatial']) {
    const macId = prefix + '-macos';
    const mac = environmentCommand('darwin', '/Applications/BioInfoBuddy.app/Contents/Resources/environment', macId);
    assert.equal(mac.executable, '/usr/bin/open');
    assert.deepEqual(mac.args, ['-b', 'com.apple.Terminal', mac.file]);
    assert.ok(mac.file.endsWith('/actions/' + macId + '.command'));
    const winId = prefix + '-windows';
    const win = environmentCommand('win32', 'C:\\My Apps\\BioInfoBuddy\\environment', winId, 'C:\\Windows');
    assert.equal(win.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(win.args.slice(-3), ['-File', 'C:\\My Apps\\BioInfoBuddy\\environment\\receive.ps1', 'bioinfobuddy://install/' + winId]);
    assert.throws(() => environmentCommand('darwin', '/resources', winId));
    assert.throws(() => environmentCommand('win32', 'C:\\resources', macId));
  }
  assert.throws(() => environmentCommand('darwin', '/resources', 'unknown'));
});
