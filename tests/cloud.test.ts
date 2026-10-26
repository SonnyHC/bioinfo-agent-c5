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

test('provider selection uses separate official endpoints and compatible request fields', async () => {
  const endpoints = {openai:'https://api.openai.com/v1/chat/completions',qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'};
  for (const [provider, endpoint] of Object.entries(endpoints)) {
    let sent: Record<string,unknown> = {};
    const result = await chatRequest({provider,apiKey:'test-key-only',model:'test-model',messages:[{role:'user',content:'test'}]}, async (url:string,init:RequestInit)=> {
      assert.equal(url,endpoint); assert.equal(init.redirect,'error');
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'test'}}]}));
    });
    assert.equal(result.status,200);
    if(provider === 'openai') {assert.equal(sent.max_completion_tokens,4096);assert.equal(sent.max_tokens,undefined);}
    if(provider === 'qwen') {assert.equal(sent.enable_thinking,false);assert.equal(sent.max_tokens,4096);}
  }
  const rejected = await chatRequest({provider:'http://127.0.0.1'},()=>{throw new Error('unexpected request');});
  assert.equal(rejected.status,400);
});

test('model tools can draft a local plan but never execute or install without the user', async () => {
  const {executeTool,toolDefinitions} = await import('../web/src/agent-tools.ts');
  const originalFetch = globalThis.fetch;
  const originalSession = Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  const memory = new Map([['bioinfobuddy-companion-token','test-pair-token']]);
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)||null,removeItem:(key:string)=>memory.delete(key)}});
  const calls:string[] = [];
  const recordId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  try {
    globalThis.fetch = async (url,init) => {
      calls.push(String(url));
      assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-pair-token');
      if(String(url).endsWith('/plans')) {
        assert.deepEqual(JSON.parse(String(init?.body)),{datasetId:recordId,template:'box',params:{layout:'wide',missing:'error',valueColumns:['Control','Treatment']}});
        return new Response(JSON.stringify({id:recordId,status:'draft'}));
      }
      throw new Error('Unexpected route');
    };
    assert(!toolDefinitions.some(tool=>/run_approved|install|approve/.test(tool.function.name)));
    const result = await executeTool('bio_preview_plan',{datasetId:recordId,template:'box',params:{layout:'wide',missing:'error',valueColumns:['Control','Treatment']}},new AbortController().signal) as {status:string;workbenchUrl:string};
    assert.equal(result.status,'draft'); assert.equal(result.workbenchUrl,`/workbench?plan=${recordId}`);
    await assert.rejects(executeTool('bio_run_approved_plan',{planId:recordId},new AbortController().signal),/没有这个工具/);
    await assert.rejects(executeTool('bio_preview_plan',{datasetId:'../../file',template:'box',params:{}},new AbortController().signal),/记录 ID/);
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=originalFetch; if(originalSession)Object.defineProperty(globalThis,'sessionStorage',originalSession);else Reflect.deleteProperty(globalThis,'sessionStorage');}
});

test('a rejected model API key does not discard the local assistant pairing', async () => {
  const {companionFetch,companionConnected} = await import('../web/src/companion.ts');
  const originalFetch=globalThis.fetch;
  const descriptors = ['sessionStorage','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  const memory = new Map([['bioinfobuddy-companion-token','paired-test-token']]);
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)||null,removeItem:(key:string)=>memory.delete(key)}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'API Key 无效'}),{status:401});
    await assert.rejects(companionFetch('/chat',{method:'POST'}),/API Key/);
    assert.equal(companionConnected(),true,'provider error must preserve pairing');
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'请连接本地助手。',code:'COMPANION_AUTH_REQUIRED'}),{status:401});
    await assert.rejects(companionFetch('/chat',{method:'POST'}),/连接本地助手/);
    assert.equal(companionConnected(),false,'expired helper credentials must be cleared');
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,descriptor] of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  }
});
