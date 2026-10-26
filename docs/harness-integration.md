# DeepSeek Harness 集成

本项目使用官方 DeepSeek Harness 作为主界面，提供对话、模型选择、工作区、会话记录和工具调用。数据与绘图工作台负责导入表格、查看方案、运行图表及下载结果。

- 主入口：`http://127.0.0.1:4318`，自动启动并进入 Harness。
- 数据与绘图：`http://127.0.0.1:4318/workbench`，也可以从 Harness 左下角的“数据与绘图”打开。
- 指定方案或结果：`/workbench?plan=<方案ID>&run=<结果ID>`。绘图工具会返回对应的 `workbenchUrl`。

## 启动

需要 Node.js `^22.18.0 || >=24.2.0`。固定的 Harness 入口使用 `import.meta.main`，Node.js 22.13 等旧版本不支持；启动器会在安装或启动前给出明确错误。

在项目根目录安装依赖并构建后：

```sh
npm start
```

后端成功监听后发布 `.local/connection.json` 并启动 Harness。启动器检查后端可访问，通过官方 `dsh plugin --profile web add link:<插件绝对路径>` 安装 bundle，再启动 `dsh --profile web`。本地开发采用 `link:`，新增源文件也会进入插件；启动器会自动迁移早期的 `file:` 快照并检查链接目标。它使用项目独立的 `DSH_HOME=.local/dsh`，不会改用户已有 `~/.dsh`。

统一启动默认让系统分配一个本机端口；`BIOINFO_DSH_PORT` 可指定端口。启动过程会显示简短加载页，准备好后自动进入对话；日志写入 `.local/harness-runtime.log`，关闭服务会结束其 Harness 子进程。高级调试仍可在后端运行时使用 `npm run agent -- --no-open` 独立启动，默认端口为 3080；日常使用无需另开终端。

Harness 启动后的浏览器入口含一次引导令牌。启动器将经过本机地址与端口校验的入口写入权限为 `0600` 的 `.local/harness.json`，供主入口与工作台的对话入口使用；进程退出时删除自己的入口记录。

首次打开会直接显示官方 API Key 配置框。填写 DeepSeek API Key 后点击“保存并继续”；已有可用模型配置时进入对话页面。后续可在“设置 → 模型”修改来源、模型或兼容接口。密钥通过官方 `credentials/set` 写入项目 `.local/dsh` 的凭据存储，前端只读取配置状态。

启动器生成的展示层 overlay 指定 `bioinfo-c5` 默认预设、开启 `ui-settings-models.credentialOnboarding`，并停用 `ui-settings-account` 的账号登录选择页，因此首次直接显示 API Key 编辑器。`ui-settings-general.welcomeNoticeVersion` 在运行时组合层设为该固定版本的说明版本，省略预览版公告；这不会写入用户设置或模型配置文件。官方模型设置、凭据存储与工具权限机制保持原样。

在工作台先载入示例或导入 CSV/XLSX；在 Harness 新建会话时选择 **bioinfobuddy**（默认预设），可以发送：

> 检查已导入的表达量表，比较各组的分布。先列出字段映射、缺失值和数据变换，给我生成一个待确认的箱线图方案。

模型创建方案后，回工作台查看并确认；再让智能体运行该方案。口头回复“同意”不会代替工作台按钮。使用云端模型时，工具返回的字段名和数据预览会发给该模型；本地计算不意味着模型上下文离线。

## 明确的接口边界

| 工具 | 本地 API | 行为 |
| --- | --- | --- |
| `bio_open_workbench` | 无 | 返回数据、方案或结果页面链接 |
| `bio_list_datasets` | `GET /api/datasets` | 查看用户已导入数据集 |
| `bio_inspect_dataset` | `GET /api/datasets/:id` | 检查真实字段和小范围预览 |
| `bio_preview_plan` | `POST /api/plans` | 创建待确认方案 |
| `bio_run_approved_plan` | `POST /api/plans/:id/run` | 仅运行工作台已确认的方案 |
| `bio_get_run` | `GET /api/runs/:id` | 查看实际结果与失败信息 |

插件只能连接 `127.0.0.1`，发送 `X-Bioinfo-Token`。端点固定，拒绝重定向；ID 经过校验；模型不能提交代码、路径、审批标志或其他额外字段。令牌仅通过进程环境传给工具，不加入模型提示词。C5 预设没有 shell、任意 Python、文件写入、插件安装或方案审批工具。Harness 的其他预设属于独立功能；切换到 Standard / Creator 会改变工具权限，不属于 C5 的受限绘图流程。

内置 `reviewed-bio-plot` 技能要求检查数据、明确字段与单位、解释长宽转换、处理缺失值、等待工作台确认及核对实际输出。首版未提供自动差异表达、单细胞分析或统计显著性检验。

## 版本与来源

- 官方 Harness：[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)，MIT，使用 npm 包 `@deepseek-ai/dsh@0.2.1-rc.2`。
- [官方开发文档](https://deepseek-harness.github.io/deepseek-harness/)；官方发布说明明确当前仍为开发预览，存在不兼容变更，所以首版固定版本。
- 设计参考 [BioDSH 1.0.0 Preview 1](https://github.com/sagirimo/BioDSH/releases/tag/desktop-tauri-v1.0.0-preview.1)，该 release 使用相同 Harness 版本。BioDSH 自有代码采用 MIT；它附带的社区 skills 和 Python 包分别保留各自许可。本项目未复制其技能库、品牌或桌面界面。

集成采用标准 `dsh.bundle.patch`，通过 `@deepseek-ai/dsh-agent-preset` 声明独立 preset，使用官方 `defineTool` / `ctx.tools.register` 和 `ctx.skills.registerProvider`。浏览器模块通过官方 `sidebar.footer.action` 插槽添加“数据与绘图”入口，公开地址通过 `webserver/index-inject` 传入。`conversation.hero.brand.mark` 插槽显示“开始生信分析”；该固定版本没有独立标题插槽，因此以本插件标记为锚点的 CSS 隐藏相邻默认标题和预览角标。没有修改 Harness 本体。

## 排障

- `缺少官方 Harness`：运行 `npm install`。
- `pnpm was not found`：确认项目依赖已装全；启动器会把项目 `node_modules/.bin` 加入 PATH。
- `尚无 .local/connection.json` 或令牌过期：先启动或重启本地工作台，再启动智能体。
- 端口 3080 被占用：用 `BIOINFO_DSH_PORT=3081 npm run agent`。
- 更新插件：`npm run agent -- --reinstall`。
- 无浏览器自动打开：`npm run agent -- --no-open`，使用终端输出的带会话令牌地址。
- 查看组合配置：`npm run agent -- --dump-config`；不要公开 `.local` 下的日志和凭据文件。

“插件已安装、工具已注册”与“真实 DeepSeek 请求已成功”是不同验证层级。没有用户配置的 API key 时，只能验证前者与本地数据流程；不能宣称模型效果或生信结论已经验证。

开发验证命令：

```sh
node --test packages/dsh-plugin-bioinfo/test/plugin.test.mjs
node --test packages/dsh-plugin-bioinfo/test/bootstrap.test.mjs
node --test packages/dsh-plugin-bioinfo/test/presentation.test.mjs
# 使用独立临时 Harness home 验证首进设置与凭据保存、重启：
node packages/dsh-plugin-bioinfo/test/onboarding-smoke.mjs
# 先启动工作台，再执行真实 Harness 安装、启动和会话挂载检查：
node packages/dsh-plugin-bioinfo/test/host-smoke.mjs
```

插件测试将工具挂入官方 Cordis 和 Harness 注册表，检查参数、链接、端点及审批边界。展示测试检查官方插槽注册与公开地址注入。`onboarding-smoke` 使用临时目录和生成的测试凭据，验证官方配置状态及重启后存储不变；它不使用用户的模型凭据，也不请求模型。`host-smoke` 通过官方插件管理器与真实 Harness HTTP API 创建 C5 会话。

2026-10-26 本地验证：10 项插件与展示测试通过，覆盖插件安装期间停止后不写成功标记、不继续启动 Harness 的生命周期。独立临时 Harness 的旧快照迁移、首进配置、官方凭据保存与重启恢复检查通过，重启前后测试凭据文件 SHA256 一致。此前已验证官方 Harness 启动、插件安装启用、C5 会话实际挂载和 `bio_list_datasets` 访问真实 4318 后端。真实 DeepSeek 对话需要用户配置有效 API Key 后验证。
