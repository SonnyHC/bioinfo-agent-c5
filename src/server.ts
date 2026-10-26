import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { createApp, root } from './app.js';

const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须是 1024–65535 的整数。');
let harness: ChildProcess | undefined;
let harnessFailed = false;
let stopping = false;
const { app, token, dataDir } = await createApp({ port, harnessFailed: () => harnessFailed });
const server = app.listen(port, '127.0.0.1');

function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  harness?.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  await once(server, 'listening');
  if (stopping) throw new Error('Startup cancelled');
  // Publish only after binding: a second launch must not replace a live token.
  const connection = path.join(dataDir, 'connection.json');
  const temporary = `${connection}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, token }), { mode: 0o600 });
  if (stopping) { await fs.rm(temporary, {force:true}); throw new Error('Startup cancelled'); }
  await fs.rename(temporary, connection);
  if (stopping) throw new Error('Startup cancelled');
  await fs.rm(path.join(dataDir, 'harness.json'), { force: true });
  if (stopping) throw new Error('Startup cancelled');
  const log = await fs.open(path.join(dataDir, 'harness-runtime.log'), 'a', 0o600);
  try {
    if (stopping) throw new Error('Startup cancelled');
    harness = spawn(process.execPath, [path.join(root, 'scripts/agent.mjs'), '--no-open'], {
      cwd: root,
      env: { ...process.env, BIOINFO_DSH_PORT: process.env.BIOINFO_DSH_PORT || '0' },
      stdio: ['ignore', log.fd, log.fd],
    });
    harness.once('error', () => { harnessFailed = true; });
    harness.once('close', () => { if (!stopping) harnessFailed = true; });
  } finally { await log.close(); }
  console.log(`bioinfobuddy  http://127.0.0.1:${port}`);
  console.log(`数据与绘图  http://127.0.0.1:${port}/workbench`);
} catch (error) {
  if (!stopping) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  stop();
}
