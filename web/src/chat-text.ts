import { Lexer, type MarkedToken, type Token } from 'marked';
import { isChatFileName } from './chat-files';
import { safeAppLink } from './navigation';

export interface AssistantTextPart { text: string; href?: string }
export interface ExtractedChatFile { name: string; content: string }
export interface AssistantContent { text: string; parts: AssistantTextPart[]; files: ExtractedChatFile[] }

const defaultNames: Record<string, string> = {
  r: 'analysis.R', rscript: 'analysis.R', py: 'analysis.py', python: 'analysis.py', python3: 'analysis.py',
  sh: 'commands.sh', shell: 'commands.sh', bash: 'commands.sh', zsh: 'commands.zsh', console: 'commands.sh',
  powershell: 'commands.ps1', js: 'script.js', javascript: 'script.js', ts: 'script.ts', typescript: 'script.ts',
  sql: 'query.sql', json: 'data.json', yaml: 'config.yaml', yml: 'config.yml', toml: 'config.toml',
  html: 'index.html', css: 'style.css', diff: 'changes.diff', patch: 'changes.patch',
  rmd: 'analysis.Rmd', qmd: 'analysis.qmd', md: 'notes.md', markdown: 'notes.md',
  csv: 'data.csv', tsv: 'data.tsv', text: 'snippet.txt', txt: 'snippet.txt',
};

function inferredLanguage(line: string): string | undefined {
  const source = line.trimStart();
  if (/^(?:library\s*\(|require\s*\(|[\w.]+(?:(?:\$|::)[\w.]+)*\s*<-|(?:[\w.]+::)?(?:ggplot|read\.(?:csv|table)|data\.frame|install\.packages)\s*\()/.test(source)) return 'r';
  if (/^(?:import\s+[\w.]+(?:\s+as\s+\w+)?\s*$|from\s+[\w.]+\s+import\s|(?:async\s+)?def\s+\w+\(|(?:print|pd\.\w+|sc\.\w+|plt\.\w+)\s*\()/.test(source)) return 'python';
  if (/^(?:(?:sudo\s+)?(?:pip3?|python3?|Rscript|conda|mamba|npm|git|curl|wget)\s+\S|#!\s*\/.*\b(?:sh|bash|zsh)\b)/.test(source)) return 'sh';
  if (/^(?:(?:export\s+)?(?:const|let|var)\s+\w+\s*=|console\.\w+\(|function\s+\w+\()/.test(source)) return 'js';
  if (/^(?:SELECT\s+.+\s+FROM\s|CREATE\s+TABLE\s|INSERT\s+INTO\s)/i.test(source)) return 'sql';
  return undefined;
}

function inlineLanguage(text: string): string | undefined {
  const known = inferredLanguage(text);
  if (known) return known;
  // Inline identifiers such as nFeature_RNA belong in the explanation. Calls,
  // assignments and shell invocations belong with the downloadable examples.
  if (/^(?:[\w.]+::)?[\w.]+\([^]*\)\s*;?$/.test(text)
    || /^[\w.$[\]'"-]+\s*(?:<-|=(?!=))\s*\S/.test(text)) return 'text';
  if (/^(?:ls|cd|echo|mkdir|head|tail|awk|sed|grep)\s+\S/.test(text)) return 'sh';
  return undefined;
}

function namedFile(text: string): string | undefined {
  const name = text.trim();
  return /\.[\p{L}\d]{1,10}$/u.test(name) && isChatFileName(name) ? name : undefined;
}

function textPart(text: string): AssistantTextPart[] {
  return text ? [{ text }] : [];
}

function joined(groups: AssistantTextPart[][], separator: string): AssistantTextPart[] {
  const result: AssistantTextPart[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    if (result.length) result.push({ text: separator });
    result.push(...group);
  }
  return result;
}

// Consume Markdown tokens as data. Only local routes ever become interactive links.
export function parseAssistantContent(raw: string): AssistantContent {
  const files: ExtractedChatFile[] = [];
  const used = new Set<string>();

  function addFile(content: string, language: string, suggested?: string): string {
    const base = suggested || (Object.hasOwn(defaultNames, language) ? defaultNames[language] : 'snippet.txt');
    let name = base;
    const extension = base.lastIndexOf('.');
    for (let i = 2; used.has(name); i++) {
      name = base.slice(0, extension) + '-' + i + base.slice(extension);
      if (!isChatFileName(name)) name = 'snippet-' + i + base.slice(extension);
    }
    files.push({ name, content });
    used.add(name);
    return name;
  }

  function inline(tokens: Token[]): AssistantTextPart[] {
    return (tokens as MarkedToken[]).flatMap((token): AssistantTextPart[] => {
      switch (token.type) {
        case 'strong': case 'em': case 'del': return inline(token.tokens);
        case 'codespan': {
          const language = inlineLanguage(token.text);
          return textPart(language ? addFile(token.text, language) : token.text);
        }
        case 'link': case 'image': {
          const label = inline(token.tokens).map(part => part.text).join('') || token.href;
          const href = safeAppLink(token.href);
          if (href && token.type === 'link') return [{ text: label, href }];
          const showUrl = /^https?:\/\//i.test(token.href) && label !== token.href && 'https://' + label !== token.href;
          return textPart(showUrl ? label + ' (' + token.href + ')' : label);
        }
        case 'br': return textPart('\n');
        case 'checkbox': return textPart(token.checked ? '☑ ' : '☐ ');
        case 'html': return /^<br\b/i.test(token.text) ? textPart('\n') : [];
        case 'text': return token.tokens ? inline(token.tokens) : textPart(token.text);
        case 'escape': return textPart(token.text);
        default: return [];
      }
    });
  }

  function blocks(tokens: Token[], depth: number): AssistantTextPart[] {
    const groups: AssistantTextPart[][] = [];
    let previous = '';
    for (const token of tokens as MarkedToken[]) {
      switch (token.type) {
        case 'space': case 'def': case 'hr': continue;
        case 'code': {
          const info = (token.lang || '').trim();
          const first = info.replace(/^[{.]*/, '').split(/[\s,}]/)[0];
          const filename = /\b(?:file(?:name)?|title)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s}]+))/i.exec(info);
          const hint = filename?.slice(1).find(Boolean) ?? info.split(/\s+/)[1] ?? '';
          const prior = /^(?:文件(?:名)?\s*[:：]\s*)?[`*]*([^\s`*]+\.[\w]+)[`*]*\s*[:：]?$/.exec(previous);
          const explicit = namedFile(hint) ?? namedFile(first) ?? namedFile(prior?.[1] ?? '');
          const language = first.toLowerCase();
          const isProse = ['markdown', 'md', 'text', 'txt'].includes(language)
            || (!language && /^\s*[\p{Script=Han}].*[。！？]\s*$/mu.test(token.text));
          const wrappedMarkdown = ['markdown', 'md'].includes(language);
          if (depth < 3 && !explicit && (wrappedMarkdown || (isProse && !token.text.split('\n').some(inferredLanguage)))) {
            groups.push(blocks(Lexer.lex(token.text), depth + 1));
          } else {
            const guess = token.text.split('\n').map(inferredLanguage).find(Boolean);
            const content = token.text && /\n(?:[ \t]*(?:`{3,}|~{3,})[ \t]*)?\s*$/.test(token.raw) ? token.text + '\n' : token.text;
            addFile(content, language || guess || 'text', explicit);
          }
          break;
        }
        case 'list': {
          const entries = token.items.map((item, i) => {
            const children = blocks(item.tokens, depth);
            return children.length ? [{ text: token.ordered ? Number(token.start) + i + '. ' : '• ' }, ...children] : [];
          });
          groups.push(joined(entries, '\n'));
          break;
        }
        case 'blockquote': groups.push(blocks(token.tokens, depth)); break;
        case 'table': {
          const rows = [token.header, ...token.rows].map(row =>
            row.flatMap((cell, i) => [...(i ? textPart('\t') : []), ...inline(cell.tokens)]));
          groups.push(joined(rows, '\n'));
          break;
        }
        case 'paragraph': case 'text': {
          const lines = token.text.split('\n');
          if (!lines.some(inferredLanguage)) {
            groups.push(token.tokens ? inline(token.tokens) : textPart(token.text));
            break;
          }
          // Keep ordinary sentences on either side of an unfenced script.
          const prose: AssistantTextPart[][] = [];
          for (let i = 0; i < lines.length;) {
            const start = i++;
            const language = inferredLanguage(lines[start]);
            if (language) {
              while (i < lines.length && (inferredLanguage(lines[i]) || /^\s|^[\])}]/.test(lines[i]))) i++;
              addFile(lines.slice(start, i).join('\n'), language);
            } else {
              while (i < lines.length && !inferredLanguage(lines[i])) i++;
              prose.push(inline(Lexer.lexInline(lines.slice(start, i).join('\n'))));
            }
          }
          groups.push(joined(prose, '\n'));
          break;
        }
        case 'html':
          if (/^\s*<(?:script|style|pre|!doctype|html)\b/i.test(token.text)) addFile(token.text, 'html');
          else groups.push(textPart(token.text.replace(/<br\s*\/?>|<\/(?:p|div)>/gi, '\n').replace(/<[^>]*>/g, '').trim()));
          break;
        case 'heading': groups.push(inline(token.tokens)); break;
        default: groups.push(inline([token])); break;
      }
      previous = token.type === 'paragraph' || token.type === 'heading' ? token.text : '';
    }
    return joined(groups, '\n\n');
  }

  const parts: AssistantTextPart[] = [];
  for (const part of blocks(Lexer.lex(raw), 0)) {
    const last = parts.at(-1);
    if (last && last.href === part.href) last.text += part.text;
    else parts.push(part);
  }
  return { text: parts.map(part => part.text).join(''), parts, files };
}
