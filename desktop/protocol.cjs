'use strict';

const { stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'biobuddy';
const APP_ORIGIN = SCHEME + '://workbench';
const CONTENT_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";
const commonHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.png':'image/png',
  '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.csv':'text/csv; charset=utf-8',
  '.md':'text/plain; charset=utf-8', '.r':'text/plain; charset=utf-8', '.py':'text/plain; charset=utf-8',
  '.qmd':'text/plain; charset=utf-8', '.yml':'text/plain; charset=utf-8', '.zip':'application/zip',
};

function appURL(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === SCHEME + ':' && url.hostname === 'workbench' && !url.port && !url.username && !url.password) return url;
  } catch { /* Malformed URLs have no local destination. */ }
}

function isWorkbench(raw) {
  const url = appURL(raw);
  return !!url && ['/', '/workbench', '/workbench/'].includes(url.pathname);
}

function externalURL(raw) {
  try {
    const url = new URL(raw);
    if (['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password) return url.href;
  } catch { /* Only absolute web addresses can be opened externally. */ }
}

function assetPath(url) {
  if (isWorkbench(url.href)) return 'desktop.html';
  // Built Vite assets and the bundled lessons/cases use portable ASCII names.
  // Keep separators, Windows devices and NTFS alternate streams out of file lookups.
  if (!/^\/(?:assets|tutorial|resources\/v1)\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(url.pathname)) return;
  if (url.pathname.split('/').some(name => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) return;
  return url.pathname.slice(1);
}

function json(status, data) {
  return Response.json(data, { status, headers: { ...commonHeaders, 'Cache-Control': 'no-store' } });
}

async function readBody(request, limit) {
  if (!request.body || Number(request.headers.get('content-length')) > limit) return;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); return; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch { return; }
  finally { reader.releaseLock(); }
}

function protocolHandler({ client, fetchFile, inspectRequest, chatRequest }) {
  return async request => {
    const url = appURL(request.url);
    if (!url) return json(404, { error: '找不到此页面。' });
    const chat = url.pathname === '/api/chat';
    if (chat || url.pathname === '/api/analysis') {
      const origin = request.headers.get('origin');
      if (origin && origin !== APP_ORIGIN) return json(403, { error: '请从工作台打开。' });
      if (request.method !== 'POST') return json(405, { error: '请使用 POST 请求。' });
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(415, { error: '需要 JSON 请求。' });
      const body = await readBody(request, chat ? 512_000 : 3 * 1024 * 1024);
      if (body === undefined) return json(400, { error: '请求格式无效或内容过大。' });
      try {
        const result = await (chat ? chatRequest(body) : inspectRequest(body));
        return json(result.status, result.data);
      } catch { return json(500, { error: '处理请求失败，请重试。' }); }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: '不支持此请求。' });
    const asset = assetPath(url);
    if (!asset) return json(404, { error: '找不到此文件。' });
    const file = path.join(client, asset);
    try {
      const info = await stat(file);
      if (!info.isFile()) return json(404, { error: '找不到此文件。' });
      const headers = { ...commonHeaders, 'Content-Security-Policy': CONTENT_POLICY,
        'Content-Type': mime[path.extname(asset).toLowerCase()] || 'application/octet-stream', 'Content-Length': String(info.size) };
      if (request.method === 'HEAD') return new Response(null, { headers });
      const source = await fetchFile(pathToFileURL(file).href);
      if (source.ok) return new Response(source.body, { headers });
    } catch { /* A missing asset is reported in the renderer. */ }
    return json(404, { error: '找不到此文件。' });
  };
}

module.exports = { SCHEME, APP_ORIGIN, appURL, isWorkbench, externalURL, protocolHandler };
