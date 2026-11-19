import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, ToolEvent } from '../web/src/agent-loop';
import { makeFileEdit, writeChatFileTool } from '../web/src/chat-files';
import { chatTranscript, recoverToolCalls } from '../web/src/chat-transcript';

const call = (id: string) => ({ id, type: 'function' as const, function: { name: writeChatFileTool, arguments: '{}' } });

test('a turn reports net changes from the previous saved script and retains older versions', () => {
  const messages: Message[] = [
    { role: 'user', content: '写一个脚本' },
    { role: 'assistant', content: '```r\na <- 1\nb <- 2\n```' },
    { role: 'user', content: '改一下' },
    { role: 'assistant', content: null, tool_calls: [call('first'), call('last')] },
    { role: 'assistant', content: '已更新。\n\n```r\na <- 1\nb <- 3\n```' },
  ];
  const events: ToolEvent[] = [
    { id: 'first', name: writeChatFileTool, state: 'done', file: makeFileEdit('analysis.R', 'a <- 1\nc <- 5\nb <- 3\n') },
    { id: 'last', name: writeChatFileTool, state: 'done', file: makeFileEdit('analysis.R', 'a <- 1\nb <- 3\n') },
  ];
  const view = chatTranscript(messages, events);
  assert.equal(view.archived.get(1)?.[0].content, 'a <- 1\nb <- 2\n');
  assert.deepEqual(view.latest.map(({ name, added, removed }) => ({ name, added, removed })), [{ name: 'analysis.R', added: 1, removed: 1 }]);
  assert.deepEqual(view.prose.get(4), [{ text: '已更新。' }]);
  const next = chatTranscript([...messages, { role: 'user', content: '谢谢' }], events);
  assert.deepEqual(next.latest, []);
  assert.deepEqual(next.archived.get(4), view.latest);
});

test('a reload keeps completed files and closes interrupted calls in the original order', () => {
  const partial: Message[] = [
    { role: 'user', content: '写两个文件' },
    { role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
    { role: 'tool', tool_call_id: 'a', content: '{"name":"first.R"}' },
  ];
  const recovered = recoverToolCalls(partial);
  assert.deepEqual(recovered.slice(0, 3), partial);
  assert.equal(recovered[3].tool_call_id, 'b');
  assert.match(recovered[3].content!, /已中断/);
  assert.deepEqual(recoverToolCalls(recovered), recovered);
  const view = chatTranscript(recovered, [
    { id: 'a', name: writeChatFileTool, state: 'done', file: makeFileEdit('first.R', 'x <- 1') },
    { id: 'b', name: writeChatFileTool, state: 'error', file: makeFileEdit('second.R', 'y <- 2') },
  ]);
  assert.deepEqual(view.fileContents, { 'first.R': 'x <- 1' });
});
