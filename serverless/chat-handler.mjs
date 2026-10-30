import catalog from '../config/model-providers.json' with { type: 'json' };
// One request to the official provider; the browser owns the agent loop/state.
export async function chatRequest(body, fetcher = fetch) {
  if (!body || typeof body !== 'object') return { status: 400, data: { error: '请求无效。' } };
  const { apiKey, model, messages, tools, provider = 'deepseek', workspace = '' } = body;
  if (typeof provider !== 'string' || !Object.hasOwn(catalog.providers, provider)) return {status:400,data:{error:'请选择支持的国内模型提供商。'}};
  const config = catalog.providers[provider];
  let endpoint = config.endpoint;
  if (provider === 'qwen' && workspace !== '') {
    if (typeof workspace !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$/.test(workspace)) return {status:400,data:{error:'请填写有效的百炼业务空间 ID。'}};
    endpoint = `https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
  }
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) {
    return { status: 400, data: { error: '请先配置有效的 API Key。' } };
  }
  if (typeof model !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(model) || !Array.isArray(messages) || !messages.length || messages.length > 100) {
    return { status: 400, data: { error: '模型或对话内容无效，请新建对话后重试。' } };
  }
  if (tools !== undefined && (!Array.isArray(tools) || tools.length > 10)) {
    return { status: 400, data: { error: '工具配置无效。' } };
  }
  if (messages.some(message => !message || typeof message !== 'object' || !['system','user','assistant','tool'].includes(message.role) || !(message.content === null || typeof message.content === 'string'))) return {status:400,data:{error:'对话消息格式无效。'}};
  try {
    // Provider-specific reasoning metadata must not leak into another API's schema.
    const transcript = messages.map(message => {
      const {role, content, tool_calls, tool_call_id, reasoning_content} = message;
      return {role,content,...(tool_calls ? {tool_calls} : {}),...(tool_call_id ? {tool_call_id} : {}),
        ...(config.reasoning && reasoning_content !== undefined && message.provider === provider && message.model === model ? {reasoning_content} : {})};
    });
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages:transcript, ...(tools?.length ? {tools} : {}), stream: false, ...config.requestDefaults, ...(Object.hasOwn(config.modelOverrides,model) ? config.modelOverrides[model] : {}) }),
      signal: AbortSignal.timeout(110000),
      redirect: 'error',
    });
    if (!response.ok) {
      // Provider errors can echo request fields. Never return or log them.
      const descriptions = { 401: 'API Key 无效，请检查密钥及所属平台、地域。', 402: '模型账户余额不足，请充值后重试。', 403: '没有此模型的调用权限，请在提供商控制台开通。', 404: '模型或接入点不存在，请检查模型 ID。', 429: '模型请求超出额度或频率限制，请查看账户额度后重试。', 400: '模型不接受此请求，请检查模型名称或新建对话。' };
      return { status: response.status >= 500 ? 502 : response.status, data: { error: descriptions[response.status] || '模型服务暂时不可用，请稍后重试。' } };
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message || message.role !== 'assistant') throw new Error('Invalid response');
    if (data.choices[0].finish_reason === 'length') return {status:422,data:{error:'模型输出达到长度上限，请缩短问题或换用非思考模型。'}};
    return { status: 200, data: { message, finishReason: data.choices[0].finish_reason } };
  } catch {
    return { status: 502, data: { error: '模型连接超时或不可用，请稍后重试。' } };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) { res.statusCode = 415; res.end(); return; }
  let body = req.body;
  try {
    if (body === undefined) {
      let content = '';
      for await (const chunk of req) {
        content += chunk;
        if (Buffer.byteLength(content) > 512000) throw new Error('too large');
      }
      body = JSON.parse(content);
    } else if (typeof body === 'string') body = JSON.parse(body);
    if (Buffer.byteLength(JSON.stringify(body)) > 512000) throw new Error('too large');
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: '对话内容过长或格式无效，请新建对话。' }));
    return;
  }
  const result = await chatRequest(body);
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.data));
}
