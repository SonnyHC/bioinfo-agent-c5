import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import inspection from '../desktop/inspect.cjs';

const { inspectRequest } = inspection;
const fixture = readFileSync(new URL('./fixtures/desktop-inspection.xlsx', import.meta.url));
function inspect(name, content) {
  return inspectRequest({ action: 'inspect', name, file: Buffer.from(content).toString('base64') });
}
function editWorkbook(edit) {
  const entries = unzipSync(fixture);
  edit(entries);
  return zipSync(entries);
}
function changePart(entries, path, from, to) {
  const source = strFromU8(entries[path]);
  assert.ok(source.includes(from), `Missing fixture text in ${path}`);
  entries[path] = strToU8(source.replace(from, to));
}
const sheet = 'xl/worksheets/sheet1.xml';

test('both supplied V1 teaching tables retain their published hash, fields and first ten records', () => {
  const cases = [
    ['single-cell/supplied-marker-summary.csv', 243, '5a8a58c1cef2bf23f781854233c9350fd0f3439c525ca4af0775f5db12a7b654',
      ['cluster','gene','pct','avg','marker_group'], ['number','string','number','number','string'], ['0','LDHB','95.2743902439024','2.4657293515165','Naive CD4 T']],
    ['spatial/tissue-positions-with-header.csv', 4992, '28cc399378ac1f6236ea8e37e48693a871570303e71e91fe219ec3e66f73cd23',
      ['barcode','in_tissue','array_row','array_col','pxl_row_in_fullres','pxl_col_in_fullres'], ['string','number','number','number','number','number'], ['ACGCCTGACACGCGCT-1','0','0','0','3105','24326']],
  ];
  for (const [name, rows, sha256, names, types, first] of cases) {
    const result = inspect(name, readFileSync(new URL(`../web/public/resources/v1/${name}`, import.meta.url)));
    assert.equal(result.status, 200);
    assert.equal(result.data.rows, rows);
    assert.equal(result.data.sha256, sha256);
    assert.deepEqual(result.data.columns, names.map((name, i) => ({ name, type: types[i], missing: 0 })));
    assert.equal(result.data.preview.length, 10);
    assert.deepEqual(Object.values(result.data.preview[0]), first);
    assert.deepEqual(result.data.warnings, []);
  }
});

test('strict CSV/TSV parsing preserves source spelling, escaped quotes, embedded CRLF and labels', () => {
  const input = '\ufeff编号\t说明\t值\t__proto__\r\n001\t"两行\r\n""记录"""\t1.20\towned\r\n002\t \t二\t\r\n';
  const { status, data } = inspect('study.CSV', input);
  assert.equal(status, 200);
  assert.deepEqual(data.columns.map(({ type, missing }) => [type, missing]), [['number',0],['string',1],['string',0],['string',1]]);
  assert.deepEqual(data.preview[0], { 编号: '001', 说明: '两行\r\n"记录"', 值: '1.20', ['__proto__']: 'owned' });
  assert.equal(data.preview[1].说明, null);
  assert.deepEqual(data.warnings, ['文件内容使用制表符分隔，按 TSV 读取。','值 包含数值和文本。','2 个空单元格。']);
  assert.equal(inspect('study.tsv', input).data.warnings.length, 2);
});

test('real openpyxl workbook matches the Python engine profile including date precision and first-sheet choice', () => {
  const result = inspect('study.XLSX', fixture);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {
    rows: 3,
    columns: [['样本','number',0],['整数','number',0],['浮点','number',1],['布尔','string',1],['日期','string',2],['备注','string',1]]
      .map(([name,type,missing]) => ({name,type,missing})),
    preview: [
      { 样本:'001',整数:12,浮点:'-1.25',布尔:true,日期:'2024-01-02T03:04:05.123000',备注:' 空格 ' },
      { 样本:'002',整数:0,浮点:'0.125',布尔:false,日期:null,备注:null },
      { 样本:'003',整数:3,浮点:null,布尔:null,日期:null,备注:'保留 & 字符' },
    ],
    warnings: ['工作表：实验记录（第一个工作表）。','5 个空单元格。'],
    sha256: createHash('sha256').update(fixture).digest('hex'),
  });
});

test('a shared rich-text cell and missing Excel cells preserve source layout', () => {
  const content = editWorkbook(entries => {
    changePart(entries, 'xl/_rels/workbook.xml.rels', '</Relationships>', '<Relationship Id="rId20" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
    entries['xl/sharedStrings.xml'] = strToU8('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>样本</t></r><rPh><t>ignored</t></rPh><r><t> &amp; A</t></r></si></sst>');
    changePart(entries, sheet, '<c r="A2" t="inlineStr"><is><t>001</t></is></c>', '<c r="A2" t="s"><v>0</v></c>');
    changePart(entries, sheet, 'ref="A1:F4"', 'ref="A1:F5"');
  });
  const { status, data } = inspect('rich.xlsx', content);
  assert.equal(status, 200);
  assert.equal(data.preview[0].样本,'样本 & A');
  assert.equal(data.rows, 4);
  assert.deepEqual(Object.values(data.preview[3]), [null,null,null,null,null,null]);
});

test('extension, strict base64, UTF-8, cell types, shape and 2 MiB boundary are enforced', () => {
  for (const [name, content, error] of [
    ['x.xls', 'data', /CSV、TSV 或 XLSX/], ['x.csv', '', /非空/], ['x.csv', Buffer.from([0xff]), /UTF-8/],
    ['x.csv', 'a\n1\0\n', /NUL/], ['x.tsv', 'a\ta\n1\t2', /重复列名/], ['x.csv', 'a,\n1,2', /空列名/],
    ['x.csv', 'h\nh\n', /重复了表头/], ['x.csv', 'a\n1,2\n', /表头有/], ['x.csv', 'a\nx\n\n', /0 列/],
    ['x.csv', 'a\n"bad', /引号/], ['x.csv', 'a\n"bad"b', /引号/], ['x.csv', 'a\n=2+3', /公式/],
    ['x.csv', 'a\n-Inf', /非有限/], ['x.csv', 'a\n1e900', /溢出/], ['x.csv', 'a\n'+'x'.repeat(10001), /文本过长/],
    ['x.csv', 'a\n'+'1\n'.repeat(50001), /50000/], ['x.csv', Array.from({length:101},(_,i)=>'v'+i).join(','), /100 列/],
    ['x.xlsx', 'invalid', /XLSX/],
  ]) {
    const result = inspect(name, content);
    assert.equal(result.status, 422, name);
    assert.match(result.data.error, error);
  }
  const valid = Buffer.from('a\n' + ('x'.repeat(8191)+'\n').repeat(255) + 'x'.repeat(8190));
  assert.equal(valid.length, 2*1024*1024);
  assert.equal(inspect('x.csv', valid).status, 200);
  assert.match(inspect('x.csv', Buffer.concat([valid, Buffer.from('x')])).data.error, /2 MB/);
  assert.match(inspectRequest({ action:'inspect', name:'x.csv', file:'$$$=' }).data.error, /编码/);
  assert.equal(inspectRequest({action:'render'}).status, 422);
});

test('invalid Excel formulas, errors, dimensions, XML declarations and external sheet targets yield 422', () => {
  for (const [entry, from, to, error] of [
    [sheet, '<v>12</v>', '<f>1+11</f><v>12</v>', /B2 含公式/],
    [sheet, '<c r="B2" t="n"><v>12</v>', '<c r="B2" t="e"><v>#DIV\/0!</v>', /B2 含错误值/],
    [sheet, 'ref="A1:F4"', 'ref="A1:ZZ4"', /100 列/],
    [sheet, 'ref="A1:F4"', 'ref="A1:F900000"', /50000 行/],
    [sheet, '<worksheet', '<!DOCTYPE worksheet><worksheet', /DTD/],
    ['xl/_rels/workbook.xml.rels', 'Target="/xl/worksheets/sheet1.xml"', 'TargetMode="External" Target="https://example.invalid/a"', /含公式/],
  ]) {
    const result = inspect('invalid.xlsx', editWorkbook(entries => changePart(entries, entry, from, to)));
    assert.equal(result.status, 422);
    assert.match(result.data.error, error);
  }
  const truncated = fixture.subarray(0, fixture.length-16);
  assert.equal(inspect('truncated.xlsx', truncated).status, 422);
  const changed = Buffer.from(fixture);
  const central = changed.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  changed.writeUInt32LE(101*1024*1024, central+24);
  assert.match(inspect('large.xlsx', changed).data.error, /解压后内容过大/);
});
