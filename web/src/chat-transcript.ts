import type { Message, ToolEvent } from './agent-loop';
import { isChatFileName, makeFileEdit, type ChatFileEdit } from './chat-files';
import { parseAssistantContent } from './chat-text';

export type FileRow = ChatFileEdit & { state: 'running' | 'done' };

// Keep earlier turns' previews available after a new question moves the composer.
export function chatTranscript(messages: Message[], events: ToolEvent[]) {
  const contents = new Map<string, string>();
  const byId = new Map(events.map(event => [event.id, event]));
  const archived = new Map<number, FileRow[]>();
  const prose = new Map<number, ReturnType<typeof parseAssistantContent>['parts']>();
  const rows = new Map<string, FileRow>();
  const before = new Map<string, string | undefined>();
  const savedByTool = new Set<string>();

  function record(name: string, content: string, state: FileRow['state']) {
    if (!before.has(name)) before.set(name, contents.get(name));
    rows.set(name, { ...makeFileEdit(name, content, before.get(name)), state });
    if (state === 'done') contents.set(name, content);
  }

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      if (rows.size) archived.set(index - 1, [...rows.values()]);
      rows.clear();
      before.clear();
      savedByTool.clear();
    }
    if (message.role !== 'assistant') return;
    const parsed = parseAssistantContent(message.content ?? '');
    prose.set(index, parsed.parts);
    for (const call of message.tool_calls ?? []) {
      const event = byId.get(call.id);
      if (event?.file && event.state !== 'error') {
        record(event.file.name, event.file.content, event.state);
        savedByTool.add(event.file.content.trimEnd());
      }
    }
    // Some models echo a script they have just saved in the same turn.
    for (const file of parsed.files) {
      if (savedByTool.has(file.content.trimEnd())) continue;
      const name = isChatFileName(file.name) ? file.name : 'script.txt';
      record(name, file.content.replaceAll('\0', ''), 'done');
    }
  });
  return { prose, byId, archived, latest: [...rows.values()], fileContents: Object.fromEntries(contents) };
}

// A reload can interrupt the second tool in a batch after the first file was saved.
export function recoverToolCalls(messages: Message[]): Message[] {
  const recovered: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    recovered.push(message);
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
    const results = new Map<string | undefined, Message>();
    while (messages[i + 1]?.role === 'tool') {
      const result = messages[++i];
      results.set(result.tool_call_id, result);
    }
    for (const call of message.tool_calls) {
      recovered.push(results.get(call.id) ?? {
        role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: '上次操作已中断' }),
      });
    }
  }
  return recovered;
}
