// This parser is used only by the local launcher. Never expose bootstrap URLs
// through model-facing tools: the token grants access to the Harness browser UI.
export function parseHarnessBootstrap(line, expectedPort) {
  const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
  const match = /^dsh web:\s+(http:\/\/\S+)$/.exec(clean);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    const port = Number(url.port || 80);
    const configured = Number(expectedPort);
    if (!Number.isInteger(configured) || configured < 0 || configured > 65535) return null;
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.hash) return null;
    if (!Number.isInteger(port) || port < 1 || port > 65535 || (configured !== 0 && port !== configured)) return null;
    if ([...url.searchParams.keys()].length !== 1 || !/^[A-Za-z0-9._-]{16,512}$/.test(url.searchParams.get('token') || '')) return null;
    return url.href;
  } catch { return null; }
}
