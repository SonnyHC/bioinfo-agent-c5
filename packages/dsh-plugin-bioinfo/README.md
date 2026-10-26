# bioinfobuddy · Harness 插件

bioinfobuddy 的独立 DeepSeek Harness bundle，固定适配 `@deepseek-ai/dsh@0.2.1-rc.2`。通过官方 `defineTool`、`ctx.tools.register`、`ctx.skills.registerProvider` 注册六个工具和一个内置技能。浏览器模块显示 bioinfobuddy 品牌，在官方侧栏添加“数据与绘图”入口，并同步页面标题。

预设的内部 ID `bioinfo-c5` 与插件包名 `dsh-plugin-bioinfo` 保持不变，已有会话可继续使用。

建议从仓库根目录执行 `npm run agent`，由启动器将 bundle 安装到项目 `.local/dsh`，不改个人默认 Harness 配置。后端须先启动。

详见 [集成说明](../../docs/harness-integration.md)。本包没有 shell、任意 Python 执行或方案审批工具。
