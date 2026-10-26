# bioinfobuddy

面向郑州大学 C5 项目的生信表格分析与绘图 Agent。

**默认是可部署到 Vercel 的独立网页。无需启动 DeepSeek Harness 服务。**
网页采用 Harness 的工具调用流程：检查真实数据 → 提出方案 → 用户确认 → 执行绘图 → 核对结果。

## 使用

- 首次打开配置自己的 DeepSeek API Key。默认只在当前标签会话保存，可选择在此浏览器记住。
- 导入 CSV、TSV、XLSX，或使用合成样例。网页上传上限为 **2 MiB**，适配 Vercel 请求大小限制；最多 50,000 行、100 列，XLSX 读取第一张工作表。
- 在对话中要求检查数据、制定绘图方案；点击返回的链接进入工作台确认并执行。
- 支持箱线图、小提琴图、散点图、直方图、均值柱状图、热图。
- 可导出 PNG / SVG / PDF、处理后的 CSV、参数记录、可独立执行的 Python 绘图脚本和 ZIP 复现包。

## 本地存储与计算

| 内容 | 位置 |
| --- | --- |
| 原始文件、数据概要、方案、图表、运行记录、聊天记录 | 当前网站、当前浏览器的 IndexedDB |
| 模型名称 | 当前浏览器 localStorage |
| API Key | 默认 sessionStorage；勾选记住后为 localStorage |
| Python 处理过程 | 一次请求的临时目录，结束后删除 |
| 模型请求 | 同源 `/api/chat` 临时转发至官方 DeepSeek API |

“本地保存”指数据长期存放在浏览器中，不代表离线计算。导入、预览和绘图会把相应文件发送到本站 Python 接口；模型会收到对话、工具返回的字段概要和少量数据预览。服务器应用不保存聊天、API Key 或分析文件，也不记录请求正文。

清除网站数据会删除本地记录；更换浏览器、设备、域名或端口不会自动同步。重要结果请下载复现包，聊天可在右上角导出 JSON。旧版项目的 `.local/` 文件没有被删除，也不会自动上传或导入新版。尚未提供跨设备同步、差异分析、富集分析、FASTQ/H5AD 或单细胞计算。

## 本机预览

需要 Node.js 22.18+ 或 24.2+、Python 3.12。

```bash
npm ci --ignore-scripts
npm run setup:python
npm run build
npm start
```

打开 <http://127.0.0.1:5173>。`npm run dev` 提供开发模式。两个本地 API 适配器与 Vercel 使用同一套处理代码，只监听本机 4319/4320；默认启动流程不读取旧 `.local/dsh`，不启动 Harness。

## 部署与绑定域名

完整操作见 [Vercel 部署说明](docs/vercel-deployment.md)。

1. 将此版本推送到 GitHub，在 Vercel 中导入仓库。
2. 仓库根目录部署；`vercel.json` 已定义构建命令、静态输出和两个函数。
3. 先验证 Vercel 预览网址的对话、绘图、刷新恢复和下载。
4. 在项目 Settings → Domains 添加 `bioinfobuddy.com.cn`，按控制台实际给出的 DNS 值配置。

不需要额外的常驻服务器或云数据库。Vercel 和 DeepSeek 按各自账户套餐计量，部署配置本身不包含密钥。

## 验证与源码

```bash
npm run typecheck
npm run test:cloud
npm run test:python
npm run build
```

- `web/src/Chat.tsx`：独立对话界面。
- `web/src/agent-loop.ts`、`agent-tools.ts`：工具循环与受限科学工具。
- `web/src/storage.ts`、`api.ts`：浏览器存储、方案确认与结果恢复。
- `api/chat.js`、`serverless/chat-handler.mjs`：无状态模型转发。
- `api/analysis.py`、`python/engine.py`：无状态接口与固定 Python 绘图逻辑。

旧本机服务及官方 Harness 插件仍在 `src/`、`packages/dsh-plugin-bioinfo/` 中作为历史实现保留；`npm run dev:legacy` / `npm run agent` 是显式的旧模式命令，**不参与新版运行或 Vercel 部署**。原集成说明见 [Harness 集成](docs/harness-integration.md)。新版是沿用 Harness 工具设计的独立实现，不声称调用了官方 Harness 运行时。

比赛依据见 [比赛要求及首版范围](docs/competition-and-scope.md)，上游许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
