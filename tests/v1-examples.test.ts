import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fetchV1Example, v1Examples } from '../web/src/v1-examples.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const local = (url: string) => readFileSync(new URL(`../web/public${url}`, import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../web/src/data/omics-manifest.json', import.meta.url), 'utf8')) as {files: {source: string; sha256: string}[]};

test('V1 examples match the archive sources, with only a header added to spatial positions', () => {
  for (const example of v1Examples) {
    const bytes = local(example.url);
    assert.equal(bytes.length, example.bytes);
    assert.equal(sha(bytes), example.sha256);
    const lines = bytes.toString('utf8').trimEnd().split(/\r?\n/);
    assert.equal(lines.length - 1, example.rows);
    assert.deepEqual(lines[0].split(',').map(value => value.replaceAll('"', '')), example.columns);
    assert(bytes.length < 2 * 1024 * 1024);
    assert(local(example.previewImage).length > 0);
    const source = manifest.files.find(item => item.source === example.sourcePath);
    assert(source);
    if (example.id === 'pbmc-markers') assert.equal(sha(bytes), source.sha256);
    else {
      const original = local('/resources/v1/spatial/supplied-tissue-positions.csv');
      assert.equal(sha(original), source.sha256);
      assert.deepEqual(bytes.subarray(bytes.indexOf('\n') + 1), original);
    }
  }
});

test('V1 example loader supplies the original table to the importer and rejects corruption or HTTP failure', async () => {
  for (const example of v1Examples) {
    const contents = local(example.url);
    const fetcher: typeof fetch = async url => {
      assert.equal(url, example.url);
      return new Response(contents);
    };
    const file = await fetchV1Example(example.id, undefined, fetcher);
    assert.equal(file.name, example.filename);
    assert.equal(file.type, 'text/csv');
    assert.equal(sha(new Uint8Array(await file.arrayBuffer())), example.sha256);
  }
  await assert.rejects(fetchV1Example('pbmc-markers', undefined, async () => new Response('missing', {status: 404})), /无法读取/);
  await assert.rejects(fetchV1Example('pbmc-markers', undefined, async () => new Response('<html>fallback</html>')), /校验失败/);
});
