'use strict';

const path = require('node:path').posix;
const { inflateRawSync, crc32 } = require('node:zlib');
const { SaxesParser } = require('saxes');

const MAX_EXPANDED = 100 * 1024 * 1024;
const DAY = 86_400_000;
function invalid(message) { throw new Error(message || 'XLSX 文件结构无效。'); }

// Index the central directory, then inflate only the XML parts the first sheet uses.
// maxOutputLength independently enforces the declared size during decompression.
function openArchive(raw) {
  let end = raw.length - 22;
  while (end >= Math.max(0, raw.length - 65557)) {
    if (raw.readUInt32LE(end) === 0x06054b50 && end + 22 + raw.readUInt16LE(end + 20) === raw.length) break;
    end--;
  }
  if (end < Math.max(0, raw.length - 65557) || raw.readUInt32LE(end + 4) !== 0) invalid();
  const count = raw.readUInt16LE(end + 10);
  if (count > 2000) invalid('Excel 解压后内容过大，拒绝读取。');
  const directory = raw.readUInt32LE(end + 16);
  if (directory + raw.readUInt32LE(end + 12) !== end || count !== raw.readUInt16LE(end + 8)) invalid();
  const entries = new Map();
  let total = 0, cursor = directory;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || raw.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const nameLength = raw.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + raw.readUInt16LE(cursor + 30) + raw.readUInt16LE(cursor + 32);
    if (next > end) invalid();
    const name = raw.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const size = raw.readUInt32LE(cursor + 24);
    total += size;
    if (total > MAX_EXPANDED) invalid('Excel 解压后内容过大，拒绝读取。');
    if (entries.has(name)) invalid();
    entries.set(name, { size, compressed: raw.readUInt32LE(cursor + 20), method: raw.readUInt16LE(cursor + 10),
      flags: raw.readUInt16LE(cursor + 8), crc: raw.readUInt32LE(cursor + 16), offset: raw.readUInt32LE(cursor + 42) });
    cursor = next;
  }
  if (cursor !== end) invalid();
  return function read(name) {
    const entry = entries.get(name);
    if (!entry || entry.flags & 1) invalid();
    const offset = entry.offset;
    if (offset + 30 > directory || raw.readUInt32LE(offset) !== 0x04034b50) invalid();
    const data = offset + 30 + raw.readUInt16LE(offset + 26) + raw.readUInt16LE(offset + 28);
    if (data + entry.compressed > directory) invalid();
    const compressed = raw.subarray(data, data + entry.compressed);
    let bytes;
    try {
      if (entry.method === 0) bytes = compressed;
      else if (entry.method === 8) bytes = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) });
      else invalid();
    } catch { invalid('Excel 压缩数据无效或超出声明大小。'); }
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) invalid('Excel 压缩数据校验失败。');
    return bytes;
  };
}

function parseXml(bytes, { open, close, text }) {
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  parser.on('doctype', () => invalid('Excel XML 含 DTD 声明。'));
  parser.on('error', () => invalid('Excel XML 格式无效。'));
  parser.on('opentag', tag => {
    if (stack.length >= 128) invalid('Excel XML 嵌套过深。');
    open?.(tag.local, tag, stack.at(-1));
    stack.push(tag.local);
  });
  parser.on('closetag', tag => { stack.pop(); close?.(tag.local, stack.at(-1)); });
  if (text) {
    const take = value => text(value, stack.at(-1), stack.at(-2));
    parser.on('text', take);
    parser.on('cdata', take);
  }
  // OOXML writers normally use UTF-8; XML parts may also carry a UTF-16 BOM.
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const decoder = new TextDecoder(encoding, { fatal: true });
  for (let i = 0; i < bytes.length; i += 32768) parser.write(decoder.decode(bytes.subarray(i, i + 32768), { stream: true }));
  parser.write(decoder.decode()).close();
}

function attr(tag, key) { return tag.attributes[key]?.value; }

function relations(read, part) {
  const rels = [];
  const filename = part ? path.join(path.dirname(part), '_rels', path.basename(part) + '.rels') : '_rels/.rels';
  parseXml(read(filename), { open(name, tag, parent) {
    if (name !== 'Relationship' || parent !== 'Relationships' || attr(tag, 'TargetMode') === 'External') return;
    const target = attr(tag, 'Target') || '';
    if (!target || /^[A-Za-z][\w+.-]*:/.test(target) || target.startsWith('//') || target.includes('\\')) return;
    const resolved = path.normalize(target.startsWith('/') ? target.slice(1) : path.join(path.dirname(part), target));
    if (resolved.startsWith('../') || resolved === '..') return;
    rels.push({ id: attr(tag, 'Id'), type: attr(tag, 'Type')?.split('/').pop(), target: resolved });
    if (rels.length > 10_000) invalid('Excel 关联记录过多。');
  } });
  return rels;
}

function sharedStrings(bytes) {
  const strings = [];
  let value, phonetic = false;
  parseXml(bytes, {
    open(name) {
      if (name === 'si') value = '';
      if (name === 'rPh') phonetic = true;
    },
    text(chunk, name) {
      if (name === 't' && value !== undefined && !phonetic) {
        value += chunk;
        if (value.length > 20_000) invalid('Excel 单元格文本过长（最多 10000 字符）。');
      }
    },
    close(name) {
      if (name === 'rPh') phonetic = false;
      if (name === 'si') {
        // Bound retained references even for highly compressible empty strings.
        if (strings.length >= 1_000_000) invalid('Excel 共享文本数量过多。');
        strings.push(value.replaceAll('x005F_', ''));
        value = undefined;
      }
    },
  });
  return strings;
}

function dateStyles(bytes) {
  const formats = new Map();
  const styles = [];
  parseXml(bytes, { open(name, tag, parent) {
    if (name === 'numFmt' && parent === 'numFmts') formats.set(Number(attr(tag, 'numFmtId')), attr(tag, 'formatCode') || '');
    if (name !== 'xf' || parent !== 'cellXfs') return;
    if (styles.length >= 65536) invalid('Excel 样式数量过多。');
    const id = Number(attr(tag, 'numFmtId') || 0);
    const code = (formats.get(id) || '').split(';')[0].replace(/"[^"]*"|\[(?!hh?\]|mm?\]|ss?\])[^\]]*\]|[_\\]./gi, '');
    const duration = id === 46 || /\[(?:hh?|mm?|ss?)\]/i.test(code);
    const date = (id >= 14 && id <= 22) || id === 45 || id === 47 || /[dmhys]/i.test(code);
    styles.push(duration ? 'duration' : date ? 'date' : null);
  } });
  return styles;
}

function dateValue(number, style, macEpoch) {
  const day = Math.floor(number);
  const ms = Math.round((number - day) * DAY);
  if (style === 'duration') {
    const millis = Math.round(number * DAY);
    const days = Math.floor(millis / DAY);
    const time = new Date(millis - days * DAY).toISOString().slice(11, -1);
    const clock = time.replace(/^0/, '').replace(/\.000$/, '').replace(/(\.\d{3})$/, '$1000');
    return (days ? `${days} day${Math.abs(days) === 1 ? '' : 's'}, ` : '') + clock;
  }
  const epoch = macEpoch ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const early = !macEpoch && number > 0 && number < 60 ? 1 : 0;
  const date = new Date(epoch + (day + early) * DAY + ms);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) invalid('Excel 日期超过有效范围。');
  const iso = date.toISOString().slice(0, -1).replace(/\.000$/, '').replace(/(\.\d{3})$/, '$1000');
  return number >= 0 && number < 1 && ms < DAY ? iso.split('T')[1] : iso;
}

// Match the Python profile's JSON representation for Excel float cells.
function floatText(number) {
  const absolute = Math.abs(number);
  if (absolute && (absolute < 1e-4 || absolute >= 1e16)) {
    const [digits, exponent] = number.toExponential().split('e');
    return digits + 'e' + exponent[0] + exponent.slice(1).padStart(2, '0');
  }
  if (Object.is(number, -0)) return '-0.0';
  return Number.isInteger(number) ? number.toFixed(1) : String(number);
}

function cellValue(cell, strings, styles, macEpoch) {
  const value = cell.value;
  if (cell.type === 'e') invalid(`Excel 单元格 ${cell.ref} 含错误值 ${value}。`);
  if (cell.type === 'inlineStr' || cell.type === 'str') return value;
  if (!value) return null;
  if (cell.type === 's') {
    if (!/^\d+$/.test(value) || Number(value) >= strings.length) invalid('Excel 共享文本索引无效。');
    return strings[Number(value)];
  }
  if (cell.type === 'b') {
    if (!/^[01]$/.test(value)) invalid('Excel 布尔值无效。');
    return value === '1';
  }
  if (cell.type === 'd') {
    const iso = value.replace(/Z$/, '');
    return iso.replace(/(\.\d+)$/, (_, fraction) => fraction.padEnd(7, '0')).replace(/\.000000$/, '');
  }
  if (cell.type !== 'n' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) {
    invalid(`Excel 单元格 ${cell.ref} 数值无效。`);
  }
  const number = Number(value);
  if (styles[cell.style]) return dateValue(number, styles[cell.style], macEpoch);
  if (/[e.]/i.test(value)) return floatText(number);
  return Number.isSafeInteger(number) ? number : BigInt(value).toString();
}

function readWorksheet(raw, warnings, add, maxRows, maxColumns) {
  const read = openArchive(raw);
  const workbook = relations(read, '').find(rel => rel.type === 'officeDocument')?.target;
  if (!workbook) invalid();
  const links = relations(read, workbook);
  const worksheets = new Map(links.filter(rel => rel.type === 'worksheet').map(rel => [rel.id, rel.target]));
  let sheet, macEpoch = false;
  parseXml(read(workbook), { open(name, tag, parent) {
    if (name === 'workbookPr') macEpoch = ['1', 'true'].includes(attr(tag, 'date1904'));
    if (!sheet && name === 'sheet' && parent === 'sheets') {
      const id = Object.values(tag.attributes).find(attribute => attribute.local === 'id' && attribute.uri.endsWith('/relationships'))?.value;
      if (worksheets.has(id)) sheet = { title: attr(tag, 'name'), target: worksheets.get(id) };
    }
  } });
  if (!sheet) invalid('Excel 没有工作表。');
  warnings.push(`工作表：${sheet.title}（第一个工作表）。`);
  const strings = links.find(rel => rel.type === 'sharedStrings');
  const styles = links.find(rel => rel.type === 'styles');
  const shared = strings ? sharedStrings(read(strings.target)) : [];
  const formats = styles ? dateStyles(read(styles.target)) : [];

  function rowIndex(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > maxRows + 1) invalid(`Excel 工作表超过 ${maxRows} 行限制（含格式占用的行）；请导出干净数据表。`);
    return number;
  }
  function coordinate(ref) {
    const match = /^([A-Z]{1,3})(\d+)$/.exec(ref);
    if (!match) invalid();
    let column = 0;
    for (const ch of match[1]) column = column * 26 + ch.charCodeAt(0) - 64;
    if (column > maxColumns) invalid(`Excel 工作表超过 ${maxColumns} 列限制。`);
    return { column, row: rowIndex(match[2]) };
  }
  let width = 0, height = 0, written = 0, currentRow, row, cell, phonetic = false;
  function emit(cells) {
    if (!written && !width) width = cells.length;
    if (cells.length > width) invalid('表头含空列名；请为每列命名。');
    add(Array.from({ length: width }, (_, i) => cells[i] ?? null));
    written++;
  }
  parseXml(read(sheet.target), {
    open(name, tag, parent) {
      if (name === 'dimension' && parent === 'worksheet') {
        const end = coordinate((attr(tag, 'ref') || '').split(':').pop());
        width = end.column; height = end.row;
      } else if (name === 'row' && parent === 'sheetData') {
        currentRow = rowIndex(attr(tag, 'r') ?? written + 1);
        if (currentRow <= written) invalid('Excel 行号重复或顺序无效。');
        while (written + 1 < currentRow) emit([]);
        row = [];
      } else if (name === 'c' && parent === 'row' && row) {
        const ref = attr(tag, 'r');
        const position = ref ? coordinate(ref) : { row: currentRow, column: row.length + 1 };
        if (position.row !== currentRow || position.column <= row.length || position.column > maxColumns) invalid('Excel 单元格坐标无效。');
        cell = { ref: ref || `行 ${currentRow} 列 ${position.column}`, column: position.column, type: attr(tag, 't') || 'n', style: Number(attr(tag, 's') || 0), value: '' };
      } else if (name === 'f' && parent === 'c' && cell) invalid(`Excel 单元格 ${cell.ref} 含公式；请先复制并粘贴为值再导入。`);
      else if (name === 'rPh') phonetic = true;
    },
    text(chunk, name, parent) {
      if (cell && ((name === 'v' && parent === 'c') || (cell.type === 'inlineStr' && name === 't' && !phonetic))) {
        cell.value += chunk;
        if (cell.value.length > 20_000) invalid('Excel 单元格文本过长（最多 10000 字符）。');
      }
    },
    close(name, parent) {
      if (name === 'rPh') phonetic = false;
      if (name === 'c' && parent === 'row' && cell) {
        row[cell.column - 1] = cellValue(cell, shared, formats, macEpoch);
        cell = undefined;
      }
      if (name === 'row' && parent === 'sheetData') { emit(row); row = undefined; }
    },
  });
  while (written < height) emit([]);
}

module.exports = { readWorksheet };
