'use strict';

const { createHash } = require('node:crypto');
const { extname } = require('node:path');
const { readWorksheet } = require('./worksheet.cjs');

const MAX_FILE = 2 * 1024 * 1024;
const MAX_ROWS = 50_000;
const MAX_COLUMNS = 100;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const NONFINITE = /^[+-]?(?:nan|inf(?:inity)?)$/i;

function fail(message) { throw new Error(message); }

function validate(value, row, column) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  const location = `第 ${row} 行、${column} 列`;
  if (NONFINITE.test(text)) fail(`${location}包含 ${text}；非有限数值不能当作缺失值忽略。`);
  if (NUMBER.test(text) && !Number.isFinite(Number(text))) fail(`${location}数值溢出。`);
  if (/^[=@]/.test(text) || (/^[+-]/.test(text) && !NUMBER.test(text))) {
    fail(`${location}包含公式样式文本；请导出为纯数据后重试。`);
  }
  if (value.length > 10_000 && Array.from(value).length > 10_000) fail(`${location}文本过长（最多 10000 字符）。`);
  return text ? value : null;
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

// Accumulate statistics as rows arrive. Only the first ten records are retained.
function profile(warnings) {
  let columns, header, rows = 0;
  const preview = [];
  function add(row) {
    if (row.length > MAX_COLUMNS) fail(`数据超过 ${MAX_COLUMNS} 列限制。`);
    if (!header) {
      header = row.map(asText);
      if (!header.some(name => name.trim())) fail('缺少表头；第一行必须是非空且不重复的列名。');
      if (header.some(name => !name.trim())) fail('表头含空列名；请为每列命名。');
      if (header.some(name => Array.from(name).length > 120)) fail('列名超过 120 字符限制。');
      header.forEach(name => validate(name, 1, '表头'));
      const duplicates = new Set(header.filter((name, i) => header.indexOf(name) !== i));
      if (duplicates.size) fail(`存在重复列名：${[...duplicates].join(', ')}。`);
      columns = header.map(name => ({ name, missing: 0, numeric: 0 }));
      return;
    }
    ++rows;
    if (rows > MAX_ROWS) fail(`数据超过 ${MAX_ROWS} 行限制。`);
    if (row.length !== header.length) fail(`第 ${rows + 1} 行有 ${row.length} 列，表头有 ${header.length} 列；请统一列数。`);
    if (row.every((value, i) => asText(value) === header[i])) fail(`第 ${rows + 1} 行重复了表头；请确认是否拼接了多个数据表。`);
    const clean = row.map((cell, i) => {
      const value = validate(cell, rows + 1, header[i]);
      if (value == null) columns[i].missing++;
      else if (typeof value === 'number' || (typeof value === 'string' && NUMBER.test(value.trim()))) columns[i].numeric++;
      return value;
    });
    if (rows <= 10) preview.push(Object.fromEntries(header.map((name, i) => [name, clean[i]])));
  }
  function finish(sha256) {
    if (!header) fail('缺少表头；第一行必须是非空且不重复的列名。');
    if (!rows) fail('只有表头，没有数据行。');
    const fields = columns.map(({ name, missing, numeric }) => {
      const present = rows - missing;
      if (numeric && numeric < present) warnings.push(`${name} 包含数值和文本。`);
      return { name, type: present && present === numeric ? 'number' : 'string', missing };
    });
    const blanks = columns.reduce((sum, column) => sum + column.missing, 0);
    if (blanks) warnings.push(`${blanks} 个空单元格。`);
    return { rows, columns: fields, preview, warnings, sha256 };
  }
  return { add, finish };
}

function readDelimited(raw, suffix, warnings, add) {
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { fail('请使用 UTF-8 编码的 CSV/TSV（支持 UTF-8 BOM）。'); }
  if (decoded.includes('\0')) fail('文本文件包含 NUL 字节；请检查文件格式。');
  let delimiter = suffix === '.tsv' ? '\t' : ',';
  const firstLine = decoded.split(/[\r\n]/, 1)[0];
  if (suffix === '.csv' && firstLine.includes('\t') && !firstLine.includes(',')) {
    delimiter = '\t';
    warnings.push('文件内容使用制表符分隔，按 TSV 读取。');
  }
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < decoded.length; ++i) {
    const ch = decoded[i];
    if (quoted) {
      if (ch === '"' && decoded[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === delimiter) {
      row.push(cell);
      if (row.length >= MAX_COLUMNS) fail(`数据超过 ${MAX_COLUMNS} 列限制。`);
      cell = ''; closed = false;
    } else if (ch === '\r' || ch === '\n') {
      if (cell || row.length || closed) row.push(cell);
      add(row);
      if (ch === '\r' && decoded[i + 1] === '\n') i++;
      row = []; cell = ''; closed = false;
    } else if (closed) fail('CSV/TSV 解析失败：引号结束后应为分隔符或行尾。');
    else if (ch === '"' && !cell) quoted = true;
    else cell += ch;
    if (cell.length > 20_000) fail('单元格文本过长（最多 10000 字符）。');
  }
  if (quoted) fail('CSV/TSV 解析失败：引号未闭合。');
  if (cell || row.length || closed) { row.push(cell); add(row); }
}

function inspectRequest(body) {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求必须是 JSON 对象。');
    if (body.action === 'status') return { status: 200, data: { version: '0.3.0', mode: 'desktop', maxUploadMB: 2, pythonReady: false } };
    if (body.action !== 'inspect') fail('未知的分析操作。');
    if (typeof body.name !== 'string' || Array.from(body.name).length > 250) fail('文件名无效。');
    const suffix = extname(body.name).toLowerCase();
    if (!['.csv', '.tsv', '.xlsx'].includes(suffix)) fail('请选择 CSV、TSV 或 XLSX 文件。');
    const encoded = body.file;
    if (typeof encoded !== 'string') fail('文件编码无效。');
    if (encoded.length > Math.ceil(MAX_FILE / 3) * 4) fail('文件超过 2 MB，请选择需要分析的表格。');
    if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || /\s/.test(encoded)) fail('文件编码无效。');
    const raw = Buffer.from(encoded, 'base64');
    if (!raw.length || raw.length > MAX_FILE) fail('请选择非空且不超过 2 MB 的文件。');
    const warnings = [];
    const table = profile(warnings);
    if (suffix === '.xlsx') readWorksheet(raw, warnings, table.add, MAX_ROWS, MAX_COLUMNS);
    else readDelimited(raw, suffix, warnings, table.add);
    const data = table.finish(createHash('sha256').update(raw).digest('hex'));
    if (Buffer.byteLength(JSON.stringify(data)) > 4 * 1024 * 1024) fail('返回内容过大，请缩小数据后重试。');
    return { status: 200, data };
  } catch (error) {
    return { status: 422, data: { error: error.message } };
  }
}

module.exports = { inspectRequest };
