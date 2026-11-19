import { safeAppLink } from './navigation';
import { isChatFileName, makeFileEdit, writeChatFileTool, type ChatFileEdit } from './chat-files';
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string; provider?: string; model?: string }
export interface ToolEvent { id: string; name: string; state: 'running' | 'done' | 'error'; detail?: string; url?: string; file?: ChatFileEdit }

function parseArguments(call: ToolCall): Record<string, unknown> {
  const args = JSON.parse(call.function.arguments);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象。');
  return args;
}

export async function runAgent(options: {
  messages: Message[];
  fileContents?: Readonly<Record<string, string>>;
  request: (messages: Message[]) => Promise<Message>;
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  changed: (messages: Message[], event?: ToolEvent) => Promise<void>;
  signal: AbortSignal;
}) {
  const messages = [...options.messages];
  const fileContents = new Map(Object.entries(options.fileContents ?? {}));
  const callIds = new Set(messages.flatMap(message => message.tool_calls?.map(call => call.id) ?? []));
  for (let round = 0; round < 6; round++) {
    options.signal.throwIfAborted();
    const answer = await options.request(messages);
    options.signal.throwIfAborted();
    if (answer.role !== 'assistant' || (answer.content !== null && typeof answer.content !== 'string')) throw new Error('模型返回格式无效，请重试。');
    const requestedCalls = answer.tool_calls ?? [];
    if (!Array.isArray(requestedCalls) || requestedCalls.length > 6 || requestedCalls.some(call => !call || typeof call.id !== 'string' || !call.id || !call.function || typeof call.function.arguments !== 'string')) throw new Error('模型工具调用格式无效，请重试。');
    // Some providers restart their tool-call numbering on each model request.
    const calls = requestedCalls.map(call => {
      const id = callIds.has(call.id) ? crypto.randomUUID() : call.id;
      callIds.add(id);
      return id === call.id ? call : { ...call, id };
    });
    messages.push(calls.length ? { ...answer, tool_calls: calls } : answer);
    if (!calls.length) { await options.changed([...messages]); return messages; }
    // Always finish all call/result pairs, including aborted or invalid calls,
    // so a persisted conversation can be resumed with a valid API transcript.
    for (const call of calls) {
      const event: ToolEvent = { id: call.id, name: call.function.name, state: 'running' };
      let result: unknown;
      let args: Record<string, unknown> = {};
      let argumentError: unknown;
      try {
        options.signal.throwIfAborted();
        args = parseArguments(call);
        if (call.function.name === writeChatFileTool) {
          const previous = isChatFileName(args.name) ? fileContents.get(args.name) : undefined;
          event.file = makeFileEdit(args.name, args.content, previous);
        }
      } catch (error) { argumentError = error; }
      if (!argumentError) await options.changed([...messages], { ...event });
      try {
        options.signal.throwIfAborted();
        if (argumentError) throw argumentError;
        if (event.file) {
          const { name, content, added, removed } = event.file;
          fileContents.set(name, content);
          result = { name, added, removed };
        } else {
          result = await options.execute(call.function.name, args);
        }
        event.state = 'done';
        if (result && typeof result === 'object' && 'workbenchUrl' in result && typeof result.workbenchUrl === 'string') event.url = safeAppLink(result.workbenchUrl);
      } catch (error) {
        event.state = 'error';
        event.detail = options.signal.aborted ? '已停止' : error instanceof Error ? error.message : '工具执行失败。';
        result = { error: event.detail };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      await options.changed([...messages], event);
    }
  }
  messages.push({ role: 'assistant', content: '已达到本轮工具调用上限，分析可能尚未完成。请查看已有方案或结果，再继续对话。' });
  await options.changed([...messages]);
  return messages;
}
