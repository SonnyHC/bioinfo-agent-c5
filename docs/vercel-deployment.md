# Vercel 部署 bioinfobuddy

本说明对应 0.3.0“网站 + 本地助手”版本，目标域名为 `bioinfobuddy.com.cn`。部署人员发布网页与域名；使用者在自己的电脑启动本地助手。以下是交接步骤，不能作为线上部署已经完成的证明。

## 1. 导入 GitHub 仓库

将待发布版本推送到仓库后，在 Vercel 选择 Add New → Project → Import Git Repository。设置以仓库 `vercel.json` 为准：

- Root Directory：仓库根目录，不是 `web`。
- Framework：Vite。
- Build Command：`npm run build`。
- Output Directory：`dist/client`。
- Node.js：24.x。
- 保留的 Python 云表格接口使用 `.python-version` 中的 Python 3.12 与根目录 `requirements.txt`。
- 不设置站点共享模型 Key；访问者在网页中填写自己的 Key。

`companion/server.mjs` 是用户电脑上的常驻服务，**不作为 Vercel 函数启动**。网页通过本机 `127.0.0.1:4317` 与它通信。无需在 Vercel 启动 uv、renv 或完整 DeepSeek Harness。

仓库仍保留 `/api/chat` 与 `/api/analysis` 两个无状态接口，供旧云表格模式使用。它们的仓库配置为最长 120 秒，是否可用需用实际账户与部署日志验证；默认本地助手绘图不依赖 Vercel 执行 Python。

## 2. 验证预览地址与本地助手

1. 从待发布提交准备一份本地助手，执行 `npm ci --ignore-scripts` 和 `npm run setup:companion`。
2. 将实际预览地址加入助手允许列表后启动。例如 macOS / Linux：

   ```bash
   BIOINFO_COMPANION_ORIGINS="https://your-project.vercel.app" npm run companion
   ```

   Windows PowerShell：

   ```powershell
   $env:BIOINFO_COMPANION_ORIGINS = "https://your-project.vercel.app"
   npm run companion
   ```

   把示例域名替换为控制台给出的实际 origin，不包含路径。每个预览域名需明确配置；不会默认允许所有 `*.vercel.app` 网站。

3. 在该 HTTPS 网页进入工作台，输入本地助手配对码，并允许浏览器访问本机网络。
4. 安装基础绘图环境，导入仓库合成表格，检查字段、预览转换、确认运行；核对真实图表和下载产物。
5. 刷新网页，核对助手数据、运行历史与结果能恢复。重启助手后，验证旧凭据失效、重新配对后记录仍存在。
6. 安装并分别验收 FASTQ、H5AD 环境；使用合成文件检查参数限制与结果。R 任务需要本机 R、renv 环境和明确的脚本信任确认。
7. 配置一个支持工具调用的真实模型和有效 Key，完成自然语言 → 数据检查 → 待确认方案 → 本地运行 → 结果核对。测试替身或 UI 可点击不能替代这个步骤。
8. 用目标用户的浏览器与网络重复“HTTPS 网页连接本机助手”的流程；另一个浏览器没有自动获得配对凭据或聊天数据。

浏览器的本地网络访问权限会影响第 3 步，详见 [Chrome 官方说明](https://developer.chrome.com/blog/local-network-access)。仅验证 `localhost` 页面成功，不能推断正式 HTTPS 页面也能连接助手。

旧云表格模式如继续提供，也应单独验收：上传上限 2 MiB；原始文件会发送到站点 Python 接口；请求间不依赖服务器文件状态。它与本地助手的数据目录和能力范围不同。

## 3. 绑定域名

在 Vercel 项目 Settings → Domains 添加 `bioinfobuddy.com.cn`，按实际需求配置 `www` 及跳转方向。以 Vercel 控制台给出的当前 DNS 记录值为准，不照抄教程中的旧 IP 或 CNAME。[Vercel 官方说明](https://vercel.com/docs/domains/working-with-domains/add-a-domain)

按原教程使用 Cloudflare 时：

1. 添加已购买的域名，核对并保留仍在使用的邮件及其他业务记录。
2. 填写 Vercel 给出的 A / CNAME 记录，并选择 DNS only。
3. 在阿里云域名控制台将名称服务器改为 Cloudflare 为该域名实际分配的地址。
4. 等待 Cloudflare 激活，再确认 Vercel 域名有效、HTTPS 证书可用。
5. 使用正式域名重复配对、安装、导入、绘图、下载和真实模型验收。

也可以保留阿里云 DNS，直接填写 Vercel 要求的记录。根据已选路径操作，不同时混改两套权威解析。Cloudflare 的 DNS only 只提供解析，网页流量仍直接访问 Vercel；目标地区的可访问性需实测。[Cloudflare 官方说明](https://developers.cloudflare.com/dns/proxy-status/)

正式域名已列入本地助手默认允许来源；若正式使用另一个域名，需要用 `BIOINFO_COMPANION_ORIGINS` 添加精确 origin 并重启助手。

## 4. 发布助手和保留数据

当前助手是源码版，没有签名的 `.dmg` / `.exe`。发布网页时同时提供准确的仓库版本与 [助手使用说明](local-companion.md)，不能只给网页地址就声称所有用户可直接运行分析。日后制作安装包应独立验证安装、升级、卸载及平台兼容性。

浏览器存储按 origin 隔离：本地预览、Vercel 网址和正式域名分别保存聊天及设置，换域名后需重新配对。助手的文件在同一电脑、同一数据目录内保留，不随网页 origin 改变；不同设备不会自动同步。迁移前下载重要图表、分析记录和聊天 JSON。

## 5. 发布结果应记录

记录提交 SHA、Vercel 部署 URL、构建与函数结果、最终域名的 HTTPS 状态、测试浏览器与系统，以及真实模型和本地助手的端到端结果。当前已执行和待验证事项见 [验证记录](validation.md)。
