import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseGuideInline, parseGuideMarkdown } from '../web/src/guide-markdown.ts';
import GuideMarkdown from '../web/src/GuideMarkdown.tsx';

test('all four supplied documents retain every visible word in source order', () => {
  const names = ['01_过滤、整合与聚类.md', '02_细胞注释.md', '03_差异表达与功能富集分析.md', '04_细胞注释.md'];
  const compact = (text: string) => text.replace(/\s+/g, ' ').trim();
  for (const name of names) {
    const source = readFileSync(new URL(`../docs/tutorial-sources/${name}`, import.meta.url), 'utf8');
    const expected = source.split('\n').filter(line => !/^\|(?:\s*:?-+:?\s*\|)+$/.test(line)).map(line =>
      line.replace(/^#{1,6} /, '').replace(/^(?:\d+\. |[-+*] )/, '').replace(/^\||\|$/g, '').replace(/\|/g, ' '),
    ).join('\n');
    const {blocks} = parseGuideMarkdown(source, name);
    const actual = blocks.map(block => block.type === 'list' ? block.items.map(item => item.text).join('\n')
      : block.type === 'table' ? [block.headers, ...block.rows].map(row => row.join(' ')).join('\n') : block.text).join('\n');
    assert.equal(compact(actual), compact(expected), name);
  }
});

test('interrupted source instructions retain their numbering and reading order', () => {
  const {blocks} = parseGuideMarkdown('# 过滤\n\n1. 开始分析\n\n指标释义：\n\n- nCount_RNA\n- nFeature_RNA\n\n2. 调整参数\n\n3. 查看结果', 'qc');
  const lists = blocks.filter(block => block.type === 'list');
  assert.deepEqual(lists.map(list => [list.ordered, ...list.items.map(item => item.value ?? item.text)]), [
    [true, 1], [false, 'nCount_RNA', 'nFeature_RNA'], [true, 2], [true, 3],
  ]);
  const html = renderToStaticMarkup(createElement(GuideMarkdown, {blocks}));
  assert.match(html, /<ol start="2"><li value="2">调整参数/);
  assert.match(html, /<ol start="3"><li value="3">查看结果/);
  assert(html.indexOf('开始分析') < html.indexOf('指标释义'));
  assert(html.indexOf('nFeature_RNA') < html.indexOf('调整参数'));
});

test('repeated headings have deterministic unique anchors and plain-text outline labels', () => {
  const markdown = '# 差异分析\n\n## **参数** `min.pct`\n\n阈值。\n\n## **参数** `min.pct`';
  const first = parseGuideMarkdown(markdown, 'differential');
  assert.deepEqual(first, parseGuideMarkdown(markdown, 'differential'));
  assert.equal(new Set(first.headings.map(heading => heading.id)).size, 3);
  assert.deepEqual(first.headings.map(heading => [heading.level, heading.text]), [[1, '差异分析'], [2, '参数 min.pct'], [2, '参数 min.pct']]);
});

test('method table preserves cell contents, inline emphasis and destination links', () => {
  const {blocks} = parseGuideMarkdown('## 分析方法\n\n| 方法 | 说明 |\n| --- | --- |\n| **ORA** | 差异基因列表 + TERM2GENE |\n| GSEA | [官方资料](https://example.org/docs) 与 `NES` |', 'enrichment');
  const table = blocks.find(block => block.type === 'table');
  assert(table?.type === 'table');
  assert.deepEqual(table.headers, ['方法', '说明']);
  assert.deepEqual(table.rows, [['**ORA**', '差异基因列表 + TERM2GENE'], ['GSEA', '[官方资料](https://example.org/docs) 与 `NES`']]);
  const html = renderToStaticMarkup(createElement(GuideMarkdown, {blocks}));
  assert.match(html, /<strong>ORA<\/strong>/);
  assert.match(html, /href="https:\/\/example.org\/docs" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<code>NES<\/code>/);
});

test('raw HTML and unsafe URL schemes remain inert readable source text', () => {
  const raw = '<script>alert(1)</script> [坏链接](javascript:evil) [数据](data:text/html,evil) [相对链接](/path)';
  const {blocks} = parseGuideMarkdown(raw, 'unsafe');
  const html = renderToStaticMarkup(createElement(GuideMarkdown, {blocks}));
  assert(!html.includes('<script>'));
  assert(!html.includes('<a '));
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert(html.includes('[坏链接](javascript:evil)'));
  assert.deepEqual(parseGuideInline('保留 `a < b` **粗体**'), [
    {type: 'text', text: '保留 '}, {type: 'code', text: 'a < b'}, {type: 'text', text: ' '},
    {type: 'strong', children: [{type: 'text', text: '粗体'}]},
  ]);
});
