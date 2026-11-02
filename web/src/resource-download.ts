export interface ResourcePart {url: string; bytes: number; sha256: string}
export interface ResourceArchive {name: string; bytes: number; sha256: string; parts: ResourcePart[]}

/** Fixed same-origin assets only. Validate every part before offering the ZIP. */
export async function assembleArchive(archive: ResourceArchive, signal: AbortSignal, progress: (bytes: number) => void, fetcher: typeof fetch = fetch): Promise<Blob> {
  const blobs: Blob[] = [];
  let completed = 0;
  if (!archive.parts.length || archive.parts.reduce((n, part) => n + part.bytes, 0) !== archive.bytes) throw new Error('资料清单大小不一致，请刷新页面重试。');
  for (const part of archive.parts) {
    signal.throwIfAborted();
    if (!/^\/resources\/v1\/original\/V1\.0\.zip\.part\d{3}\.bin$/.test(part.url) || part.bytes <= 0 || part.bytes > 40_000_000 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('资料清单无效。');
    const response = await fetcher(part.url, {signal});
    if (!response.ok || !response.body) throw new Error('下载失败，请重试或使用下方分包下载。');
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        received += value.length;
        if (received > part.bytes) throw new Error('下载内容与清单不符，请重试。');
        chunks.push(new Uint8Array(value));
        progress(completed + received);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (received !== part.bytes) throw new Error('分包下载不完整，请重试。');
    const blob = new Blob(chunks);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    signal.throwIfAborted();
    const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (checksum !== part.sha256) throw new Error('资料校验未通过，请重试或重新下载分包。');
    blobs.push(blob);
    completed += received;
  }
  return new Blob(blobs, {type: 'application/zip'});
}

export function saveResource(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
