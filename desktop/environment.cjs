'use strict';

const { execFile, spawn } = require('node:child_process');
const { access, constants } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(execFile);

function environmentCommand(platform, directory, id, systemRoot) {
  const suffix = { darwin: 'macos', win32: 'windows' }[platform];
  const actions = ['single-cell', 'spatial', 'case-single-cell', 'case-spatial'];
  if (!suffix || !actions.some(action => id === action + '-' + suffix)) throw new Error('请选择本机的安装项目。');
  if (platform === 'darwin') {
    const file = path.join(directory, 'actions', id + '.command');
    return { file, executable: '/usr/bin/open', args: ['-b', 'com.apple.Terminal', file] };
  }
  const file = path.win32.join(directory, 'receive.ps1');
  return { file, executable: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, 'bioinfobuddy://install/' + id] };
}

async function installEnvironment(directory, id) {
  const { file, executable, args } = environmentCommand(process.platform, directory, id, process.env.SystemRoot || 'C:\\Windows');
  await access(file, process.platform === 'darwin' ? constants.X_OK : constants.R_OK);
  if (process.platform === 'darwin') {
    await run(executable, args);
    return;
  }
  // A detached PowerShell process owns its console and can continue after the workbench exits.
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { environmentCommand, installEnvironment };
