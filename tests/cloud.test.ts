import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequest } from '../serverless/chat-handler.mjs';
import { runAgent, type Message, type ToolEvent } from '../web/src/agent-loop.ts';
import { isChatFileName, makeFileEdit, writeChatFileTool } from '../web/src/chat-files.ts';
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

test('chat files count actual changed lines, preserve downloadable text and validate file names', () => {
  const content = 'same\r\nnew\r\nsame\r\n';
  assert.deepEqual(makeFileEdit('脚本.R', content, 'same\nold\nsame\nlast'), {
    name: '脚本.R', content, added: 1, removed: 2,
  });
  assert.equal(makeFileEdit('示例.R', '\n\n').added, 2);
  assert.equal(makeFileEdit('a.py', '', 'a\n').removed, 1);
  assert.equal(makeFileEdit('a.py', 'a\r\nb', 'a\nb\n').added, 0);
  for (const name of ['../demo.R', 'a/b.py', 'a\\b.py', 'con.txt', '.', 'file.R ', '', 'bad\0.js']) {
    assert.equal(isChatFileName(name), false);
    assert.throws(() => makeFileEdit(name, 'x'), /文件名/);
  }
  assert.throws(() => makeFileEdit('a.R', 42), /完整文本/);
});

test('file tool publishes durable versions, real edit counts and unique status IDs', async () => {
  const events: ToolEvent[] = [];
  const source = { 'analysis.R':'a\nb\nc\n' };
  const write = (name: string, content: string) => ({
    id:'reused-id', type:'function' as const, function:{name:writeChatFileTool,arguments:JSON.stringify({name,content})},
  });
  let rounds = 0;
  const result = await runAgent({
    messages:[{role:'user',content:'修改脚本'}], fileContents:source, signal:new AbortController().signal,
    request:async () => ++rounds === 1 ? {
      role:'assistant',content:null,tool_calls:[write('analysis.R','a\nB\nc'),write('analysis.R','a\nB\nc\nd'),write('../bad.R','x')],
    } : {role:'assistant',content:'脚本已更新。'},
    execute:async () => assert.fail('Conversation files must stay in the chat'),
    changed:async (_messages, event) => {if (event) events.push(event);},
  });
  assert.deepEqual(events.map(event => event.state), ['running','done','running','done','error']);
  assert.deepEqual(events[0].file, {name:'analysis.R',content:'a\nB\nc',added:1,removed:1});
  assert.deepEqual(events[3].file, {name:'analysis.R',content:'a\nB\nc\nd',added:1,removed:0});
  const responses = result.filter(message => message.role === 'tool');
  assert.equal(new Set(responses.map(message => message.tool_call_id)).size, 3);
  assert.deepEqual(JSON.parse(responses[1].content!), {name:'analysis.R',added:1,removed:0});
  assert.match(responses[2].content!, /文件名/);
  assert.deepEqual(source, {'analysis.R':'a\nb\nc\n'});
});

test('cancelling from a file preview leaves no completed version', async () => {
  const controller = new AbortController();
  const events: ToolEvent[] = [];
  await assert.rejects(runAgent({
    messages:[], signal:controller.signal,
    request:async () => ({role:'assistant',content:null,tool_calls:[{
      id:'cancel',type:'function',function:{name:writeChatFileTool,arguments:'{"name":"analysis.R","content":"x"}'},
    }]}),
    execute:async () => assert.fail(),
    changed:async (_messages,event) => {
      if (event) events.push(event);
      if (event?.state === 'running') controller.abort();
    },
  }));
  assert.deepEqual(events.map(event => event.state), ['running','error']);
  assert.equal(events[1].detail, '已停止');
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

test('website tools inspect stored data but retired plotting tools cannot create plans or run', async () => {
  const {executeTool,toolDefinitions} = await import('../web/src/agent-tools.ts');
  const originalFetch = globalThis.fetch;
  const recordId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await save('datasets',{id:recordId,name:'test.csv',createdAt:'2026-10-30',file:new Blob(['group,value\nA,1']),rows:1,columns:[{name:'value',type:'number',missing:0}],preview:[{group:'A',value:1}],sha256:'test-hash'});
  const plansBefore = await list('plans');
  let calls = 0;
  try {
    globalThis.fetch = async () => {calls++;throw new Error('retired tools must not contact the analysis service');};
    assert(!toolDefinitions.some(tool=>/preview_plan|run_approved|install|approve/.test(tool.function.name)));
    const inspected = await executeTool('bio_inspect_dataset',{datasetId:recordId},new AbortController().signal) as {rows:number};
    assert.equal(inspected.rows,1);
    await assert.rejects(executeTool('bio_preview_plan',{datasetId:recordId,chart:'box',layout:'long',missing:'error',group:'group',y:'value'},new AbortController().signal),/表格绘图模块已移除/);
    await assert.rejects(executeTool('bio_run_approved_plan',{planId:recordId},new AbortController().signal),/没有这个工具/);
    await assert.rejects(executeTool('bio_inspect_dataset',{datasetId:'../../file'},new AbortController().signal),/记录 ID/);
    assert.deepEqual(await list('plans'),plansBefore);
    assert.equal(calls,0);
    assert.deepEqual(await executeTool('bio_open_workbench',{},new AbortController().signal),{workbenchUrl:'/?view=omics'});
    const retired = await executeTool('bio_open_workbench',{planId:recordId},new AbortController().signal) as {workbenchUrl:string;note:string};
    assert.equal(retired.workbenchUrl,'/?view=omics');assert.match(retired.note,/旧方案不能/);
    assert.deepEqual(await executeTool('bio_open_workbench',{runId:recordId},new AbortController().signal),{workbenchUrl:`/?view=history&run=${recordId}`});
  } finally {globalThis.fetch=originalFetch;}
});

test('main navigation restores legacy plan/run links and preserves chat dataset context', async () => {
  const {safeAppLink,appRoute,messageParts} = await import('../web/src/navigation.ts');
  const recordId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert.equal(safeAppLink(`/workbench?run=${recordId}`),`/?view=analysis&run=${recordId}`);
  assert.equal(safeAppLink(`/workbench/?plan=${recordId}`),`/?view=analysis&plan=${recordId}`);
  assert.deepEqual(appRoute(`/?dataset=${recordId}`),{view:'chat',request:{dataset:recordId}});
  assert.deepEqual(appRoute(`/?view=analysis&dataset=${recordId}`),{view:'chat',request:{dataset:recordId}});
  assert.deepEqual(appRoute('/?view=analysis'),{view:'omics',request:{}});
  assert.deepEqual(appRoute(`/workbench?run=${recordId}`),{view:'history',request:{run:recordId}});
  assert.deepEqual(appRoute(`/?view=analysis&plan=${recordId}`),{view:'omics',request:{plan:recordId}});
  assert.deepEqual(appRoute('/?view=environments'),{view:'environments',request:{}});
  assert.equal(safeAppLink('/?view=environments'),'/?view=environments');
  assert.equal(safeAppLink('/?view=connection'),undefined);
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

test('retired synthetic examples are unavailable and never contact the analysis service', async () => {
  const { api } = await import('../web/src/api.ts');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; throw new Error('unexpected network request'); };
    for (const name of ['wide', 'long', 'expression']) {
      await assert.rejects(api(`/examples/${name}`, {method:'POST'}), /不支持此操作/);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('cancelling while an inspection response is decoded does not save an imported dataset', async () => {
  const { importDataset } = await import('../web/src/api.ts');
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const before = (await list<{id:string}>('datasets')).map(item=>item.id).sort();
  let inspected = false;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), '/api/analysis');
      assert.equal(JSON.parse(String(init?.body)).action, 'inspect');
      const response = new Response('{}');
      response.json = async () => {
        inspected = true;
        controller.abort();
        return {rows:1,columns:[{name:'value',type:'number',missing:0}],preview:[{value:1}],sha256:'cancelled-inspection'};
      };
      return response;
    };
    await assert.rejects(
      importDataset(new File(['value\n1\n'], 'cancelled-inspection.csv', {type:'text/csv'}), controller.signal),
      error => error instanceof Error && error.name === 'AbortError',
    );
    assert.equal(inspected, true);
    assert.deepEqual((await list<{id:string}>('datasets')).map(item=>item.id).sort(), before);
  } finally { globalThis.fetch = originalFetch; }
});
