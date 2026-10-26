export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string }
export interface ToolEvent { id: string; name: string; state: 'running' | 'done' | 'error'; detail?: string; url?: string }

export async function runAgent(options: {
  messages: Message[];
  request: (messages: Message[]) => Promise<Message>;
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  changed: (messages: Message[], event?: ToolEvent) => Promise<void>;
  signal: AbortSignal;
}) {
  const messages = [...options.messages];
  for (let round = 0; round < 6; round++) {
    options.signal.throwIfAborted();
    const answer = await options.request(messages);
    if (answer.role !== 'assistant' || (answer.content !== null && typeof answer.content !== 'string')) throw new Error('模型返回格式无效，请重试。');
    const calls = answer.tool_calls ?? [];
    if (!Array.isArray(calls) || calls.length > 6 || calls.some(call => !call.id || !call.function || typeof call.function.arguments !== 'string')) throw new Error('模型工具调用格式无效，请重试。');
    messages.push(answer);
    if (!calls.length) { await options.changed([...messages]); return messages; }
    // Always finish all call/result pairs, including aborted or invalid calls,
    // so a persisted conversation can be resumed with a valid API transcript.
    for (const call of calls) {
      const event: ToolEvent = { id: call.id, name: call.function.name, state: 'running' };
      await options.changed([...messages], event);
      let result: unknown;
      try {
        options.signal.throwIfAborted();
        const args = JSON.parse(call.function.arguments);
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象。');
        result = await options.execute(call.function.name, args);
        event.state = 'done';
        if (result && typeof result === 'object' && 'workbenchUrl' in result && typeof result.workbenchUrl === 'string' && /^\/workbench(?:\?|$)/.test(result.workbenchUrl)) event.url = result.workbenchUrl;
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
