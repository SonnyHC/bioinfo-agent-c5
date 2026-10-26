export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new Error('服务连接失败，请重试。');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, {
  method: 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
