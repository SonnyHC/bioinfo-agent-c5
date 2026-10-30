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
  assert.equal(events.at(-1)?.url, '/?view=analysis&plan=real-plan');
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

test('website tools inspect stored data and draft but cannot approve or run', async () => {
  const {executeTool,toolDefinitions} = await import('../web/src/agent-tools.ts');
  const originalFetch = globalThis.fetch;
  const recordId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await save('datasets',{id:recordId,name:'test.csv',createdAt:'2026-10-30',file:new Blob(['group,value\nA,1']),rows:1,columns:[{name:'value',type:'number',missing:0}],preview:[{group:'A',value:1}],sha256:'test-hash'});
  const calls:string[] = [];
  try {
    globalThis.fetch = async (url,init) => {
      calls.push(String(url)); assert.equal(String(url),'/api/analysis');
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.action,'preview');assert.equal(sent.config.chart,'box');
      return new Response(JSON.stringify({inputRows:1,outputRows:1,preview:[],steps:[]}));
    };
    assert(!toolDefinitions.some(tool=>/run_approved|install|approve/.test(tool.function.name)));
    const inspected = await executeTool('bio_inspect_dataset',{datasetId:recordId},new AbortController().signal) as {rows:number};
    assert.equal(inspected.rows,1);assert.equal(calls.length,0);
    const result = await executeTool('bio_preview_plan',{datasetId:recordId,chart:'box',layout:'long',missing:'error',group:'group',y:'value'},new AbortController().signal) as {id:string;status:string;workbenchUrl:string};
    assert.equal(result.status,'draft');assert.equal(result.workbenchUrl,`/?view=analysis&plan=${result.id}`);
    assert.equal((await read<{status:string}>('plans',result.id)).status,'draft');
    await assert.rejects(executeTool('bio_run_approved_plan',{planId:recordId},new AbortController().signal),/没有这个工具/);
    await assert.rejects(executeTool('bio_preview_plan',{datasetId:'../../file'},new AbortController().signal),/记录 ID/);
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=originalFetch;}
});

test('main navigation restores legacy plan/run links and preserves chat dataset context', async () => {
  const {safeAppLink,appRoute,messageParts} = await import('../web/src/navigation.ts');
  const recordId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert.equal(safeAppLink(`/workbench?run=${recordId}`),`/?view=analysis&run=${recordId}`);
  assert.equal(safeAppLink(`/workbench/?plan=${recordId}`),`/?view=analysis&plan=${recordId}`);
  assert.deepEqual(appRoute(`/?dataset=${recordId}`),{view:'chat',request:{dataset:recordId}});
  assert.deepEqual(appRoute(`/?view=analysis&dataset=${recordId}`),{view:'analysis',request:{dataset:recordId}});
  assert.deepEqual(appRoute('/?view=environments'),{view:'chat',request:{}});
  for(const view of ['connection','environments']) assert.equal(safeAppLink('/?view='+view),undefined);
  assert.deepEqual(appRoute('/?view=skills'),{view:'skills',request:{}});
  assert.equal(safeAppLink('/?view=tutorial'),'/?view=tutorial');
  assert.deepEqual(appRoute('/?view=tutorial'),{view:'tutorial',request:{}});
  assert.deepEqual(messageParts(`查看 [原结果](/workbench?run=${recordId}) 和 [历史](/?view=history)`),[
    {text:'查看 '},{text:'原结果',href:`/?view=analysis&run=${recordId}`},{text:' 和 '},{text:'历史',href:'/?view=history'},{text:''},
  ]);
  for(const unsafe of ['//evil.example','/\\evil.example','/workbench/cloud','/workbench?next=https://evil.example','/?view=not-a-view','/?view=analysis&plan=../../secret','/?view=analysis&run=one&run=two','/api/chat','/?view=analysis#attack','https://bioinfobuddy.com.cn/?view=analysis']) assert.equal(safeAppLink(unsafe),undefined,unsafe);
  assert.deepEqual(messageParts('[unsafe](//evil.example)'),[{text:''},{text:'[unsafe](//evil.example)'},{text:''}]);
});

test('agent result links accept the main shell and reject non-app destinations', async () => {
  for(const [url,expected] of [['/?view=analysis&run=real-run','/?view=analysis&run=real-run'],['/?view=history','/?view=history'],['/workbench/cloud',undefined],['//evil.example',undefined]]) {
    let rounds=0; const events:ToolEvent[]=[];
    await runAgent({messages:[{role:'user',content:'result'}],signal:new AbortController().signal,
      request:async()=>++rounds===1?{role:'assistant',content:null,tool_calls:[{id:'link',type:'function',function:{name:'open',arguments:'{}'}}]}:{role:'assistant',content:'ready'},
      execute:async()=>({workbenchUrl:url}),changed:async(_messages,event)=>{if(event)events.push({...event});},
    });
    assert.equal(events.at(-1)?.url,expected);
  }
});
