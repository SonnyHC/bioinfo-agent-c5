import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const python = process.env.BIOINFO_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_engine.py', '-v'], { cwd: root, stdio: 'inherit', shell: false, env: {...process.env, MPLCONFIGDIR:path.join(root,'.local','test-matplotlib')} });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
