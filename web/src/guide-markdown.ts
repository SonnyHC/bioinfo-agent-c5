export type GuideInline =
  | {type: 'text'; text: string}
  | {type: 'code'; text: string}
  | {type: 'strong'; children: GuideInline[]}
  | {type: 'link'; href: string; children: GuideInline[]};

export interface GuideHeading {id: string; text: string; level: number}
export type GuideBlock =
  | {type: 'heading'; id: string; level: number; text: string}
  | {type: 'paragraph'; text: string}
  | {type: 'list'; ordered: boolean; items: {text: string; value?: number}[]}
  | {type: 'table'; label: string; headers: string[]; rows: string[][]; align: ('left' | 'center' | 'right')[]};

// These bundled documents use headings, paragraphs, lists, tables and three
// inline forms. Unsupported Markdown remains readable text; HTML is never run.
export function parseGuideInline(text: string): GuideInline[] {
  const nodes: GuideInline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > end) nodes.push({type: 'text', text: text.slice(end, index)});
    if (match[1] !== undefined) nodes.push({type: 'code', text: match[1]});
    else if (match[2] !== undefined) nodes.push({type: 'strong', children: parseGuideInline(match[2])});
    else {
      let safe = false;
      try { safe = ['http:', 'https:'].includes(new URL(match[4]).protocol); } catch { /* Keep malformed links as text. */ }
      nodes.push(safe
        ? {type: 'link', href: match[4], children: parseGuideInline(match[3])}
        : {type: 'text', text: match[0]});
    }
    end = index + match[0].length;
  }
  if (end < text.length) nodes.push({type: 'text', text: text.slice(end)});
  return nodes;
}

export function guideInlineText(text: string): string {
  const flatten = (nodes: GuideInline[]): string => nodes.map(node => 'children' in node ? flatten(node.children) : node.text).join('');
  return flatten(parseGuideInline(text));
}

const headingPattern = /^(#{1,6})\s+(.+)$/;
const listPattern = /^\s*(?:(\d+)\.\s+|[-+*]\s+)(.+)$/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

function tableSeparator(line: string | undefined): boolean {
  return !!line && line.includes('|') && tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell));
}

export function parseGuideMarkdown(markdown: string, idPrefix: string): {blocks: GuideBlock[]; headings: GuideHeading[]} {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: GuideBlock[] = [];
  const headings: GuideHeading[] = [];
  const prefix = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '-') || 'guide';
  const startsBlock = (index: number): boolean => headingPattern.test(lines[index]) || listPattern.test(lines[index])
    || (lines[index].includes('|') && tableSeparator(lines[index + 1]));
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const heading = line.match(headingPattern);
    if (heading) {
      const id = `${prefix}-section-${headings.length + 1}`;
      const level = heading[1].length;
      blocks.push({type: 'heading', id, level, text: heading[2]});
      headings.push({id, level, text: guideInlineText(heading[2])});
      index++;
      continue;
    }
    if (line.includes('|') && tableSeparator(lines[index + 1])) {
      const headers = tableCells(line);
      const align = tableCells(lines[index + 1]).map(cell => cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left') as ('left' | 'center' | 'right')[];
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) rows.push(tableCells(lines[index++]));
      blocks.push({type: 'table', headers, rows, align, label: headings.at(-1)?.text ?? '专题表格'});
      continue;
    }
    const list = line.match(listPattern);
    if (list) {
      const ordered = list[1] !== undefined;
      const items: {text: string; value?: number}[] = [];
      while (index < lines.length) {
        const item = lines[index].match(listPattern);
        if (!item || (item[1] !== undefined) !== ordered) break;
        items.push({text: item[2], ...(ordered ? {value: Number(item[1])} : {})});
        index++;
      }
      blocks.push({type: 'list', ordered, items});
      continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !startsBlock(index)) paragraph.push(lines[index++]);
    blocks.push({type: 'paragraph', text: paragraph.join('\n')});
  }
  return {blocks, headings};
}
