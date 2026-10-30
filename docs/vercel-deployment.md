# 部署网站与 API

使用仓库根目录，构建命令 `npm run build`，输出 `dist/client`。Vercel 同时部署 `api/chat.js` 与 `api/analysis.py`；Python 依赖在根目录 `requirements.txt`，无需启动客户端、配对进程或常驻本机服务。

不配置共享模型 Key，访问者在网页填写自己的国内模型 API Key。本站代码不记录或持久保存密钥；部署方也应避免启用包含请求正文的日志。模型请求通过站点转发，因此站点运行区域必须能访问配置中的官方接口。

`vercel.json` 为两个接口配置 120 秒上限。账户实际限制以控制台为准；非流式模型请求内部超时 110 秒。深度思考模型可能超时，可换用配置中支持非思考的预设。

`/` 是主界面，`/?view=analysis` 是数据与绘图，`/?view=skills` 是数据分析技能商店，`/?view=history` 是运行记录，`/?view=genomes` 是参考基因组。旧 `/workbench` 和 `/workbench/cloud` 链接转入统一绘图页面。已移除的环境、连接路由回到对话首页。技能商店使用浏览器存储，不需要本机助手。

## 上线验收

1. 构建和类型检查通过，确认 `/api/chat` 与 `/api/analysis` 均已部署。
2. 未配置模型时打开首页、教程和参考基因组，无安装或配对要求。
3. 用有效 Key 验证国内模型的普通回答和完整工具轮次；供应商权限、余额、限流和不同地域需实际验证。
4. 用合成 CSV / XLSX 导入，预览、勾选确认并生成图表；下载复现包、刷新历史、重新修改参数。确认表格上传提示可见。
5. 检查窄屏导航、API 配置及数据与绘图；换浏览器后不会自动获得旧密钥、文件或记录。

表格接口限制 2 MB，使用请求独立的临时目录处理，返回图表后清理；文件和结果保存在浏览器。本站不提供 FASTQ、H5AD 或 R 执行服务。

## 域名

在 Vercel 项目 Settings → Domains 添加 `bioinfobuddy.com.cn`，按控制台显示的当前记录配置 DNS，并核对 HTTPS。具体步骤见 [Vercel 官方域名说明](https://vercel.com/docs/domains/working-with-domains/add-a-domain)。本地构建通过不代表已经发布或域名已生效。
