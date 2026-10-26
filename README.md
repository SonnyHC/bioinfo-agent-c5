# bioinfobuddy

面向大学生和科研人员的 AI 辅助绘图工具，采用 **网站 + 本地助手**：在网页里选择图例、设置参数和查看结果，由用户电脑上的助手保存文件、安装分析环境并执行绘图。

沿用 Harness 的工具调用流程：检查真实数据 → 提出数据转换与绘图方案 → 用户确认 → 本地执行 → 核对结果。默认入口不启动完整 DeepSeek Harness。

## 当前功能

| 输入 | 可执行的任务 | 范围 |
| --- | --- | --- |
| CSV / TSV / XLSX | 箱线图、小提琴图、散点图、直方图、均值柱状图、热图 | 明确字段映射、宽长表转换及缺失值处理；XLSX 读取第一张工作表 |
| FASTQ / FQ / FASTQ.GZ / FQ.GZ | read 长度分布、每条 read 的平均 Phred+33 质量分布 | 按顺序读取前 N 条；不执行比对、表达定量或完整测序质控 |
| H5AD | 已有嵌入的前两维散点图，按细胞注释分类着色 | 不重新计算 UMAP、不归一化、不聚类；当前不提供连续变量着色 |
| R 脚本 | 运行用户导入并明确信任的脚本，可附加表格文件 | `.r` 是可执行代码；使用独立 renv 包环境，按当前用户权限运行 |

所有主要功能使用 AI 对话界面的主侧边栏：**数据与绘图、数据分析技能、分析环境、运行记录、本地助手**。技能入口安装或启用仓库内置能力，环境入口单独准备相应的 Python / R 依赖，并显示安装状态、日志和失败原因。技能已安装不代表环境已就绪。“参考基因组”仅预留不可用的侧边栏入口，尚无内容或下载功能。

图表结果可直接进入“调整参数”，加载该图的实际数据、模板与参数。内置 Python 模板支持标题、轴标签、配色、字号、透明度、图幅和导出分辨率；有样本点的图例另提供点大小。修改后重新预览、确认并在本机生成，自动保存为新版本，保留原始数据和旧图，并记录来源结果及参数变化。下载按钮对应当前显示版本的实际产物。自有 R 脚本没有通用外观参数，仍需单独确认信任。

AI 通过受限工具提出已有模板支持的字段映射和参数，不生成任意代码后直接执行，也不会自动安装未知第三方技能。内置 Python 模板将转换数据和图表写入新的结果目录；用户 R 脚本仍需自行遵守不修改原始文件的约定。

支持配置 DeepSeek、OpenAI 或通义千问的 API Key 与模型名称；选择模型时需使用对应供应商实际提供且支持工具调用的模型。真实供应商可用性仍需使用有效 Key 验证。

## 启动

本地助手当前以源码运行，尚未提供签名的 macOS / Windows 安装包。先安装 Node.js 22.18+（22.x）或 24.2+，以及 [uv](https://docs.astral.sh/uv/getting-started/installation/)。使用 R 技能还需要本机安装 R。

在仓库根目录运行：

```bash
npm ci --ignore-scripts
npm run setup:companion
npm run companion
```

保持终端运行，在主侧边栏的“本地助手”输入终端显示的配对码。连接后，在“数据分析技能”安装所需内置技能，在“分析环境”一键安装对应环境。Python 技能由 uv 创建各自的 Python 3.12 环境并安装固定依赖；首次环境安装需要联网。

本机同时预览网页时，另开终端运行：

```bash
npm run dev
```

打开 <http://127.0.0.1:5173>。默认网页预览不需要项目级 Python 环境。生产静态预览使用 `npm run build` 后运行 `npm start`。`setup:companion` 检查本机工具并提示缺失项，不代替网页中的技能环境安装。

完整步骤、R 模板约定及排错见 [本地助手使用说明](docs/local-companion.md)。

## 文件与模型请求去向

| 内容 | 保存或处理位置 |
| --- | --- |
| 本地助手的导入文件、方案、图表、运行记录 | 用户目录下的 `.bioinfobuddy/`，可用 `BIOINFO_COMPANION_HOME` 更改 |
| 各技能的 Python / R 环境 | 助手数据目录的 `environments/` |
| 内置技能启用记录 | 助手数据目录的 `skills/`；与环境就绪状态分开保存 |
| 聊天记录 | 当前网站、当前浏览器的 IndexedDB |
| 模型设置 | 当前浏览器存储 |
| API Key | 默认当前标签会话保存；用户选择记住后保存在此浏览器 |
| 本地助手配对凭据 | 当前标签会话保存；助手重启后需重新配对 |
| 本地模式模型请求 | 本地助手转发至所选供应商的固定官方 API 地址 |

本地助手模式中，原始分析文件发往本机 `127.0.0.1:4317`。调用 AI 时，对话、工具返回的数据概要与少量预览会发送给所选模型供应商；“本地计算”不代表模型调用离线。导出的结果文件应另行备份，清除浏览器数据不会删除助手数据目录。

主要入口为 `/`。例如 `/?view=skills` 打开数据分析技能，`/?view=environments` 打开分析环境，`/?view=analysis&run=…` 恢复图表结果。旧 `/workbench?plan=…`、`/workbench?run=…` 自动转入同一个主界面；聊天 `/?dataset=…` 上下文继续可用。独立“本地工作台”页面已移除。

旧版云表格模式仅在显式地址 `/workbench/cloud` 保留，不作为新版主界面的替代入口。它将 CSV / TSV / XLSX 存入浏览器，并发往本站临时 Python 接口处理，限制为 2 MiB；它不具备 FASTQ、H5AD 和 R 本地执行能力。本机使用旧云接口前运行 `npm run setup:python`，再用 `npm run dev:cloud` 或构建后的 `npm run start:cloud` 启动。两种模式的文件与记录不会自动互相迁移。

## 部署交接

[Vercel 部署说明](docs/vercel-deployment.md)包含仓库导入、预览地址验收和 `bioinfobuddy.com.cn` 域名配置。网站可以部署到 Vercel；每位访问者仍需在自己的电脑启动本地助手。助手不部署到 Vercel，也不需要为每位用户采购常驻计算服务器。

本地构建、测试或 Git 推送完成均不代表线上已部署。本次工作不包含 Vercel 发布、DNS 修改、HTTPS 或真实模型端到端验收，具体结果见 [验证记录](docs/validation.md)。

## 开发与验证

Python 与助手集成测试需要可用的测试解释器。先用 `npm run setup:python` 准备项目 `.venv`，再运行：

```bash
npm run typecheck
npm run test:cloud
npm run test:companion
npm run test:python
npm run build
```

`npm run test:python` 默认使用 `.venv`，可通过 `BIOINFO_PYTHON` 指定已安装全部测试依赖的解释器；未安装 AnnData 时 H5AD 测试会显示跳过，需要另用单细胞环境补跑。助手 HTTP 测试的解释器可用 `COMPANION_TEST_PYTHON` 指定。

- `companion/`：本地服务、技能目录、环境依赖和 R 运行器。
- `python/companion_worker.py`：本地检查、转换和绘图；基础表格复用 `python/engine.py`。
- `web/src/companion.ts`：网页与助手的配对、请求和任务状态。
- `web/src/Chat.tsx`、`agent-loop.ts`、`agent-tools.ts`：模型配置、对话与工具循环。
- `web/src/AnalysisPanel.tsx`、`navigation.ts`：主界面内的数据、技能、环境、结果编辑与历史入口，以及旧链接兼容。
- `api/`、`serverless/`：保留的无状态模型转发和云表格接口。

`src/` 与 `packages/dsh-plugin-bioinfo/` 保留旧本机服务和官方 Harness 插件；`npm run dev:legacy` / `npm run agent` 是旧模式的显式命令，不参与新版默认运行。参见 [Harness 集成](docs/harness-integration.md)、[比赛要求及首版范围](docs/competition-and-scope.md)和 [第三方许可](THIRD_PARTY_NOTICES.md)。
