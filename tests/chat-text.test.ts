import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAssistantContent } from '../web/src/chat-text.ts';

test('assistant Markdown becomes prose while gene names, links and scientific symbols survive', () => {
  const result = parseAssistantContent([
    '## **表达分析**', '', '> 比较 `nFeature_RNA` 与 *Runx1*。',
    '', '在 [案例](/?view=omics) 查看结果。', '', '- log2FC > 1', '- FDR < 0.05',
    '', '| 基因 | 方向 |', '|---|---|', '| ACTB | ↑ |',
  ].join('\n'));
  assert.equal(result.text, '表达分析\n\n比较 nFeature_RNA 与 Runx1。\n\n在 案例 查看结果。\n\n• log2FC > 1\n• FDR < 0.05\n\n基因\t方向\nACTB\t↑');
  assert.deepEqual(result.parts.filter(part => part.href), [{ text: '案例', href: '/?view=omics' }]);
  assert.deepEqual(result.files, []);
});

test('code blocks retain whitespace and stay entirely outside the text', () => {
  const source = '  x <- c(1, 2)\n\n  print(x)\n';
  const result = parseAssistantContent(['说明', '```{.r filename="plots.R"}', source + '```',
    '~~~python', 'print("#not a heading")', '~~~', '结束'].join('\n'));
  assert.equal(result.text, '说明\n\n结束');
  assert.deepEqual(result.files, [{ name: 'plots.R', content: source }, { name: 'analysis.py', content: 'print("#not a heading")\n' }]);
});

test('fallback files get stable names and retain unfinished fences and inline terms', () => {
  const result = parseAssistantContent('使用 `DESeq2`。\n\n```r\nx <- 1\n```\n\n```r\nx <- 2');
  assert.equal(result.text, '使用 DESeq2。');
  assert.deepEqual(result.files, [{ name: 'analysis.R', content: 'x <- 1\n' }, { name: 'analysis-2.R', content: 'x <- 2' }]);
});

test('nested Markdown wrapper preserves its paragraphs and exposes only the enclosed script', () => {
  const result = parseAssistantContent('````markdown\n## 结果\n\n```python\nprint(42)\n```\n\n完成。\n````');
  assert.equal(result.text, '结果\n\n完成。');
  assert.deepEqual(result.files, [{ name: 'analysis.py', content: 'print(42)\n' }]);
});

test('plain fenced sentences, external URLs and unsafe link labels remain readable text', () => {
  const result = parseAssistantContent('```text\n这是一行说明。\n```\n\n[来源](https://example.org/a) 和 [坏链接](javascript:alert(1))');
  assert.equal(result.text, '这是一行说明。\n\n来源 (https://example.org/a) 和 坏链接');
  assert.deepEqual(result.files, []);
  assert.equal(result.parts.some(part => part.href), false);
});

test('invalid names never become downloads; a standalone filename identifies its next block', () => {
  const result = parseAssistantContent('```r filename="../outside.R"\nx\n```\n\n**example.py**\n\n```python\ny\n```');
  assert.deepEqual(result.files.map(file => file.name), ['analysis.R', 'example.py']);
});

test('indented, inline and unfenced source examples are available as files', () => {
  const result = parseAssistantContent([
    '可以运行 `library(edgeR)` 准备环境。', '', '    print(42)', '',
    '执行以下分析。', 'data <- read.csv("counts.csv")', 'library(limma)', '完成后查看结果。',
  ].join('\n'));
  assert.equal(result.text, '可以运行 analysis.R 准备环境。\n\n执行以下分析。\n完成后查看结果。');
  assert.deepEqual(result.files.map(file => file.name), ['analysis.R', 'analysis.py', 'analysis-2.R']);
  assert.equal(result.files[2].content, 'data <- read.csv("counts.csv")\nlibrary(limma)');
});
