import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { omicsGuides } from '../web/src/omics-content.ts';

interface SourceRecord {
  file: string; bytes: number; sha256: string; lineCount: number;
  nonemptyLines: number; coveredNonemptyLines: number;
}
interface SourceSpan {source: string; startLine: number; endLine: number}
interface MappedGuide {id: string; spans: SourceSpan[]; markdownSha256: string}
interface SourceMap {sourceDirectory: string; sources: SourceRecord[]; guides: MappedGuide[]}

const sourceMap: SourceMap = JSON.parse(readFileSync(new URL('../docs/tutorial-source-map.json', import.meta.url), 'utf8'));
const sourceBytes = new Map(sourceMap.sources.map(source => [source.file,
  readFileSync(new URL(`../${sourceMap.sourceDirectory}/${source.file}`, import.meta.url)),
]));
const sourceLines = new Map([...sourceBytes].map(([name, bytes]) => {
  const lines = bytes.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return [name, lines];
}));
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const nonempty = (lines: string[]) => lines.filter(line => line.trim() !== '');

test('four tutorial titles, annotation merge and split topics follow the approved order', () => {
  assert.deepEqual(omicsGuides.map(guide => [guide.id, guide.title]), [
    ['qc-integration', '过滤、整合与聚类'],
    ['cell-annotation', '细胞注释'],
    ['differential-analysis', '差异分析'],
    ['enrichment-analysis', '富集分析'],
  ]);
  assert.deepEqual(sourceMap.guides.map(guide => guide.id), omicsGuides.map(guide => guide.id));
  assert.deepEqual(sourceMap.guides.find(guide => guide.id === 'cell-annotation')?.spans.map(span => span.source),
    ['04_细胞注释.md', '02_细胞注释.md']);

  const differential = omicsGuides.find(guide => guide.id === 'differential-analysis')!.markdown;
  const enrichment = omicsGuides.find(guide => guide.id === 'enrichment-analysis')!.markdown;
  for (const heading of ['## 差异表达分析', '### 差异表达分析结果', '#### 火山图', '#### 热图', '#### 小提琴图', '#### Q1：差异分析方法怎么选', '#### Q6：结果与预期不一致怎么排查']) {
    assert(differential.split('\n').includes(heading), `差异分析缺少 ${heading}`);
    assert(!enrichment.split('\n').includes(heading), `差异专属章节误入富集分析：${heading}`);
  }
  for (const heading of ['## 功能富集分析', '### 数据库与数据集', '### 富集分析结果', '#### 气泡图', '#### 条形图', '#### GSEA 富集评分图', '#### Q4：ORA 和 GSEA 什么时候用', '#### Q7：富集数据库没找到对应物种']) {
    assert(enrichment.split('\n').includes(heading), `富集分析缺少 ${heading}`);
    assert(!differential.split('\n').includes(heading), `富集专属章节误入差异分析：${heading}`);
  }
});

test('each generated nonempty line equals its mapped original line and no source line is omitted', () => {
  const covered = new Map(sourceMap.sources.map(source => [source.file, new Set<number>()]));
  for (const mapping of sourceMap.guides) {
    const guide = omicsGuides.find(item => item.id === mapping.id)!;
    const generatedLines = guide.markdown.split('\n');
    assert.equal(generatedLines.shift(), `# ${guide.title}`);
    const restored = nonempty(generatedLines).map(line => /^#{2,6}\s/.test(line) ? line.slice(1) : line);
    const expected: string[] = [];
    for (const span of mapping.spans) {
      const lines = sourceLines.get(span.source);
      assert(lines, `未知原文件 ${span.source}`);
      assert(Number.isInteger(span.startLine) && span.startLine >= 1);
      assert(Number.isInteger(span.endLine) && span.endLine >= span.startLine && span.endLine <= lines.length);
      for (let lineNumber = span.startLine; lineNumber <= span.endLine; lineNumber++) {
        const line = lines[lineNumber - 1];
        if (line.trim()) {
          expected.push(line);
          covered.get(span.source)!.add(lineNumber);
        }
      }
    }
    assert.deepEqual(restored, expected, `${mapping.id} 正文必须逐行保留原文，仅调整标题层级`);
    assert.equal(sha256(guide.markdown), mapping.markdownSha256);
  }
  for (const source of sourceMap.sources) {
    const bytes = sourceBytes.get(source.file)!;
    const lines = sourceLines.get(source.file)!;
    const expectedNumbers = lines.flatMap((line, index) => line.trim() ? [index + 1] : []);
    assert.equal(bytes.length, source.bytes);
    assert.equal(sha256(bytes), source.sha256);
    assert.equal(lines.length, source.lineCount);
    assert.equal(expectedNumbers.length, source.nonemptyLines);
    assert.equal(covered.get(source.file)!.size, source.coveredNonemptyLines);
    assert.deepEqual([...covered.get(source.file)!].sort((a, b) => a - b), expectedNumbers, `${source.file} 不得遗漏任何非空行`);
  }
});

test('download archive contains exactly four arranged tutorials and four byte-identical originals', () => {
  const archive = unzipSync(readFileSync(new URL('../web/public/resources/v1/guides-reproduction.zip', import.meta.url)));
  const expectedMembers = [
    ...omicsGuides.map(guide => `${guide.id}.md`),
    ...sourceMap.sources.map(source => `originals/${source.file}`),
  ].sort();
  assert.equal(expectedMembers.length, 8);
  assert.deepEqual(Object.keys(archive).sort(), expectedMembers);
  for (const guide of omicsGuides) {
    const bytes = Buffer.from(guide.markdown, 'utf8');
    assert.deepEqual(Buffer.from(archive[`${guide.id}.md`]), bytes, `${guide.id} ZIP 与页面内容必须一致`);
    assert.deepEqual(readFileSync(new URL(`../web/public/resources/v1/guides/${guide.id}.md`, import.meta.url)), bytes, `${guide.id} 单篇下载与页面内容必须一致`);
  }
  for (const source of sourceMap.sources) {
    assert.deepEqual(Buffer.from(archive[`originals/${source.file}`]), sourceBytes.get(source.file), `${source.file} 原件必须逐字节一致`);
  }
});

test('both manifests describe the actual tutorial archive with the same size and SHA-256', () => {
  const client = JSON.parse(readFileSync(new URL('../web/src/data/omics-manifest.json', import.meta.url), 'utf8'));
  const served = JSON.parse(readFileSync(new URL('../web/public/resources/v1/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(client.packages.guides, served.packages.guides);
  const resource = client.packages.guides;
  assert.equal(resource.url, '/resources/v1/guides-reproduction.zip');
  const archive = readFileSync(new URL(`../web/public${resource.url}`, import.meta.url));
  assert.equal(resource.bytes, archive.length);
  assert.equal(resource.sha256, sha256(archive));
});
