# 图研 · BioWorkbench

面向郑州大学 C5 项目的本地科研数据适配与绘图 Agent 原型。

用 CSV / Excel 数据完成 **查看原表 → 配置图表 → 预览转换 → 确认 → 本地绘图 → 导出复现包**。
官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 负责自然语言交互和专用工具调用；固定 Python 模板负责数据转换与绘图。

## 当前能力

- 导入 CSV、TSV、XLSX，查看数据类型、缺失值、原始预览和 SHA-256。
- 箱线图、小提琴图、散点图、直方图、均值柱状图和热图。
- 指定宽表数据列并预览转成长表；长表手动选择分组、数值字段。
- 缺失值默认阻止执行，只有明确选择后才能删除相关行；不自动填补、归一化或剔除异常值。
- 批准后才可运行方案。Agent 可以检查数据和提出方案，不能批准自己的方案。
- 导出 PNG / SVG / PDF、处理后 CSV、可独立运行的 Python 绘图脚本、参数与运行记录。
- 内置三份合成数据，未配置模型密钥也可验证完整本地绘图流程。

这是一版可验证的原型。尚未实现 FASTQ 处理、H5AD / 单细胞分析、差异分析、富集分析、自动统计检验、桌面安装包或远程多人服务。支持的是固定绘图流程，不把一次运行解释为方法或科学结论已经验证。

## 启动

需要 Node.js 22.18+（22 系列）或 24.2+，以及 Python 3.11–3.13。初次安装需要联网。

```bash
npm ci --ignore-scripts
npm run setup:python
npm run build
npm start
```

打开 <http://127.0.0.1:4318>，点击「宽表样例」，选择箱线图，配置 `Control`、`Treatment` 等实际列名，预览并确认，再生成图片和复现包。样例均为合成数据，不代表真实实验。

若系统默认 Python 不在支持范围，先用合适版本创建虚拟环境：

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r python/requirements.txt
```

Windows 使用 `.venv\Scripts\python.exe`。安装脚本可用 `BIOINFO_SETUP_PYTHON` 指定创建虚拟环境的基础解释器。运行服务时默认使用项目 `.venv`；只有需要自行维护其他已装好依赖的环境时，才设置 `BIOINFO_PYTHON` 为那个环境的解释器绝对路径。

## 连接 DeepSeek Harness

保持工作台运行，在另一个终端执行：

```bash
npm run agent
```

启动器使用官方 `@deepseek-ai/dsh@0.2.1-rc.2`，安装本仓库的 C5 插件到独立 `.local/dsh/`。在 Harness 自带设置页配置自己的模型与 API key，在 C5 预设中开始对话。详细步骤见 [Harness 集成](docs/harness-integration.md)。

建议首先上传合成样例，再输入：

> 列出工作台里的数据。检查合成宽表，为 Control 和 Treatment 制定箱线图方案，保留每个观测值，缺失值先报错。不要执行，等我在工作台确认。

返回工作台刷新「Agent 方案」，检查并确认后即可运行。配置模型后，数据概要、工具返回的少量预览行和用户输入会发送给该模型服务商。仅本地模板绘图不需要模型请求；连接模型前请使用已脱敏、获准处理的数据。API key 不进入前端代码、Git 或复现包。

## 开发与测试

```bash
npm run dev       # 后端 4318
npm run dev:web   # 前端 5173，代理本地 API
npm run typecheck
npm run test:python
npm test
npm run test:plugin
npm run test:harness  # 需要先启动 4318 后端；不请求模型
npm run build
```

`src/` 是本地 HTTP 服务，`python/` 是确定性分析引擎，`web/` 是 React 工作台，`packages/dsh-plugin-bioinfo/` 是独立 Harness bundle。数据、方案、历史、模型设置均放在被 Git 忽略的 `.local/`，原始数据保留，所有转换写入新的结果目录。

上传限制为 10 MiB、50,000 行和 100 列。XLSX 仅读取第一张工作表并拒绝公式单元格。热图等还有用于保持可读性的尺寸限制，超出时会明确提示。服务固定监听 `127.0.0.1`，不提供云部署或公网访问配置。

## 比赛与来源

报名截止 **2026 年 11 月 4 日**，由学院统一报送。C5 方向匹配与人数差异见 [比赛要求及首版范围](docs/competition-and-scope.md)；以学校后续要求为准。

参考 [BioDSH desktop-tauri-v1.0.0-preview.1](https://github.com/sagirimo/BioDSH/releases/tag/desktop-tauri-v1.0.0-preview.1) 的 Harness 插件化思路。第一版独立实现自己的界面和固定数据工具，不复制其品牌、安装包或完整第三方技能库。上游及许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目暂为私有开发仓库，尚未对自有代码指定开源许可证。
