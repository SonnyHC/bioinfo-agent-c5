import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { assembleArchive, type ResourceArchive } from '../web/src/resource-download.ts';
import { appRoute, safeAppLink } from '../web/src/navigation.ts';
import { executeTool } from '../web/src/agent-tools.ts';
import { skillCatalog, skillMarkdown } from '../web/src/skill-catalog.ts';
import { omicsCases, omicsGuides } from '../web/src/omics-content.ts';

const digest = (input: string) => createHash('sha256').update(input).digest('hex');
function fixture(): ResourceArchive {
  return {name:'V1.0-original.zip', bytes:6, sha256:digest('abcdef'), parts:[
    {url:'/resources/v1/original/V1.0.zip.part001.bin',bytes:3,sha256:digest('abc')},
    {url:'/resources/v1/original/V1.0.zip.part002.bin',bytes:3,sha256:digest('def')},
  ]};
}

test('streamed archive validates ordered parts and reports received bytes', async () => {
  const seen: string[] = [];
  const progress: number[] = [];
  const result = await assembleArchive(fixture(), new AbortController().signal, size => progress.push(size), async url => {
    seen.push(String(url));
    const text = String(url).includes('001') ? 'abc' : 'def';
    return new Response(new ReadableStream({start(controller) {
      controller.enqueue(new TextEncoder().encode(text.slice(0, 1)));
      controller.enqueue(new TextEncoder().encode(text.slice(1)));
      controller.close();
    }}));
  });
  assert.equal(await result.text(), 'abcdef');
  assert.deepEqual(seen, fixture().parts.map(part => part.url));
  assert.deepEqual(progress, [1,3,4,6]);
  assert.equal(result.type, 'application/zip');
});

test('failed, truncated, oversized and corrupt parts never produce an archive', async () => {
  for (const response of [new Response('404', {status:404}), new Response('ab'), new Response('abcd'), new Response('bad')]) {
    await assert.rejects(assembleArchive(fixture(), new AbortController().signal, () => {}, async () => response));
  }
  const invalid = fixture();
  invalid.parts[0].url = 'https://example.com/leak';
  let fetched = false;
  await assert.rejects(assembleArchive(invalid, new AbortController().signal, () => {}, async () => {fetched = true; return new Response('abc');}), /清单无效/);
  assert.equal(fetched, false);
});

test('cancelling during a stream stops before another part is fetched', async () => {
  const abort = new AbortController();
  let calls = 0;
  await assert.rejects(assembleArchive(fixture(), abort.signal, () => abort.abort(), async () => {calls++; return new Response('abc');}), error => (error as Error).name === 'AbortError');
  assert.equal(calls, 1);
});

test('case and guide resources exist and packaged metadata matches actual downloads', () => {
  const manifest = JSON.parse(readFileSync(new URL('../web/src/data/omics-manifest.json', import.meta.url), 'utf8'));
  const local = (url: string) => new URL('../web/public' + url, import.meta.url);
  assert.equal(manifest.files.length,44);
  assert.equal(manifest.original.parts.length,7);
  assert.equal(manifest.original.parts.reduce((size: number, part: {bytes:number}) => size + part.bytes,0),manifest.original.bytes);
  for (const part of manifest.original.parts) {
    assert(part.bytes <= 40_000_000);
    assert.equal(statSync(local(part.url)).size, part.bytes);
  }
  for (const resource of Object.values(manifest.packages) as {url:string;bytes:number;sha256:string}[]) {
    const bytes = readFileSync(local(resource.url));
    assert.equal(bytes.length, resource.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256);
  }
  assert.equal(omicsCases.reduce((n, item) => n + item.figures.length, 0),13);
  for (const item of omicsCases) {
    for (const [file] of item.figures) assert(statSync(local(`/resources/v1/${item.id}/figures/${file}`)).size > 0);
    for (const [file] of item.files) assert(statSync(local(`/resources/v1/${item.id}/${file}`)).size > 0);
  }
  for (const guide of omicsGuides) {
    assert.equal(readFileSync(local(`/resources/v1/guides/${guide.id}.md`), 'utf8'), guide.markdown);
  }
});

test('resources route and guidance skills do not create analysis or execution requests', async () => {
  assert.equal(safeAppLink('/?view=omics'), '/?view=omics');
  assert.deepEqual(appRoute('/?view=omics'), {view:'omics',request:{}});
  assert.equal(safeAppLink('/?view=omics&url=https://example.com'), undefined);
  const result = await executeTool('bio_open_omics_resources', {}, new AbortController().signal) as {workbenchUrl:string;environmentUrl:string;note:string};
  assert.equal(result.workbenchUrl,'/?view=omics');
  assert.equal(result.environmentUrl,'/?view=environments');
  assert.match(result.note,/不执行/);
  const guidance = skillCatalog.filter(skill => ['单细胞', '空间组学'].includes(skill.category));
  assert.equal(guidance.length,5);
  for (const skill of guidance) {
    assert.match(skillMarkdown(skill),/外部/);
    assert(!skill.tools.some(name => /preview_plan|run|approve|install/.test(name)));
  }
});


test('case deep links preserve the chosen V1 case and reject unknown values', () => {
  assert.deepEqual(appRoute('/?view=omics&case=spatial'), {view:'omics',request:{case:'spatial'}});
  assert.equal(safeAppLink('/?view=omics&case=single-cell'), '/?view=omics&case=single-cell');
  assert.equal(safeAppLink('/?view=omics&case=unknown'), undefined);
  assert.equal(safeAppLink('/?view=omics&case=spatial&case=single-cell'), undefined);
});

test('skill topics retain plotting tools, merge annotation evidence and separate differential expression from enrichment', () => {
  const byId = (id: string) => {
    const skill = skillCatalog.find(item => item.id === id);
    assert(skill, `Missing skill ${id}`);
    return skill;
  };
  assert.equal(skillCatalog.length, 10);
  assert.deepEqual(['matrix-heatmap', 'distribution-explorer', 'result-review'].map(id => byId(id).name),
    ['表达矩阵热图', '分布与关系探索', '结果复核与复现']);
  for (const skill of skillCatalog) assert.doesNotMatch(skillMarkdown(skill) + skill.category + skill.starter, /指导/);
  assert(!skillCatalog.some(item => ['cell-annotation-evidence', 'differential-enrichment-guide'].includes(item.id)));
  const annotation = byId('cell-annotation-review');
  assert.match(annotation.reading!, /注释是一条证据链/);
  assert.match(annotation.reading!, /先分清这四张图说明什么/);
  assert.match(annotation.reading!, /建议保存的注释表/);
  const differential = byId('differential-expression');
  const enrichment = byId('functional-enrichment');
  assert.match(differential.reading!, /pseudobulk/);
  assert.doesNotMatch(differential.reading!, /ORA|GSEA/);
  assert.match(enrichment.reading!, /ORA/);
  assert.match(enrichment.reading!, /GSEA/);
  assert.doesNotMatch(enrichment.reading!, /Wilcoxon|Presto|pseudobulk/);
});
