import type { Message } from './agent-loop';
import type { ModelSettings } from './model-settings';
export async function requestModel(settings: ModelSettings, messages: Message[], tools: unknown[], signal: AbortSignal): Promise<Message> {
  const response = await fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({apiKey:settings.key,model:settings.model,provider:settings.provider,workspace:settings.workspace,messages,tools}),signal});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.message) throw new Error(data.error || `模型请求失败（${response.status}），请检查网站 API 服务。`);
  return {...data.message,provider:settings.provider,model:settings.model};
}
