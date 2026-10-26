import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const python = process.env.BIOINFO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) { console.error(result.error?.message || '安装失败，请检查上方错误。'); process.exit(1); }
}
run(python, ['-m', 'venv', '.venv']);
const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
run(venv, ['-m', 'pip', 'install', '-r', 'python/requirements.txt']);
console.log('Python 分析环境已安装。');
