# bioinfobuddy

面向大学生和科研人员的生信对话与案例学习工具。桌面客户端内置工作台、教程与案例资源，可在本机导入表格。网页版从首页进入工作台。两端均可配置国内模型 API 进行对话。

## 桌面安装包

本仓库维护 Agent、桌面客户端和安装包。构建机使用 Apple Silicon Mac、Node.js 22.18+（22.x）或 24.2+、Python 3.9+，并可调用系统的 `codesign` 和 `hdiutil`。Windows 安装器采用 NSIS 3.13。macOS 26 上脚本会自动获取该版本，其他构建主机需先安装 NSIS 3.13。首次构建会下载 Electron 45.3.3 并核对 SHA-256。

```bash
npm ci --ignore-scripts
npm run test:desktop
npm run build:desktop-web
npm run package:desktop
```

`release/` 下的 `BioInfoBuddy-<版本>-macOS-arm64.dmg` 适用于 macOS 13 及以上 Apple Silicon，可将应用拖入 Applications。`BioInfoBuddy-<版本>-Windows-x64-Setup.exe` 适用于 64 位 Windows 10 及以上，安装在当前用户目录，并加入开始菜单与系统卸载列表。打包命令会输出两份文件的 SHA-256。独立官网仓库负责发布页面与下载，在官网仓库内运行 `npm run stage:release -- "<本仓库的绝对路径>/release"` 即可登记两个文件的版本、大小和校验值。

## 功能

- **粒子启动页**：首页采用雾白、墨蓝与靛蓝配色，DNA 双螺旋与蛋白质折叠全程由蓝紫—青蓝渐变粒子构成，静止时也保留清晰的点云质感。两种造型分别适配显示空间，自动轮播时粒子散开重组，也可用鼠标左键点击或 Enter / 空格键切换；支持深浅主题、暂停、视角与指针交互设置，遵循系统减少动态效果设置。点击“开始探索”进入工作台；工作台直达地址为 `/?view=chat`。粒子运行时来源及许可见 [第三方说明](THIRD_PARTY_NOTICES.md)。
- **AI 对话**：DeepSeek、通义千问、智谱 GLM、Kimi、豆包、MiniMax、百度文心。密钥按提供商独立保存，模型配置和官方文档见 [模型 API](docs/model-api.md)。
- **数据导入**：在 AI 对话导入 CSV / TSV / XLSX（最大 2 MB，Excel 读取第一张工作表），或选择 V1.0 附件中的 PBMC marker 汇总表、GBM1 空间点位表检查字段。
- **数据分析技能**：网页技能库提供搜索、分类、流程详情和“我的技能”。可添加、停用、移除及下载内置技能；AI 按需加载已启用的流程，或从技能页直接开始对话。添加记录保存在当前浏览器，不安装本机环境。
- **历史结果**：运行记录只读保留此前生成的结果、状态与已有文件下载；不再提供网页生成新图、方案审批或重新绘图。AI 可协助准备外部 R / Python 分析代码。
- **参考基因组**：301 个版本，可搜索物种、组装版本、登录号并访问原始下载站点；逐条来源与移除原因见 `docs/reference-genomes-audit.json`。
- **案例与图表**：PBMC2700 单细胞四图与 GBM1 空间转录组九图，提供解读、参数、配色、R / Python / Quarto 代码和跨平台环境指南下载。四篇专题按原始 Markdown 合并、拆分，采用文档阅读布局；内容来源与生成方式见 [教程说明](docs/tutorial-reading.md)。技能库提供五项组学方法指导。
- **完整资料下载**：全部 44 个 V1.0 原文件原样保留。约 280 MB 原 ZIP 分为七份，网页可逐份校验并合并下载；另提供约 7.6 MB 的单细胞复现包、43 MB 的空间复现包，以及教程与原文包。落位与验证说明见 [V1.0 资料接入](docs/v1-materials.md)。

已删除原有本机助手服务、配对与环境安装入口；数据分析技能以纯网页流程库重新提供。不再支持 FASTQ、H5AD 和本机 R 脚本执行。用户已有文件目录不会被程序删除或迁移。没有实现差异分析、富集分析或重新计算 UMAP，也未开放第三方技能安装。

组学案例中的结果来自用户提供的附件；下载代码需由用户在外部环境运行，网站不执行 Seurat / Scanpy。当前资料接入不表示已重新计算案例或完成 macOS / Windows 全流程复现。

## 启动网站

需要 Node.js 22.18+（22.x）或 24.2+。

```bash
npm ci --ignore-scripts
npm run dev
```

打开 `http://127.0.0.1:5173`。命令同时启动网页与 `/api/chat` 转发服务，不需要 Python 即可使用 AI 对话和参考基因组。

开发者需要表格导入与字段检查时，在网站服务端安装 Python 3.11–3.13，然后运行：

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

请及时下载重要结果；清除网站存储会删除浏览器中的文件与记录。网页仅使用分析接口检查表格，不执行模型生成的代码。

## 开发与验证

```bash
npm run typecheck
npm run build
npm run test:cloud
npm run test:particles
npm run test:python
```

- `config/model-providers.json`：前后端共用的国内模型配置及官方文档来源。
- `web/src/Chat.tsx`：对话、模型设置、统一导航。
- `web/src/RunHistory.tsx`：只读历史运行记录与结果下载。
- `web/src/agent-tools.ts`：读取真实数据与历史结果的受限工具。
- `web/src/skill-catalog.ts`、`skill-library.ts`、`SkillStore.tsx`：内置技能目录、浏览器添加记录与技能商店。新增技能需声明输入、输出、流程和限制，使用已存在的网站工具。
- `web/src/OmicsResources.tsx`、`OmicsGuides.tsx`、`omics-content.ts`：案例、图文教程及下载入口；`resource-download.ts` 负责可取消的逐包校验下载。
- `scripts/prepare-v1-resources.py`：从用户提供的 V1.0.zip 确定性生成资源、复现 ZIP、原始分包和 SHA-256 清单。开发细节见 `docs/v1-materials.md`。
- `api/analysis.py`、`python/engine.py`：临时工作目录中的固定分析模板。
- `serverless/chat-handler.mjs`：官方 API 转发、参数适配、错误脱敏。

源码中的旧 CLI / Harness 插件供独立开发使用，不是网站启动依赖。历史验证记录见 `docs/validation.md`，不得将旧版本结果当作当前版本验收。
