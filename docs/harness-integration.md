# DeepSeek Harness 集成

本项目将本地绘图工作台与真实的 DeepSeek Harness 插件连接。工作台负责导入表格、确认方案和运行固定 Python 模板；Harness 负责模型对话、工具调用、技能与会话记录。首版使用两个本地页面：工作台 `http://127.0.0.1:4318`，Harness 默认 `http://127.0.0.1:3080`。

## 启动

需要 Node.js `^22.18.0 || >=24.2.0`。固定的 Harness 入口使用 `import.meta.main`，Node.js 22.13 等旧版本不支持；启动器会在安装或启动前给出明确错误。

在项目根目录安装依赖并启动工作台后，另开终端：

```sh
npm run agent
```

启动器从项目的绝对路径读取 `.local/connection.json`，检查后端可访问，通过官方 `dsh plugin --profile web add file:<插件绝对路径>` 安装 bundle，再启动 `dsh --profile web`。插件源码变化时自动更新。它使用项目独立的 `DSH_HOME=.local/dsh`，不会改用户已有 `~/.dsh`。

Harness 启动后的浏览器入口含一次引导令牌。启动器将经过本机地址与端口校验的入口写入权限为 `0600` 的 `.local/harness.json`，供工作台的“打开本地 Harness”入口使用；不会返回给模型，进程退出时删除自己的入口记录。

在 Harness 页面中打开 Settings / 设置，使用其标准模型来源和凭据配置，填写你自己的 DeepSeek API key，选择可用模型。密钥由 Harness 的凭据机制保存到项目本地状态，不能写进代码、聊天或 Git。也可通过 Harness 标准设置接入兼容接口。仓库没有预置密钥，也没有借用其他项目密钥。

在工作台先载入示例或导入 CSV/XLSX；在 Harness 新建会话时选择 **生信搭子 C5**（默认预设），可以发送：

> 检查已导入的表达量表，比较各组的分布。先列出字段映射、缺失值和数据变换，给我生成一个待确认的箱线图方案。

模型创建方案后，回工作台查看并确认；再让智能体运行该方案。口头回复“同意”不会代替工作台按钮。使用云端模型时，工具返回的字段名和数据预览会发给该模型；本地计算不意味着模型上下文离线。

## 明确的接口边界

| 工具 | 本地 API | 行为 |
| --- | --- | --- |
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

集成采用标准 `dsh.bundle.patch`，通过 `@deepseek-ai/dsh-agent-preset` 声明独立 preset，使用官方 `defineTool` / `ctx.tools.register` 和 `ctx.skills.registerProvider`，没有修改 Harness 本体。

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
# 先启动工作台，再执行真实 Harness 安装、启动和会话挂载检查：
node packages/dsh-plugin-bioinfo/test/host-smoke.mjs
```

第一项直接将插件挂入官方 Cordis 和 Harness 工具注册表，并检查参数、端点和审批边界；第二项通过官方插件管理器与真实 Harness HTTP API 创建 C5 会话，不发送模型请求。

2026-10-26 本地验证：5 项插件测试与 1 项浏览器入口解析边界测试全部通过；官方 Harness 启动、插件安装启用和 C5 会话实际挂载均通过；`bio_list_datasets` 使用项目连接令牌访问真实 4318 后端成功。未配置模型 API key，因此没有执行真实 DeepSeek 对话或衡量模型选图准确率。
