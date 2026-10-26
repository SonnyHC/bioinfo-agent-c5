import {spawnSync} from 'node:child_process';

const [major, minor] = process.versions.node.split('.').map(Number);
const nodeReady = (major === 22 && minor >= 18) || (major === 24 && minor >= 2) || major > 24;
const check = (bin, args) => spawnSync(bin, args, {encoding:'utf8', shell:false, timeout:15000});
console.log(`Node.js ${process.versions.node}：${nodeReady ? '就绪' : '需要 22.18+（22.x）或 24.2+'}`);
const uv = check(process.env.BIOINFO_UV || 'uv', ['--version']);
console.log(uv.status === 0 ? `uv：${uv.stdout.trim()}` : '未找到 uv。请先按 https://docs.astral.sh/uv/getting-started/installation/ 安装，重新打开终端后再试。');
const r = check(process.env.BIOINFO_RSCRIPT || 'Rscript', ['--version']);
console.log(r.status === 0 ? `R：${(r.stdout || r.stderr).trim()}` : '未找到 Rscript；Python 技能仍可使用。需要运行 R 脚本时，请安装 https://cran.r-project.org/ 提供的 R。');
if (!nodeReady || uv.status !== 0) process.exitCode = 1;
else console.log('可以运行 npm run companion，并在网页中配对、安装所需分析环境。首次环境安装需要网络。');
