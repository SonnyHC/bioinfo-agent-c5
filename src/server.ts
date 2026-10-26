import { createApp } from './app.js';
const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须是 1024–65535 的整数。');
const { app } = await createApp({ port });
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`图研 · BioWorkbench  http://127.0.0.1:${port}`);
  console.log('数据与结果仅保存在项目 .local/；另开终端 npm run agent 启动 DeepSeek Harness。');
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
