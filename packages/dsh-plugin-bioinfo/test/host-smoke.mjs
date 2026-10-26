import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const child = spawn(process.execPath, [path.join(root, 'scripts/agent.mjs'), '--no-open'], {
  cwd: root, env: { ...process.env, BIOINFO_DSH_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Harness startup timed out')), 180000);
  const onData = (data) => {
    log += data.toString();
    const match = log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._-]+/);
    if (match) { clearTimeout(timeout); resolve(match[0]); }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('error', (error) => { clearTimeout(timeout); reject(error); });
  child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Harness exited before readiness (${code})`)); });
});

try {
  const tokenUrl = await ready;
  const origin = new URL(tokenUrl).origin;
  const auth = await fetch(tokenUrl, { redirect: 'manual' });
  const cookie = auth.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('dsh-auth-'));
  assert.equal(auth.status, 303);
  assert(cookie, 'Harness must issue an authentication cookie');
  const call = async (endpoint, args) => {
    const response = await fetch(`${origin}/api/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
      signal: AbortSignal.timeout(30000),
    });
    const result = (await response.json()).result;
    assert.equal(result?.ok, true, `RPC ${endpoint}: ${JSON.stringify(result?.error)}`);
    return result.value;
  };
  const bundles = await call('pluginManager/listBundles', {});
  assert(bundles.some((bundle) => bundle.name === 'dsh-plugin-bioinfo' && bundle.enabled && !bundle.error));
  const all = await call('agentPresets/list', {});
  const presets = Array.isArray(all) ? all : all.items || all.presets || [];
  assert(presets.some((preset) => preset.id === 'bioinfo-c5' && !preset.error));
  const workspace = await call('workspace/create', { request: { path: root } });
  const workspaceId = workspace.workspace?.workspaceId || workspace.workspaceId;
  assert(workspaceId);
  const session = await call('session/create', { request: { workspaceId, agentPreset: 'bioinfo-c5', title: 'bioinfobuddy integration verification' } });
  assert(session.sessionId || session.session?.sessionId);
  console.log('PASS official Harness authenticated HTTP startup');
  console.log('PASS official plugin manager installed and enabled bioinfobuddy bundle');
  console.log('PASS bioinfobuddy preset listed and mounted for a real session');
  console.log('No model request was sent; this does not verify a live DeepSeek response.');
} catch (error) {
  console.error(error.message);
  console.error(log.slice(-5000).replace(/([?&]token=)[A-Za-z0-9._-]+/g, '$1[redacted]'));
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
}
