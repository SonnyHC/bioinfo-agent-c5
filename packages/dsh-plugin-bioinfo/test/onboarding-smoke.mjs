// Isolated official-host check: never reads or writes the user's model keys.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, realpath, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { presentationOverlay } from '../lib/presentation.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const packagePath = require.resolve('@deepseek-ai/dsh/package.json');
const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
const bin = path.join(path.dirname(packagePath), metadata.bin.dsh);
const temporary = await mkdtemp(path.join(tmpdir(), 'bioinfo-onboarding-'));
const home = path.join(temporary, 'dsh');
const fixture = path.join(temporary, 'bioinfo-plugin');
await cp(path.join(root, 'packages/dsh-plugin-bioinfo'), fixture, { recursive: true });
const overlay = path.join(temporary, 'presentation.patch.yml');
const connection = JSON.parse(await readFile(path.join(root, '.local/connection.json'), 'utf8'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|TOKEN|SECRET|DSH_HOME/i.test(key)));
Object.assign(env, {
  DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
  PATH: `${path.join(root, 'node_modules/.bin')}${path.delimiter}${env.PATH || ''}`,
  BIOINFO_BASE_URL: connection.baseUrl, BIOINFO_TOKEN: connection.token,
});
await writeFile(overlay, presentationOverlay, { mode: 0o600 });
let host;
const redacted = (text) => text.replace(/([?&]token=)[A-Za-z0-9._-]+/g, '$1[redacted]');
function launch(args) {
  const child = spawn(process.execPath, ['--expose-internals', bin, ...args], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (part) => { log += part.toString(); });
  child.stderr.on('data', (part) => { log += part.toString(); });
  return { child, log: () => log };
}
async function stop() {
  if (!host) return;
  const { child } = host;
  host = undefined;
  if (child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.kill('SIGTERM');
  await closed;
}
async function start() {
  host = launch(['--profile', 'web', '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open']);
  const { child, log } = host;
  const tokenUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Host startup timed out: ${redacted(log()).slice(-2000)}`)), 90000);
    const inspect = () => {
      const match = log().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._-]+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); reject(new Error(`Host exited ${code}: ${redacted(log()).slice(-2000)}`)); });
  });
  const auth = await fetch(tokenUrl, { redirect: 'manual' });
  const cookie = auth.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('dsh-auth-'));
  assert.equal(auth.status, 303);
  assert(cookie);
  const origin = new URL(tokenUrl).origin;
  return {
    async call(endpoint, args = {}) {
      const response = await fetch(`${origin}/api/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
        signal: AbortSignal.timeout(30000),
      });
      const result = (await response.json()).result;
      assert.equal(result?.ok, true, `RPC ${endpoint}: ${JSON.stringify(result?.error)}`);
      return result.value;
    },
    async page() { return (await fetch(origin, { headers: { Cookie: cookie } })).text(); },
  };
}

try {
  const install = launch(['plugin', '--profile', 'web', 'add', `file:${fixture}`]);
  const code = await new Promise((resolve, reject) => { install.child.once('close', resolve); install.child.once('error', reject); });
  assert.equal(code, 0, redacted(install.log()).slice(-3000));
  await writeFile(path.join(fixture, 'lib/new-file-after-install.js'), 'export const installed = true;\n');
  const migrate = launch(['plugin', '--profile', 'web', 'add', `link:${fixture}`]);
  const migrated = await new Promise((resolve, reject) => { migrate.child.once('close', resolve); migrate.child.once('error', reject); });
  assert.equal(migrated, 0, redacted(migrate.log()).slice(-3000));
  const installedPath = path.join(home, 'profiles/web/node_modules/dsh-plugin-bioinfo');
  assert.equal(await realpath(installedPath), await realpath(fixture));
  assert.match(await readFile(path.join(installedPath, 'lib/new-file-after-install.js'), 'utf8'), /installed = true/);
  console.log('PASS existing file-snapshot installation migrates to a live link with newly added plugin files');
  let client = await start();
  const page = await client.page();
  assert.match(page, /<title>bioinfobuddy<\/title>/);
  assert.match(page, /__DSH_MODELS_ONBOARDING__/);
  assert.match(page, /credentialOnboarding[^<]{0,40}true/);
  assert.match(page, /__BIOINFO_WORKBENCH__/);
  assert.match(page, /dsh-plugin-bioinfo/);
  const settings = await client.call('settings/describe');
  const sections = settings.namespaces;
  assert(Array.isArray(sections), 'settings/describe returns namespaces');
  assert.equal(sections.find((item) => item.ns === 'ui-settings-general')?.value.welcomeNoticeVersion, '2026-09-28.1');
  assert(!sections.some((item) => item.ns === 'ui-settings-account'), 'account choice contributor is disabled');
  const before = await client.call('credentials/describe', { refs: ['DEEPSEEK_API_KEY'] });
  assert.equal(before.DEEPSEEK_API_KEY.configured, false);
  assert.equal(before.DEEPSEEK_API_KEY.writable, true);
  console.log('PASS fresh official Harness serves API-key onboarding and the bioinfobuddy workbench link');
  const sentinel = `sk-local-test-${randomUUID()}`;
  await client.call('credentials/set', { ref: 'DEEPSEEK_API_KEY', value: sentinel });
  const configured = await client.call('credentials/describe', { refs: ['DEEPSEEK_API_KEY'] });
  assert.equal(configured.DEEPSEEK_API_KEY.configured, true);
  const credentialPath = path.join(home, '.credentials.yaml');
  const hash = (data) => createHash('sha256').update(data).digest('hex');
  const originalHash = hash(await readFile(credentialPath));
  await stop();
  client = await start();
  const restored = await client.call('credentials/describe', { refs: ['DEEPSEEK_API_KEY'] });
  assert.equal(restored.DEEPSEEK_API_KEY.configured, true);
  assert.equal(hash(await readFile(credentialPath)), originalHash, 'presentation startup preserves the saved credential store');
  console.log('PASS official credential save and restart preserve configured state without changing saved values');
  console.log('No model request was sent. All credential operations used a temporary test home.');
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
