# bioinfobuddy

面向大学生和科研人员的生信对话与网页绘图工具。首页配置国内模型 API 后即可对话，无需安装客户端或配对服务。

## 功能

- **AI 对话**：DeepSeek、通义千问、智谱 GLM、Kimi、豆包、MiniMax、百度文心。密钥按提供商独立保存，模型配置和官方文档见 [模型 API](docs/model-api.md)。
- **数据与绘图**：CSV / TSV / XLSX（单个文件最大 2 MB，Excel 读取第一张工作表），支持箱线、小提琴、散点、直方、柱状和热图。
- **数据分析技能**：网页技能库提供搜索、分类、流程详情和“我的技能”。可添加、停用、移除及下载内置技能；AI 按需加载已启用的流程，或从技能页直接开始对话。添加记录保存在当前浏览器，不安装本机环境。
- **确认与复现**：AI 只检查数据、提出方案；用户在网页核对转换后确认运行。可调整字段、缺失值处理、标题和轴标签，重新预览生成新的运行记录，导出 PNG / SVG / PDF / 复现包。
- **参考基因组**：301 个版本，可搜索物种、组装版本、登录号并访问原始下载站点；逐条来源与移除原因见 `docs/reference-genomes-audit.json`。
- **组学案例**：PBMC2700 单细胞四图与 GBM1 空间转录组九图，提供解读、参数、配色、R / Python / Quarto 代码和跨平台环境指南下载。四篇专题教程已按实际网页改写并配有截图；技能库新增五项组学方法指导。
- **完整资料下载**：全部 44 个 V1.0 原文件原样保留。约 280 MB 原 ZIP 分为七份，网页可逐份校验并合并下载；另提供约 7.6 MB 的单细胞复现包、43 MB 的空间复现包，以及教程截图包。落位与验证说明见 [V1.0 资料接入](docs/v1-materials.md)。

已删除原有本机助手服务、配对与环境安装入口；数据分析技能以纯网页流程库重新提供。不再支持 FASTQ、H5AD 和本机 R 脚本执行。用户已有文件目录不会被程序删除或迁移。没有实现差异分析、富集分析或重新计算 UMAP，也未开放第三方技能安装。

组学案例中的结果来自用户提供的附件；下载代码需由用户在外部环境运行，网站不执行 Seurat / Scanpy。当前资料接入不表示已重新计算案例或完成 macOS / Windows 全流程复现。

## 启动网站

需要 Node.js 22.18+（22.x）或 24.2+。

```bash
npm ci --ignore-scripts
npm run dev
```

打开 `http://127.0.0.1:5173`。命令同时启动网页与 `/api/chat` 转发服务，不需要 Python 即可使用 AI 对话和参考基因组。

开发者需要网页绘图时，在网站服务端安装 Python 3.11–3.13，然后运行：

```bash
npm run setup:python
npm run dev
```

启动脚本发现项目 `.venv` 或指定了 `BIOINFO_PYTHON` 时，会启动本站分析 API。普通网站访问者无需安装 Python。`npm run dev:cloud` 显式启用分析 API；`npm run dev:web` 只启动前端，依赖已有 API 服务。

生产本机预览：`npm run build` 后运行 `npm start`。云端部署见 [Vercel 部署说明](docs/vercel-deployment.md)。

## 数据流

| 内容 | 处理与保存位置 |
| --- | --- |
| API Key | 默认在当前标签会话保存；勾选“记住”后保存于此浏览器。经本站 API 转发到所选官方平台，本站代码不持久保存或记录密钥 |
| 模型请求 | `/api/chat` → 配置中固定的官方 API；包括对话、必要字段与少量预览 |
| 表格 | 上传至本站 `/api/analysis` 临时处理，请求结束后清理工作目录 |
| 导入文件、方案、图表、聊天 | 当前浏览器的 IndexedDB；不同浏览器和域名不会自动同步 |
| 参考基因组下载 | 链接指向原始数据站点 |
| 组学案例与下载 | 本站静态资源，按需读取；不需要模型密钥，不自动将矩阵或图片发给模型 |

请及时下载重要结果；清除网站存储会删除浏览器中的文件与记录。本站分析接口只运行固定绘图模板，不执行模型生成的代码。

## 开发与验证

```bash
npm run typecheck
npm run build
npm run test:cloud
npm run test:python
```

- `config/model-providers.json`：前后端共用的国内模型配置及官方文档来源。
- `web/src/Chat.tsx`：对话、模型设置、统一导航。
- `web/src/App.tsx`：嵌入主界面的网页绘图工作区。
- `web/src/agent-tools.ts`：读取真实数据与创建草稿的受限工具。
- `web/src/skill-catalog.ts`、`skill-library.ts`、`SkillStore.tsx`：内置技能目录、浏览器添加记录与技能商店。新增技能需声明输入、输出、流程和限制，使用已存在的网站工具。
- `web/src/OmicsResources.tsx`、`OmicsGuides.tsx`、`omics-content.ts`：案例、图文教程及下载入口；`resource-download.ts` 负责可取消的逐包校验下载。
- `scripts/prepare-v1-resources.py`：从用户提供的 V1.0.zip 确定性生成资源、复现 ZIP、原始分包和 SHA-256 清单。开发细节见 `docs/v1-materials.md`。
- `api/analysis.py`、`python/engine.py`：临时工作目录中的固定分析模板。
- `serverless/chat-handler.mjs`：官方 API 转发、参数适配、错误脱敏。

源码中的旧 CLI / Harness 插件供独立开发使用，不是网站启动依赖。历史验证记录见 `docs/validation.md`，不得将旧版本结果当作当前版本验收。
