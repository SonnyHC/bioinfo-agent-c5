import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
const root = path.resolve(import.meta.dirname, '..');
const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const candidates = process.env.BIOINFO_SETUP_PYTHON ? [process.env.BIOINFO_SETUP_PYTHON] : [
  ...(existsSync(venv) ? [venv] : []), 'python3.13', 'python3.12', 'python3.11', 'python3', 'python',
];
const python = candidates.find(exe => {
  const check = spawnSync(exe, ['-c', 'import sys; sys.exit(0 if sys.version_info.major == 3 and 11 <= sys.version_info.minor <= 13 else 1)'], { stdio: 'ignore' });
  return check.status === 0;
});
if (!python) { console.error('需要 Python 3.11–3.13。请安装相应版本，或用 BIOINFO_SETUP_PYTHON 指定创建虚拟环境的解释器路径。'); process.exit(1); }
function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) { console.error(result.error?.message || '安装失败，请检查上方错误。'); process.exit(1); }
}
if (python !== venv) run(python, ['-m', 'venv', '.venv']);
run(venv, ['-m', 'pip', 'install', '-r', 'python/requirements.txt']);
console.log('Python 分析环境已安装。');
