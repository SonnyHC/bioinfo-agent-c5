# dsh-plugin-bioinfo

C5 生信搭子的独立 DeepSeek Harness bundle，固定适配 `@deepseek-ai/dsh@0.2.1-rc.2`。通过官方 `defineTool`、`ctx.tools.register`、`ctx.skills.registerProvider` 注册五个工具和一个内置技能；由独立 `bioinfo-c5` preset 使用。

建议从仓库根目录执行 `npm run agent`，由启动器将 bundle 安装到项目 `.local/dsh`，不改个人默认 Harness 配置。后端须先启动。

详见 [集成说明](../../docs/harness-integration.md)。本包没有 shell、任意 Python 执行或方案审批工具。
