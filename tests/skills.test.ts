import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { list, read, save } from '../web/src/storage.ts';
import { addSkill, availableSkills, installedSkills, loadSkill, removeSkill, setSkillEnabled, skillPrompt } from '../web/src/skill-library.ts';
import { skillCatalog } from '../web/src/skill-catalog.ts';
import { executeTool, systemPrompt, toolDefinitions } from '../web/src/agent-tools.ts';
import { runAgent } from '../web/src/agent-loop.ts';

test('upgrade from the existing browser database preserves files and conversations', async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('bioinfobuddy-browser-v1', 1);
    request.onupgradeneeded = () => {
      for (const name of ['datasets', 'plans', 'runs', 'chats']) request.result.createObjectStore(name, {keyPath:'id'});
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['datasets','chats'], 'readwrite');
      transaction.objectStore('datasets').put({id:'source-before-upgrade',file:new Blob(['sample,value\nA,2']),createdAt:'2026-10-30'});
      transaction.objectStore('chats').put({id:'chat-before-upgrade',messages:[{role:'user',content:'保留旧对话'}],createdAt:'2026-10-30'});
      transaction.oncomplete = () => {db.close();resolve();};
      transaction.onerror = () => reject(transaction.error);
    };
  });
  assert.deepEqual(await installedSkills(), []);
  assert.equal(await (await read<{file:Blob}>('datasets','source-before-upgrade')).file.text(),'sample,value\nA,2');
  assert.equal((await read<{messages:{content:string}[]}>('chats','chat-before-upgrade')).messages[0].content,'保留旧对话');
});

test('skills are opt-in, persist independently and reject removed, disabled or outdated workflows', async () => {
  const id = 'reviewed-bio-plot';
  assert.deepEqual(await availableSkills(), []);
  await assert.rejects(loadSkill(id), /尚未添加/);
  await assert.rejects(addSkill('../../untrusted'), /找不到/);
  await addSkill(id);
  const record = (await installedSkills())[0];
  await addSkill(id);
  assert.equal((await installedSkills()).length,1);
  assert.equal((await installedSkills())[0].createdAt, record.createdAt);
  assert.match((await loadSkill(id)).content,/bio_preview_plan/);
  assert.match(await skillPrompt(id), /本轮流程已加载/);
  await setSkillEnabled(id,false);
  assert.deepEqual(await availableSkills(),[]);
  await assert.rejects(skillPrompt(id), /已停用/);
  await setSkillEnabled(id,true);
  await save('skills',{...record,version:'0.0.1'});
  assert.deepEqual(await availableSkills(),[]);
  await assert.rejects(loadSkill(id),/新版本/);
  await addSkill(id);
  assert.equal((await loadSkill(id)).version,skillCatalog[0].version);
  await removeSkill(id);
  await assert.rejects(loadSkill(id), /尚未添加/);
  assert.equal((await list('chats')).length,1);
  assert.equal((await list('datasets')).length,1);
});

test('agent can discover and load an added skill through real tools without gaining install or execution powers', async () => {
  await addSkill('table-check');
  const controller = new AbortController();
  let rounds = 0;
  const messages = await runAgent({
    messages:[{role:'user',content:'检查表格'}],signal:controller.signal,
    request:async transcript => {
      rounds++;
      if(rounds === 1) return {role:'assistant',content:null,tool_calls:[{id:'list',type:'function',function:{name:'bio_list_skills',arguments:'{}'}}]};
      const result = JSON.parse(transcript.at(-1)!.content!);
      if(rounds === 2) {
        assert.deepEqual(result.skills.map((item:{id:string})=>item.id),['table-check']);
        assert.equal(result.workbenchUrl,'/?view=skills');
        return {role:'assistant',content:null,tool_calls:[{id:'load',type:'function',function:{name:'bio_load_skill',arguments:'{"skillId":"table-check"}'}}]};
      }
      assert.equal(result.id,'table-check');
      assert.match(result.content,/前 10 行/);
      return {role:'assistant',content:'已加载表格检查流程。'};
    },
    execute:(name,args)=>executeTool(name,args,controller.signal),changed:async()=>{},
  });
  assert.equal(rounds,3);
  assert.equal(messages.filter(item=>item.role==='tool').length,2);
  assert(!toolDefinitions.some(tool=>/approve|run_approved|install|enable_skill/.test(tool.function.name)));
  await assert.rejects(executeTool('bio_load_skill',{skillId:'result-review'},controller.signal),/尚未添加/);
  assert.match(systemPrompt,/不能把添加技能称作完成分析/);
  for(const skill of skillCatalog) for(const name of skill.tools) assert(toolDefinitions.some(tool=>tool.function.name===name),name);
});

test('result review gets actual file names without sending blob URLs or file contents to the model', async () => {
  const id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await save('runs',{id,planId:'plan',datasetId:'data',status:'completed',createdAt:'2026-10-30',summary:{rows:2},files:[{name:'chart.png',blob:new Blob(['binary'])},{name:'manifest.json',blob:new Blob(['private contents'])}]});
  const result=await executeTool('bio_get_run',{runId:id},new AbortController().signal) as {outputFiles:string[]};
  assert.deepEqual(result.outputFiles,['chart.png','manifest.json']);
  assert(!JSON.stringify(result).includes('blob:'));
  assert(!JSON.stringify(result).includes('private contents'));
});
