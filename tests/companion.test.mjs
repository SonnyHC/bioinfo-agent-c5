import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createCompanion} from '../companion/server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const origin='http://127.0.0.1:5173';

async function fixture(t) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'bioinfo-companion-'));
  const {server}=await createCompanion({dataDir,pairCode:'12345678'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  let token='';
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  const call=async(route,value,extra={})=>{
    const response=await fetch(base+route,{method:value===undefined?'GET':'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,...(value===undefined?{}:{'Content-Type':'application/json'}),...extra},body:value===undefined?undefined:JSON.stringify(value)});
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  const pair=async()=>{const result=await call('/pair',{code:'12345678'});assert.equal(result.status,200);token=result.body.token;};
  const upload=async(name,contents)=>{
    const response=await fetch(base+'/datasets',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'X-Filename':encodeURIComponent(name)},body:contents});
    return {status:response.status,body:await response.json()};
  };
  const environment=async id=>{
    // Reuse the installed test interpreter without invoking a package installer.
    const executable=process.env.COMPANION_TEST_PYTHON||path.join(root,'.venv/bin/python');
    const baseEnv=path.resolve(executable,'../..');
    const env=path.join(dataDir,'environments',id);
    await fs.mkdir(path.join(env,'bin'),{recursive:true});
    await fs.symlink(executable,path.join(env,'bin/python'));
    await fs.symlink(path.join(baseEnv,'lib'),path.join(env,'lib'));
    await fs.copyFile(path.join(baseEnv,'pyvenv.cfg'),path.join(env,'pyvenv.cfg'));
    await fs.writeFile(path.join(env,'ready.json'),JSON.stringify({version:'1.0.0'}));
  };
  const finish=async job=>{
    for(let n=0;n<400;n++){
      const current=await call(`/jobs/${job.id}`);
      if(current.body.status!=='running')return current.body;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Job did not finish in 20 seconds');
  };
  return {call,pair,upload,environment,finish,dataDir,base,get token(){return token;}};
}

test('loopback helper enforces pairing, exact origin and private-network preflight',async t=>{
  const f=await fixture(t);
  const unauthenticated=await f.call('/status');assert.equal(unauthenticated.status,401);assert.equal(unauthenticated.body.code,'COMPANION_AUTH_REQUIRED');
  assert.equal((await f.call('/chat',{})).body.code,'COMPANION_AUTH_REQUIRED');
  assert.equal((await f.call('/pair',{code:'wrong'})).status,401);
  assert.equal((await f.call('/pair',{code:'12345678'},{Origin:'https://unrelated.example'})).status,403);
  const missing=await fetch(f.base+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'12345678'})});
  assert.equal(missing.status,403);
  const preflight=await fetch(f.base+'/datasets',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Private-Network':'true'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Private-Network'),'true');
  await f.pair();
  assert.equal((await f.call('/pair',{code:'12345678'})).status,401,'code is single use');
  assert.equal((await f.call('/status',undefined,{Origin:'https://bioinfobuddy.com.cn'})).status,403,'token remains bound to paired origin');
  const status=await f.call('/status');assert.equal(status.body.skills.length,4);
  assert(status.body.skills.every(skill=>!skill.installed));
  assert(status.body.skills.every(skill=>!skill.enabled&&skill.environment.status==='missing'));
  const enabled=await f.call('/skills/enable',{id:'tables'});assert.equal(enabled.status,200);
  assert.equal(enabled.body.enabled,true);assert.equal(enabled.body.installed,false);assert.equal(enabled.body.environment.status,'missing');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dataDir,'skills/tables.json'))).id,'tables');
  assert.equal((await f.call('/skills/enable',{id:'arbitrary'})).status,400);
  assert.equal((await f.upload('../escape.csv','a\n1')).status,400);
  assert.equal((await f.call('/skills/install',{id:'../../arbitrary'})).status,400);
});

test('local CSV workflow requires confirmation, preserves originals and restores result links',async t=>{
  const f=await fixture(t);await f.pair();await f.environment('tables');
  const source='group,value\nA,1\nA,2\nB,3\nB,4\n';
  const data=await f.upload('study.csv',source);assert.equal(data.status,201);
  const inspected=await f.call(`/datasets/${data.body.id}/inspect`,{});assert.equal(inspected.status,200,JSON.stringify(inspected.body));
  assert.equal(inspected.body.profile.rows,4);
  const plan=await f.call('/plans',{datasetId:data.body.id,template:'box',params:{layout:'long',group:'group',y:'value',missing:'error'}});
  assert.equal(plan.status,201,JSON.stringify(plan.body));assert.equal(plan.body.outputRows,4);
  assert.equal((await f.call(`/plans/${plan.body.id}`)).body.sourceSha256,data.body.sha256);
  assert.equal((await f.call('/runs',{planId:plan.body.id})).status,400);
  const starts=await Promise.all([f.call('/runs',{planId:plan.body.id,confirm:true}),f.call('/runs',{planId:plan.body.id,confirm:true})]);
  assert.deepEqual(starts.map(item=>item.status).sort(),[202,400]);
  const job=await f.finish(starts.find(item=>item.status===202).body);assert.equal(job.status,'completed',job.error);
  const run=(await f.call(`/runs/${job.result.id}`)).body;assert.equal(run.status,'completed');assert(run.artifacts.includes('analysis.py'));
  const image=await fetch(`${f.base}/runs/${run.id}/files/chart.png`,{headers:{Origin:origin,Authorization:`Bearer ${f.token}`}});
  assert.equal(image.status,200);const oldImage=Buffer.from(await image.arrayBuffer());assert.equal(oldImage.subarray(1,4).toString(),'PNG');
  assert.equal((await f.call('/plans',{datasetId:data.body.id,template:'scatter',params:{},parentRunId:run.id})).status,400,'editing keeps the actual source template');
  const different=await f.upload('other.csv',source);
  assert.equal((await f.call('/plans',{datasetId:different.body.id,template:'box',params:plan.body.params,parentRunId:run.id})).status,400,'a copied source must not be substituted under an old figure');
  const failedParentId='11111111-1111-1111-1111-111111111111';
  await fs.writeFile(path.join(f.dataDir,'runs',`${failedParentId}.json`),JSON.stringify({...run,id:failedParentId,status:'failed'}));
  assert.equal((await f.call('/plans',{datasetId:data.body.id,template:'box',params:plan.body.params,parentRunId:failedParentId})).status,400,'an incomplete result cannot become the source figure');
  const edits={title:'Revised figure',xLabel:'Experimental group',yLabel:'Measurement',palette:'plasma',fontSize:14,pointSize:60,alpha:0.45,width:5,height:4,dpi:100};
  const revised=await f.call('/plans',{datasetId:data.body.id,template:'box',params:{...plan.body.params,...edits},parentRunId:run.id});
  assert.equal(revised.status,201,JSON.stringify(revised.body));assert.equal(revised.body.parentRunId,run.id);
  assert.deepEqual(revised.body.parameterChanges.title,{before:plan.body.params.title??null,after:'Revised figure'});
  assert.equal((await f.call('/runs',{planId:revised.body.id})).status,400,'regeneration still requires explicit confirmation');
  const revisedStart=await f.call('/runs',{planId:revised.body.id,confirm:true});const revisedJob=await f.finish(revisedStart.body);
  assert.equal(revisedJob.status,'completed',revisedJob.error);assert.notEqual(revisedJob.result.id,run.id);assert.equal(revisedJob.result.parentRunId,run.id);
  const provenance=JSON.parse(await fs.readFile(path.join(f.dataDir,'runs',revisedJob.result.id,'provenance.json')));
  assert.equal(provenance.parentRunId,run.id);assert.equal(provenance.sourceSha256,data.body.sha256);assert.equal(provenance.parameters.title,'Revised figure');
  const manifest=JSON.parse(await fs.readFile(path.join(f.dataDir,'runs',revisedJob.result.id,'manifest.json')));
  assert.deepEqual(manifest.provenance,provenance);
  for(const [key,value] of Object.entries(edits)){
    assert.equal(revised.body.params[key],value,`preview preserves ${key}`);
    assert.equal(manifest.config[key],value,`render exports ${key}`);
    assert.equal(provenance.parameters[key],value,`provenance preserves ${key}`);
    assert.equal(revised.body.parameterChanges[key].after,value,`lineage records ${key}`);
  }
  const revisedImage=await fs.readFile(path.join(f.dataDir,'runs',revisedJob.result.id,'chart.png'));
  assert.equal(revisedImage.readUInt32BE(16),500);assert.equal(revisedImage.readUInt32BE(20),400);
  assert.deepEqual(manifest.plot.axisLabels,{x:'Experimental group',y:'Measurement'});
  const exported=await fetch(`${f.base}/runs/${revisedJob.result.id}/files/chart.png`,{headers:{Origin:origin,Authorization:`Bearer ${f.token}`}});
  assert.deepEqual(Buffer.from(await exported.arrayBuffer()),revisedImage,'download is the regenerated figure');
  const output=path.join(f.dataDir,'runs',revisedJob.result.id);
  const replay=spawnSync(process.env.COMPANION_TEST_PYTHON||path.join(root,'.venv/bin/python'),[path.join(output,'analysis.py')],{encoding:'utf8',env:{...process.env,MPLCONFIGDIR:path.join(f.dataDir,'matplotlib')}});
  assert.equal(replay.status,0,replay.stderr);
  assert.deepEqual(await fs.readFile(path.join(output,'reproduced/chart.png')),revisedImage,'downloaded script reproduces the revised parameters');
  assert.deepEqual(await fs.readFile(path.join(f.dataDir,'runs',run.id,'chart.png')),oldImage,'old result remains byte-identical');
  assert.notDeepEqual(revisedImage,oldImage,'parameter edits change actual exported image');
  assert.deepEqual(await fs.readFile(path.join(output,'processed.csv')),await fs.readFile(path.join(f.dataDir,'runs',run.id,'processed.csv')),'appearance edits preserve reviewed data');
  assert.equal(await fs.readFile(path.join(f.dataDir,'datasets',data.body.id,'study.csv'),'utf8'),source);
  const disk=path.join(f.dataDir,'datasets',data.body.id,'study.csv');await fs.writeFile(disk,'group,value\nchanged,99\n');
  const changed=await f.call(`/datasets/${data.body.id}/inspect`,{});assert.equal(changed.status,400);assert.match(changed.body.error,/源文件已改变/);
});

test('FASTQ processing records prefix sampling and produces actual local figures',async t=>{
  const f=await fixture(t);await f.pair();await f.environment('fastq');
  const data=await f.upload('sample.fastq','@r1\nACGT\n+\nIIII\n@r2\nAC\n+\n!!\n');
  const plan=await f.call('/plans',{datasetId:data.body.id,template:'fastq-quality',params:{maxReads:1}});
  assert.equal(plan.status,201,JSON.stringify(plan.body));assert.equal(plan.body.outputRows,1);assert.equal(plan.body.truncated,true);
  assert.equal(plan.body.preview[0].mean_quality,40);assert.match(plan.body.warnings[0],/前缀样本/);
  const start=await f.call('/runs',{planId:plan.body.id,confirm:true});
  const job=await f.finish(start.body);assert.equal(job.status,'completed',job.error);
  assert(job.result.artifacts.includes('processed.csv'));assert(job.result.artifacts.includes('analysis.py'));
});

test('R inspection is inert and execution requires separate script trust',async t=>{
  const f=await fixture(t);await f.pair();
  const data=await f.upload('example.R','stop("inspection must not execute this")\n');
  const inspected=await f.call(`/datasets/${data.body.id}/inspect`,{});assert.equal(inspected.status,200);
  assert.match(inspected.body.profile.code,/inspection must not execute/);
  const plan=await f.call('/plans',{datasetId:data.body.id,template:'r-script',params:{}});assert.equal(plan.status,201);
  assert.equal((await f.call('/plans',{datasetId:data.body.id,template:'r-script',params:{title:'ignored?'}})).status,400,'R must not silently accept unsupported appearance parameters');
  const rejected=await f.call('/runs',{planId:plan.body.id,confirm:true});assert.equal(rejected.status,400);assert.match(rejected.body.error,/确认信任/);
});

test('installed R and renv execute the bundled example with a hash-bound CSV',{
  skip:spawnSync(process.env.BIOINFO_RSCRIPT||'Rscript',['--vanilla','-e','if (!requireNamespace("renv", quietly=TRUE)) quit(status=1)'],{stdio:'ignore'}).status!==0,
},async t=>{
  const f=await fixture(t);await f.pair();
  const installed=await f.call('/skills/install',{id:'r-script'});assert.equal(installed.status,202);
  const installation=await f.finish(installed.body);assert.equal(installation.status,'completed',installation.error);
  const script=await f.upload('example.R',await fs.readFile(path.join(root,'companion/example.R')));
  const data=await f.upload('values.csv','x,y\n1,2\n2,4\n3,5\n');
  const plan=await f.call('/plans',{datasetId:script.body.id,template:'r-script',dataId:data.body.id,params:{}});
  assert.equal(plan.body.dataSha256,data.body.sha256);
  const start=await f.call('/runs',{planId:plan.body.id,confirm:true,trustScript:true});
  const job=await f.finish(start.body);assert.equal(job.status,'completed',job.error);
  for(const name of ['chart.png','chart.pdf','analysis.R','renv.lock'])assert(job.result.artifacts.includes(name),name);
  await fs.writeFile(path.join(f.dataDir,'datasets',data.body.id,'values.csv'),'x,y\n1,999\n');
  const changedStart=await f.call('/runs',{planId:plan.body.id,confirm:true,trustScript:true});
  const changed=await f.finish(changedStart.body);assert.equal(changed.status,'failed');assert.match(changed.error,/源文件已改变/);
});

test('helper restart marks interrupted runs failed and rejects non-HTTPS extra origins',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'bioinfo-restart-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dataDir,'runs'));
  const id='12345678-1234-1234-1234-123456789012';
  await fs.writeFile(path.join(dataDir,'runs',`${id}.json`),JSON.stringify({id,status:'running',createdAt:new Date().toISOString()}));
  await fs.mkdir(path.join(dataDir,'environments/tables'),{recursive:true});
  await fs.writeFile(path.join(dataDir,'environments/tables.installation.json'),JSON.stringify({status:'installing',jobId:id,log:'dependency installation started'}));
  const {server}=await createCompanion({dataDir});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  await fetch(`http://127.0.0.1:${server.address().port}/health`);
  await new Promise(resolve=>server.close(resolve));
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir,'runs',`${id}.json`))).status,'failed');
  const interrupted=JSON.parse(await fs.readFile(path.join(dataDir,'environments/tables.installation.json')));
  assert.equal(interrupted.status,'failed');assert.match(interrupted.error,/安装完成前退出/);assert.equal(interrupted.log,'dependency installation started');
  await assert.rejects(()=>createCompanion({dataDir,extraOrigins:['https://preview.example/path']}),/HTTPS origin/);
});

test('failed environment installation exposes a durable reason and supports an explicit retry',async t=>{
  const previous=process.env.BIOINFO_RSCRIPT;
  process.env.BIOINFO_RSCRIPT=path.join(os.tmpdir(),'bioinfobuddy-missing-rscript-for-test');
  let f;
  try {f=await fixture(t);} finally {if(previous===undefined)delete process.env.BIOINFO_RSCRIPT;else process.env.BIOINFO_RSCRIPT=previous;}
  await f.pair();
  const start=await f.call('/skills/install',{id:'r-script'});assert.equal(start.status,202);
  const failed=await f.finish(start.body);assert.equal(failed.status,'failed');assert.match(failed.error,/无法启动/);
  const skill=(await f.call('/status')).body.skills.find(s=>s.id==='r-script');
  assert.equal(skill.enabled,true);assert.equal(skill.installed,false);assert.equal(skill.environment.status,'failed');
  assert.equal(skill.environment.jobId,start.body.id);assert.match(skill.environment.error,/无法启动/);assert.match(skill.environment.log,/renv/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dataDir,'environments/r-script.installation.json'))).error,failed.error);
  const retry=await f.call('/skills/install',{id:'r-script'});assert.equal(retry.status,202);assert.notEqual(retry.body.id,start.body.id);
  assert.equal((await f.finish(retry.body)).status,'failed');
});

test('second helper failing to bind the active port leaves live running records unchanged',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'bioinfo-double-start-'));
  const first=await createCompanion({dataDir});
  first.server.listen(0,'127.0.0.1');await once(first.server,'listening');
  const port=first.server.address().port;
  await fetch(`http://127.0.0.1:${port}/health`);
  t.after(async()=>{first.server.closeAllConnections();await new Promise(resolve=>first.server.close(resolve));await fs.rm(dataDir,{recursive:true,force:true});});
  const id='12345678-1234-1234-1234-123456789012';
  const record=JSON.stringify({id,status:'running',createdAt:new Date().toISOString()});
  const recordFile=path.join(dataDir,'runs',`${id}.json`);await fs.writeFile(recordFile,record);
  const second=await createCompanion({dataDir});
  const error=once(second.server,'error');second.server.listen(port,'127.0.0.1');
  assert.equal((await error)[0].code,'EADDRINUSE');
  assert.equal(await fs.readFile(recordFile,'utf8'),record);
});
