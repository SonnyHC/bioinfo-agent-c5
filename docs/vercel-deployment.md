# Vercel 部署 bioinfobuddy

本说明对应 0.2.0 浏览器存储版本，目标域名为 `bioinfobuddy.com.cn`。这是部署步骤；本地构建通过不等于线上已发布。

## 1. 导入 GitHub 仓库

将当前修改推送到仓库后，在 Vercel 选择 Add New → Project → Import Git Repository。

- Root Directory：仓库根目录（不要填写 web）。
- Framework：Vite。
- Build Command：`npm run build`。
- Output Directory：`dist/client`。
- Node.js：24.x。
- Python：仓库 `.python-version` 指定 3.12；根 `requirements.txt` 引用固定 Python 依赖。
- 不配置站点共享 DeepSeek Key。每位访问者在网页中使用自己的 Key。

`vercel.json` 中 `/api/chat` 为 Node 函数，`/api/analysis` 为 Python 函数，最长执行时间均为 120 秒；首页及 `/workbench` 为静态网页。仓库里遗留的本机 Harness 启动器不在部署入口中。

## 2. 先验证预览地址

在生成的 `*.vercel.app` 地址中验证：

1. 第一次打开提示配置 API Key，也能先试用绘图。
2. 导入合成宽表，检查字段并生成方案。
3. 确认方案后生成图表，下载 PNG/SVG/PDF 和 ZIP。
4. 刷新，检查数据、方案和图表仍能恢复。
5. 配置有效 Key 后，在对话中要求检查已导入数据并创建方案，核对真实工具调用。
6. 用另一浏览器验证数据互不共享。

上传文件上限为 2 MiB，JSON/base64 编码后仍需低于 Vercel 请求限制。Python 只在 `/tmp` 的请求临时目录中处理文件；返回 ZIP 最大 4 MiB。每次请求自带所需数据，不依赖上一实例或上一请求。

## 3. 绑定域名

在该项目 Settings → Domains 添加 `bioinfobuddy.com.cn`。只有需要 `www` 时再添加 `www.bioinfobuddy.com.cn`，并设置明确的跳转方向。

**使用 Vercel 当前控制台返回的记录值，不照抄教程截图中的旧 IP 或 CNAME。**

按用户提供教程使用 Cloudflare 时：

1. 在 Cloudflare 添加已购买的域名，核对已有 DNS 记录，保留仍在使用的邮件及其他业务记录。
2. 将 Vercel 给出的 A/CNAME 记录填入 Cloudflare；教程选择的是 DNS only。
3. 在阿里云域名控制台，将名称服务器改为 Cloudflare 为此域名实际分配的两个地址。
4. 等待 Cloudflare 显示 Active，再回 Vercel 确认域名配置有效、HTTPS 证书签发成功。
5. 通过最终域名重复上传、绘图、对话、下载验证。

Cloudflare DNS only 只负责解析，HTTP/HTTPS 流量直接去 Vercel，不提供 Cloudflare 转发加速。因此不能仅凭绑定完成就保证所有中国大陆网络都可访问；要用目标使用者的网络实测。

也可以继续用阿里云 DNS，直接填写 Vercel 要求的记录，无需迁移名称服务器。最终以确定采用的教程路径和账户实际配置为准。

## 4. 本地保存的范围

浏览器存储按 origin 隔离。`localhost`、预览网址和 `bioinfobuddy.com.cn` 各有自己的数据空间，迁移域名不会自动迁移浏览器数据。请在最终域名使用前下载需要保留的图表/复现包及聊天 JSON。无服务器端用户数据库或跨设备同步。

## 参考

- [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Vercel custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/)
