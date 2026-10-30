import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequest } from '../serverless/chat-handler.mjs';
import { requestModel } from '../web/src/model-api.ts';
import { providers, savedSettings, storeSettings } from '../web/src/model-settings.ts';
const base = {apiKey:'test-key-only',messages:[{role:'user',content:'hello'}]};
const answer = () => new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}]}));

test('all seven domestic presets send official destinations and model-specific parameters', async () => {
  assert.deepEqual(Object.keys(providers),['deepseek','qwen','glm','kimi','doubao','minimax','baidu']);
  for (const [provider,config] of Object.entries(providers)) {
    for (const model of config.models) {
      const result = await chatRequest({...base,provider,model},async (url:string,init:RequestInit)=>{
        assert.equal(url,config.endpoint);assert.equal(init.redirect,'error');
        assert.equal((init.headers as Record<string,string>).Authorization,'Bearer test-key-only');
        const sent = JSON.parse(String(init.body));
        assert.equal(sent.stream,false);assert.equal(sent.model,model);
        assert.equal(sent.tools,undefined);
        if (provider==='minimax') {assert.equal(sent.reasoning_split,true);assert.equal(sent.max_completion_tokens,16384);assert.equal(sent.max_tokens,undefined);}
        if (provider==='glm'&&model==='glm-5.3') assert.equal(sent.thinking,undefined,'GLM-5.3 cannot disable thinking');
        if (provider==='qwen') assert.equal(sent.enable_thinking,false);
        if (provider==='deepseek'||provider==='doubao') assert.deepEqual(sent.thinking,{type:'disabled'});
        return answer();
      });
      assert.equal(result.status,200);
    }
  }
  for (const provider of ['openai','__proto__','http://127.0.0.1']) assert.equal((await chatRequest({...base,provider,model:'x'},()=>{throw Error('must not call');})).status,400);
});

test('Qwen workspace is restricted to an official DNS label, never an arbitrary URL',async()=>{
  const config = {...base,provider:'qwen',model:'qwen-plus'};
  assert.equal((await chatRequest({...config,workspace:'llm-test'},async(url:string)=>{assert.equal(url,'https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');return answer();})).status,200);
  for(const workspace of ['https://evil.invalid','x@evil.invalid','../secret','x.y','-x',{}]) assert.equal((await chatRequest({...config,workspace},()=>{throw Error('must not call');})).status,400);
});

test('reasoning survives same-model tool rounds and is stripped for a different model/provider',async()=>{
  for(const provider of ['deepseek','kimi','glm','minimax'] as const) {
    const model=providers[provider].model;
    for(const same of [true,false]) {
      await chatRequest({...base,provider,model,messages:[{role:'assistant',content:null,reasoning_content:'reasoning-test',provider:same?provider:'other',model,tool_calls:[{id:'c1',type:'function',function:{name:'inspect',arguments:'{}'}}]},{role:'tool',content:'{}',tool_call_id:'c1'}]},async(_url:string,init:RequestInit)=>{
        const sent=JSON.parse(String(init.body));assert.equal(sent.messages[0].reasoning_content,same?'reasoning-test':undefined);
        assert.equal(sent.messages[0].provider,undefined);assert.equal(sent.messages[1].tool_call_id,'c1');return answer();
      });
    }
  }
});

test('website model request works without a paired service and does not expose credentials in results',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=async(url,init)=>{assert.equal(url,'/api/chat');assert.equal(JSON.parse(String(init?.body)).provider,'kimi');return new Response(JSON.stringify({message:{role:'assistant',content:'ok'}}));};
    const result=await requestModel({provider:'kimi',key:'test-key-only',model:'kimi-k3.1-pro',workspace:'',remember:false},[{role:'user',content:'hi'}],[],new AbortController().signal);
    assert.equal(result.content,'ok');assert.equal(result.provider,'kimi');assert(!JSON.stringify(result).includes('test-key-only'));
  } finally {globalThis.fetch=originalFetch;}
});

test('provider settings isolate credentials, migrate old DeepSeek names and respect session-only storage',()=>{
  const descriptors=['localStorage','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  const local=new Map<string,string>(),session=new Map<string,string>();
  for(const [key,map] of [['localStorage',local],['sessionStorage',session]] as const) Object.defineProperty(globalThis,key,{configurable:true,value:{getItem:(key:string)=>map.get(key)||null,setItem:(key:string,value:string)=>map.set(key,value),removeItem:(key:string)=>map.delete(key)}});
  try {
    local.set('bioinfobuddy-model','deepseek-chat');assert.equal(savedSettings('deepseek').model,'deepseek-flash');
    storeSettings({provider:'deepseek',key:'key-one-test',model:'deepseek-flash',workspace:'',remember:true});
    storeSettings({provider:'kimi',key:'key-two-test',model:'kimi-k3.1-pro',workspace:'',remember:false});
    assert.equal(savedSettings('deepseek').key,'key-one-test');assert.equal(savedSettings('kimi').key,'key-two-test');
    assert.equal(local.has('bioinfobuddy-api-key:kimi'),false);
    storeSettings({...savedSettings('deepseek'),remember:false});assert.equal(local.has('bioinfobuddy-api-key:deepseek'),false);
    assert.throws(()=>storeSettings({...savedSettings('kimi'),key:'bad\nkey-value'}));
  } finally {for(const [key,descriptor] of descriptors) if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
});

test('upstream errors stay redacted and truncated answers are not reported as success',async()=>{
  for(const status of [400,401,403,404,429,500]) {
    const result=await chatRequest({...base,model:'deepseek-flash'},async()=>new Response('test-key-only echoed',{status}));
    assert(result.status>=400);assert(!JSON.stringify(result.data).includes('test-key-only'));
  }
  assert.equal((await chatRequest({...base,model:'deepseek-flash'},async()=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:''},finish_reason:'length'}]})))).status,422);
});
