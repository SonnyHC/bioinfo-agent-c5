# 国内模型 API 配置

核对日期：2026-10-30。前后端共用 `config/model-providers.json`，不支持 OpenAI 提供商或任意自定义 API 域名。下面各家“兼容 OpenAI”指请求协议，不代表接入 OpenAI 服务。

| 提供商 | 默认模型 | 官方依据 |
| --- | --- | --- |
| DeepSeek | `deepseek-flash` | [首次调用](https://api-docs.deepseek.com/)、[Chat API](https://api-docs.deepseek.com/api/create-chat-completion/) |
| 通义千问（北京） | `qwen-plus` | [兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[北京接入域名](https://help.aliyun.com/zh/model-studio/beijing-access-information) |
| 智谱 GLM | `glm-5.3` | [标准 API](https://docs.bigmodel.cn/cn/api/introduction)、[思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode) |
| Kimi | `kimi-k3.1-pro` | [Chat API](https://platform.kimi.com/docs/api/chat)、[模型列表](https://platform.kimi.com/docs/models) |
| 豆包 | `doubao-seed-2-1-lite-260915` | [Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh)、[模型列表](https://docs.volcengine.com/docs/82379/1330310?lang=en) |
| MiniMax | `MiniMax-M3.1-Flash` | [兼容接口](https://platform.minimax.cn/docs/api-reference/text-openai-api) |
| 百度文心 | `ernie-4.5-turbo-128k` | [文本生成](https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb)、[模型列表](https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y) |

## 接入规则

使用标准按量付费 API Key，不将 Coding Plan 专属密钥混用。前端提供各家控制台和 API 文档链接；预设模型可直接选择，也可手动填写同一平台的模型 ID。模型是否对账户开放、余额及限流以供应商控制台为准。

七家接口均使用 JSON POST 和 `Authorization: Bearer`。站点拒绝未知提供商，禁止跟随上游重定向；供应商错误正文不回传或记录，避免错误中回显密钥。

- DeepSeek：旧浏览器设置 `deepseek-chat` / `deepseek-reasoner` 迁移为 `deepseek-flash`。预设发送 `thinking.type=disabled`，不设置采样参数。
- 千问：北京地域密钥。业务空间 ID 填写后，固定拼入 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`；只允许单个 DNS 标签。留空使用官方仍支持的 DashScope 域名。预设关闭思考。
- GLM：5.3 强制思考，不发送关闭参数；5.2 预设可以关闭思考。标准 API 与编码套餐端点不同。
- Kimi：保留同一提供商、同一模型返回的 `reasoning_content`，供后续工具轮次使用；不预设已下线的 K2.5 或 moonshot-v1。
- 豆包：使用北京方舟接口，允许官方模型 ID 或用户已有的 `ep-` 接入点。列出的 Seed 2.1 预设关闭思考；自定义接入点不强加该参数。
- MiniMax：中国站 `api.minimax.cn`；使用 `max_completion_tokens` 和 `reasoning_split=true`。M3.1 Flash 强制思考，预设 `reasoning_effort=low`；M3 预设关闭思考。
- 百度：千帆 v2，API Key 可以含 `bce-v3/` 格式，不使用旧版 AK/SK 鉴权流程。

自定义模型不自动套用另一个模型的思考参数。推理内容只在同一提供商和模型间回传；切换模型后如其要求严格历史格式，可新建对话。回复达到长度上限时显示错误，不把空回答或被截断的工具参数当成功。

## 验证边界

自动化测试覆盖请求路由、鉴权头、专用参数、工具消息、推理字段、密钥隔离及错误脱敏。未持有这七家平台的用户有效密钥，未进行真实付费模型端到端测试；预设来自官方文档，不等于所有账户都已开通。
