const ID = /^[A-Za-z0-9_-]{1,100}$/;

export function resourceId(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid resource ID. Use an ID returned by the Bioinfo API.');
  return encodeURIComponent(value);
}

export function connection(env = process.env) {
  const url = new URL(env.BIOINFO_BASE_URL || 'http://127.0.0.1:4318');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Bioinfo tools only connect to an HTTP server on 127.0.0.1.');
  }
  const token = env.BIOINFO_TOKEN;
  if (!token || /[\r\n]/.test(token)) throw new Error('Bioinfo connection missing. Start the workbench, then use npm run agent.');
  return { baseUrl: url.origin, token };
}

export async function callApi(route, { method = 'GET', body, signal } = {}) {
  if (!/^\/api\/(datasets(?:\/[A-Za-z0-9_-]+)?|plans(?:\/[A-Za-z0-9_-]+\/run)?|runs\/[A-Za-z0-9_-]+)$/.test(route)) {
    throw new Error('This endpoint is not exposed to the agent.');
  }
  const { baseUrl, token } = connection();
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Bioinfo-Token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
  });
  const data = await response.json().catch(() => ({ error: 'Workbench returned a non-JSON response.' }));
  if (!response.ok) {
    if (response.status === 409) throw new Error('此方案尚未在工作台确认，或已过期。请用户在工作台检查字段映射和缺失值规则并点击确认后再运行；智能体不能代替用户确认。');
    throw new Error(`Bioinfo API ${response.status}: ${String(data.error?.message || data.error || data.message || 'Request failed').slice(0, 1200)}`);
  }
  return data;
}
