import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chartPreviews } from '../web/src/chart-previews.ts';

test('chart previews preserve the exact supplied V1.0 figures and do not invent missing types', () => {
  const manifest = JSON.parse(readFileSync(new URL('../web/src/data/omics-manifest.json', import.meta.url), 'utf8'));
  assert.equal(chartPreviews.box, null);
  assert.equal(chartPreviews.bar, null);
  assert.match(chartPreviews.scatter!.caption, /UMAP/);
  assert.match(chartPreviews.scatter!.alt, /不是本次表格/);
  assert.equal(Object.values(chartPreviews).filter(Boolean).length, 4);
  for (const preview of Object.values(chartPreviews)) {
    if (!preview) continue;
    const record = manifest.files.find((item: {source: string}) => item.source === preview.sourcePath);
    assert(record, `missing source record for ${preview.url}`);
    const bytes = readFileSync(new URL('../web/public' + preview.url, import.meta.url));
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(bytes.subarray(1,4).toString(), 'PNG');
  }
});
