import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function pythonExecutable(root: string) {
  if (process.env.BIOINFO_PYTHON) return process.env.BIOINFO_PYTHON;
  const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return existsSync(local) ? local : (process.platform === 'win32' ? 'python' : 'python3');
}

export async function runPython<T>(root: string, args: string[], input?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(root), [path.join(root, 'python/engine.py'), ...args], {
      cwd: root, shell: false,
      env: { ...process.env, PYTHONUTF8: '1', MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(root, '.local/matplotlib') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', error = '', settled = false;
    const fail = (message: string) => { if (!settled) { settled = true; reject(new Error(message)); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail('分析超过 120 秒，已停止。请缩小数据后重试。'); }, 120_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 2_000_000) { child.kill(); fail('分析结果超过大小限制。'); }
    });
    child.stderr.on('data', (chunk) => { error = (error + chunk.toString()).slice(-12_000); });
    child.on('error', () => { clearTimeout(timer); fail('无法启动 Python，请先运行 npm run setup:python。'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) return fail(error.trim() || '数据分析失败，请检查输入和字段。');
      try { const parsed = JSON.parse(output); settled = true; resolve(parsed); }
      catch { fail('分析引擎没有返回有效结果。'); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}
