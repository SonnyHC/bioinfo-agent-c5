import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseHarnessBootstrap } from '../packages/dsh-plugin-bioinfo/lib/bootstrap.js';
import { presentationOverlay } from '../packages/dsh-plugin-bioinfo/lib/presentation.js';
import { createLauncherState } from '../packages/dsh-plugin-bioinfo/lib/launcher-state.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const local = path.join(root, '.local');
const home = path.join(local, 'dsh');
const bundle = path.join(root, 'packages', 'dsh-plugin-bioinfo');
const targetVersion = '0.2.1-rc.2';
const args = process.argv.slice(2);
const lifecycle = createLauncherState();
const stop = () => lifecycle.stop();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function fingerprint(dir) {
  const hash = createHash('sha256');
  async function visit(folder) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules') continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) hash.update(path.relative(dir, file)).update(await readFile(file));
    }
  }
  await visit(dir);
  return hash.digest('hex');
}

function run(bin, argv, env, { bootstrapPort } = {}) {
  return new Promise((resolve, reject) => {
    lifecycle.check();
    const capture = bootstrapPort !== undefined;
    const bootstrapFile = path.join(local, 'harness.json');
    let writes = Promise.resolve();
    let spawnError;
    const child = spawn(process.execPath, ['--expose-internals', bin, ...argv], {
      cwd: root, env, stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });
    lifecycle.attach(child);
    if (capture) {
      for (const stream of ['stdout', 'stderr']) {
        let pending = '';
        const inspect = (line) => {
          const bootstrapUrl = parseHarnessBootstrap(line, bootstrapPort);
          if (!bootstrapUrl || lifecycle.stopping) return;
          writes = writes.then(async () => {
            if (lifecycle.stopping) return;
            const temp = `${bootstrapFile}.${child.pid}.tmp`;
            await writeFile(temp, JSON.stringify({ bootstrapUrl, pid: child.pid }), { mode: 0o600 });
            if (lifecycle.stopping) { await rm(temp, { force: true }); return; }
            await rename(temp, bootstrapFile);
          }).catch(() => { console.error('无法保存本地 Harness 入口，请使用终端中 Harness 输出的地址。'); });
        };
        child[stream].on('data', (chunk) => {
          process[stream].write(chunk);
          pending += chunk.toString();
          const lines = pending.split(/\r?\n/);
          pending = lines.pop().slice(-4096);
          for (const line of lines) inspect(line);
        });
        child[stream].on('end', () => { if (pending) inspect(pending); });
      }
    }
    child.once('error', (error) => { spawnError = error; });
    child.once('close', async (code, signal) => {
      lifecycle.detach(child);
      await writes;
      if (capture && child.pid) {
        try {
          const current = JSON.parse(await readFile(bootstrapFile, 'utf8'));
          if (current.pid === child.pid) await rm(bootstrapFile, { force: true });
        } catch { /* No entry was published, or another launcher already replaced it. */ }
      }
      if (spawnError) { reject(spawnError); return; }
      if (lifecycle.stopping) { reject(new DOMException('Launcher stopped', 'AbortError')); return; }
      if (code === 0) resolve();
      else reject(new Error(`Harness exited with code ${code ?? signal}.`));
    });
  });
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const supportedNode = (major === 22 && minor >= 18) || (major === 24 && minor >= 2) || major > 24;
  if (!supportedNode || typeof import.meta.main !== 'boolean') {
    throw new Error(`当前 Node.js ${process.versions.node} 不支持此版 Harness 启动入口。请升级到 Node.js 22.18+（22.x）或 24.2+，再运行 npm run agent。`);
  }
  if (args.includes('--help')) {
    console.log('Usage: npm run agent [-- --no-open] [-- --reinstall] [-- --dump-config]\nStarts official DeepSeek Harness with the C5 preset in project-local .local/dsh. Start the workbench first.');
    return;
  }
  let packagePath;
  try { packagePath = require.resolve('@deepseek-ai/dsh/package.json'); }
  catch { throw new Error('缺少官方 Harness。先在项目目录执行 npm install。'); }
  const meta = JSON.parse(await readFile(packagePath, 'utf8'));
  if (meta.version !== targetVersion) throw new Error(`此插件验证的 Harness 版本为 ${targetVersion}，当前为 ${meta.version}。请使用仓库锁定依赖。`);
  const bin = path.join(path.dirname(packagePath), meta.bin.dsh);
  let current;
  try { current = JSON.parse(await readFile(path.join(local, 'connection.json'), 'utf8')); }
  catch { throw new Error('请先运行 npm run dev 启动本地工作台，再运行 npm run agent。尚无 .local/connection.json。'); }
  const url = new URL(current.baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !current.token) throw new Error('无效的本地工作台连接信息。请重启工作台。');
  const health = await fetch(`${url.origin}/api/datasets`, {
    headers: { 'X-Bioinfo-Token': current.token }, signal: AbortSignal.timeout(5000), redirect: 'error',
  }).catch(() => null);
  if (!health?.ok) throw new Error('本地工作台未就绪或令牌已过期。请重启工作台后再运行智能体。');
  lifecycle.check();
  await mkdir(home, { recursive: true, mode: 0o700 });
  lifecycle.check();
  const env = {
    ...process.env,
    PATH: `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    BIOINFO_BASE_URL: url.origin,
    BIOINFO_TOKEN: current.token,
  };
  const digest = `link-v1:${targetVersion}:${await fingerprint(bundle)}`;
  const marker = path.join(home, 'bioinfo-bundle.sha256');
  const installed = await readFile(marker, 'utf8').catch(() => '');
  const installedPath = path.join(home, 'profiles/web/node_modules/dsh-plugin-bioinfo');
  const linked = (await realpath(installedPath).catch(() => '')) === await realpath(bundle);
  lifecycle.check();
  if (installed !== digest || !linked || args.includes('--reinstall')) {
    console.log('安装/更新项目内 C5 插件（官方 Harness 插件管理器）…');
    await run(bin, ['plugin', '--profile', 'web', 'add', `link:${bundle}`], env);
    lifecycle.check();
    if (await realpath(installedPath) !== await realpath(bundle)) throw new Error('C5 插件链接未更新，请重新运行 npm run agent。');
    lifecycle.check();
    await writeFile(marker, digest, { mode: 0o600 });
  }
  lifecycle.check();
  // Deployment presentation is layered over the official profile. Model and
  // credential configuration remains in the user's Harness settings.
  const overlay = path.join(home, 'bioinfo-default.patch.yml');
  await writeFile(overlay, presentationOverlay, { mode: 0o600 });
  lifecycle.check();
  console.log('bioinfobuddy · DeepSeek Harness 0.2.1-rc.2');
  console.log('首次进入请配置 API Key，随后使用「bioinfobuddy」开始分析。');
  console.log(`数据与绘图：${url.origin}/workbench`);
  const command = ['--profile', 'web', '--patch', overlay];
  const port = process.env.BIOINFO_DSH_PORT || '3080';
  if (args.includes('--dump-config')) command.push('--dump-config');
  else command.push('--host', '127.0.0.1', '--port', port, ...(args.includes('--no-open') ? ['--no-open'] : []));
  await run(bin, command, env, args.includes('--dump-config') ? {} : { bootstrapPort: port });
}

main().catch((error) => {
  if (!lifecycle.stopping) { console.error(error.message); process.exitCode = 1; }
}).finally(() => {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
});
