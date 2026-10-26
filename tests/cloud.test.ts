import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequest } from '../serverless/chat-handler.mjs';
import { runAgent, type Message, type ToolEvent } from '../web/src/agent-loop.ts';
import 'fake-indexeddb/auto';
import { save, read, list } from '../web/src/storage.ts';

test('browser storage preserves source files, binary results and independent history snapshots', async () => {
  const file = new Blob(['group,value\nControl,3'], {type: 'text/csv'});
  await save('datasets', { id: 'data-test', createdAt: '2026-10-26', file });
  const stored = await read<{file: Blob}>('datasets', 'data-test');
  assert.equal(await stored.file.text(), await file.text());
  const zip = new Blob([new Uint8Array([80, 75, 3, 4, 0, 255])], {type:'application/zip'});
  await save('runs', {id:'run-test', createdAt:'2026-10-26', zip});
  assert.deepEqual(await (await read<{zip:Blob}>('runs','run-test')).zip.arrayBuffer(), await zip.arrayBuffer());
  const chat = {id:'chat-test', createdAt:'2026-10-26', messages:[{role:'user',content:'original'}]};
  await save('chats', chat);
  chat.messages[0].content = 'unsaved change';
  assert.equal((await read<typeof chat>('chats', chat.id)).messages[0].content, 'original');
  await save('chats', {id:'older-test', createdAt:'2026-10-25', messages:[]});
  assert.deepEqual((await list<typeof chat>('chats')).map(item=>item.id), ['chat-test','older-test']);
  await assert.rejects(read('datasets','absent'), /找不到/);
});

test('model proxy pins the official destination and never echoes provider error bodies', async () => {
  let requestUrl = '';
  const body = { apiKey: 'test-only-key', model: 'deepseek-chat', messages: [{role: 'user', content: 'hello'}], baseUrl: 'http://private.invalid' };
  const failed = await chatRequest(body, async (url: string) => {
    requestUrl = url;
    return new Response(JSON.stringify({ error: {message: 'test-only-key'} }), { status: 401 });
  });
  assert.equal(requestUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(failed.status, 401);
  assert(!JSON.stringify(failed.data).includes('test-only-key'));
  const invalid = await chatRequest({...body, apiKey: 'key\nInjected: yes'}, () => { throw new Error('must not call'); });
  assert.equal(invalid.status, 400);
});

test('model proxy preserves tool calls needed by the browser agent', async () => {
  const message = { role: 'assistant', content: null, tool_calls: [{id: 'c1', type: 'function', function: {name: 'bio_list_datasets', arguments: '{}'}}] };
  const result = await chatRequest({apiKey:'test-key-123', model:'deepseek-chat', messages:[{role:'user',content:'list'}]}, async () => new Response(JSON.stringify({choices:[{message,finish_reason:'tool_calls'}]})));
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.message, message);
});

test('agent executes actual tools and sends their results back before answering', async () => {
  const events: ToolEvent[] = [];
  let requests = 0;
  const messages = await runAgent({
    messages: [{role:'user',content:'plot'}], signal: new AbortController().signal,
    request: async transcript => {
      requests++;
      if (requests === 1) return {role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'bio_preview_plan',arguments:'{"datasetId":"source"}'}}]};
      assert.equal(transcript.at(-1)?.role, 'tool');
      assert.equal(JSON.parse(transcript.at(-1)!.content!).status, 'draft');
      return {role:'assistant',content:'请确认方案。'};
    },
    execute: async (name, args) => { assert.equal(name,'bio_preview_plan'); assert.equal(args.datasetId,'source'); return {status:'draft',workbenchUrl:'/workbench?plan=real-plan'}; },
    changed: async (_messages, event) => { if(event) events.push({...event}); },
  });
  assert.equal(requests, 2);
  assert.equal(messages.at(-1)?.content, '请确认方案。');
  assert.equal(events.at(-1)?.url, '/workbench?plan=real-plan');
});

test('stopping a multi-tool batch leaves complete call/result pairs for resuming', async () => {
  const controller = new AbortController();
  let persisted: Message[] = [];
  await assert.rejects(runAgent({
    messages: [{role:'user',content:'inspect'}], signal: controller.signal,
    request: async () => ({role:'assistant',content:null,tool_calls:['one','two'].map(id => ({id,type:'function' as const,function:{name:'inspect',arguments:'{}'}}))}),
    execute: async () => { controller.abort(); return {rows: 3}; },
    changed: async messages => { persisted = messages; },
  }));
  assert.deepEqual(persisted.filter(m => m.role === 'tool').map(m => m.tool_call_id), ['one','two']);
  assert.match(persisted.at(-1)!.content!, /已停止/);
});

test('invalid tool arguments become tool errors and never execute code', async () => {
  let rounds = 0, invoked = false;
  const result = await runAgent({
    messages: [{role:'user',content:'inspect'}], signal: new AbortController().signal,
    request: async () => ++rounds === 1 ? {role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'inspect',arguments:'null'}}]} : {role:'assistant',content:'请重试。'},
    execute: async () => { invoked = true; }, changed: async () => {},
  });
  assert.equal(invoked, false);
  assert.match(result.find(m => m.role === 'tool')!.content!, /参数必须是对象/);
});
