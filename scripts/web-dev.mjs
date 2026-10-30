import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import chat from '../serverless/chat-handler.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.BIOINFO_PYTHON || (existsSync(localPython) ? localPython : 'python3');
const enableAnalysis = !!process.env.BIOINFO_PYTHON || existsSync(localPython) || process.argv.includes('--analysis');
const children = [];
let stopping = false;
const server = createServer((req, res) => {
  if (req.url === '/api/chat') void chat(req, res);
  else { res.statusCode = 404; res.end(); }
});
function stop(code = 0) {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  server.close(); server.closeAllConnections();
  for (const child of children) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
function launch(bin, args, optional = false) {
  const child = spawn(bin, args, { cwd: root, stdio: 'inherit', env: process.env });
  children.push(child);
  child.once('error', () => { console.error(optional ? '绘图服务未启动，请配置服务端 Python 环境；AI 对话仍可使用。' : '网页服务启动失败，请检查端口与依赖。'); if (!optional) stop(1); });
  child.once('exit', code => { if (!stopping && !optional) stop(code || 1); });
}
server.once('error', error => { console.error(error.message); stop(1); });
server.listen(4320, '127.0.0.1', () => {
  if (enableAnalysis) launch(python, ['scripts/analysis-dev.py'], true);
  else console.log('AI API 已启动。启用网页绘图请先运行 npm run setup:python，然后重启网站。');
  launch(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), ...(process.argv.includes('--production') ? ['preview'] : []), '--config', 'web/vite.config.ts', '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
  console.log('bioinfobuddy · http://127.0.0.1:5173 · 浏览器本地存储');
});
