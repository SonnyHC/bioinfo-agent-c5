import { diffArrays } from 'diff';

export const writeChatFileTool = 'bio_write_chat_file';

export interface ChatFileEdit {
  name: string;
  content: string;
  added: number;
  removed: number;
}

export function isChatFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && new TextEncoder().encode(value).length <= 255
    && !/[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(value)
    && !/[. ]$/u.test(value) && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(value);
}

function lines(content: string): string[] {
  if (content === '') return [];
  const result = content.split(/\r\n|\r|\n/);
  if (result.at(-1) === '') result.pop();
  return result;
}

export function makeFileEdit(name: unknown, content: unknown, previousContent = ''): ChatFileEdit {
  if (!isChatFileName(name)) throw new Error('请为脚本提供可下载的文件名，例如 analysis.R。');
  if (typeof content !== 'string' || content.includes('\0')) throw new Error('请提供脚本的完整文本。');
  let added = 0;
  let removed = 0;
  if (content !== previousContent) {
    for (const change of diffArrays(lines(previousContent), lines(content))) {
      if (change.added) added += change.count;
      if (change.removed) removed += change.count;
    }
  }
  return { name, content, added, removed };
}
