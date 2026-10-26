import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream, existsSync} from 'node:fs';
import {mkdir, readFile, writeFile, readdir, rename, rm, lstat, copyFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {randomBytes, randomInt, randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {chatRequest} from '../serverless/chat-handler.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
const origins = new Set(['https://bioinfobuddy.com.cn','https://www.bioinfobuddy.com.cn','http://127.0.0.1:5173','http://localhost:5173']);
const allowedTemplates = {tables:['box','violin','scatter','histogram','bar','heatmap'],fastq:['fastq-length','fastq-quality'],'single-cell':['embedding'],'r-script':['r-script']};
const mime = {'.png':'image/png','.svg':'image/svg+xml','.pdf':'application/pdf','.json':'application/json','.csv':'text/csv','.py':'text/plain','.r':'text/plain','.txt':'text/plain','.lock':'application/json'};
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export function fileKind(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.fastq.gz') || lower.endsWith('.fq.gz') || lower.endsWith('.fastq') || lower.endsWith('.fq')) return 'fastq';
  if (lower.endsWith('.h5ad')) return 'single-cell';
  if (lower.endsWith('.r')) return 'r-script';
  if (/\.(csv|tsv|xlsx)$/.test(lower)) return 'tables';
  throw new Error('支持 CSV、TSV、XLSX、FASTQ(.GZ)、H5AD 和 R 脚本。');
}
async function jsonFile(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), {mode:0o600}); await rename(temp,file);
}
async function body(req, max = 1024 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('需要 JSON 请求。');
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if(size>max) throw new Error('请求过大。'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString());
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数必须是对象。');
  return value;
}
function command(executable,args,{cwd=root,input='',onLog=()=>{},timeout=20*60*1000,env={}}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,shell:false,stdio:['pipe','pipe','pipe'],env:{...process.env,...env}});
    let output='', errors='', exceeded=false, killTimer;
    const stop=()=>{exceeded=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref();};
    const timer=setTimeout(stop,timeout);
    child.stdout.on('data',chunk=>{if(exceeded)return;output+=chunk; if(output.length>2*1024*1024)stop();});
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-12000);onLog(String(chunk).slice(-2000));});
    child.on('error',error=>{clearTimeout(timer);clearTimeout(killTimer);reject(new Error(`${path.basename(executable)} 无法启动：${error.code || error.message}`));});
    child.on('close',code=>{clearTimeout(timer);clearTimeout(killTimer);code===0&&!exceeded?resolve(output):reject(new Error(exceeded?'任务超时或输出过大。':errors.trim()||`进程退出：${code}`));});
    child.stdin.on('error',()=>{}); child.stdin.end(input);
  });
}

export async function createCompanion({dataDir=process.env.BIOINFO_COMPANION_HOME || path.join(os.homedir(),'.bioinfobuddy'),pairCode=String(randomInt(10000000,100000000)),port=4317,extraOrigins=(process.env.BIOINFO_COMPANION_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean)}={}) {
  for(const origin of extraOrigins){
    const parsed=new URL(origin);
    if(parsed.protocol!=='https:'||parsed.origin!==origin)throw new Error('额外来源必须是完整 HTTPS origin，不含路径或末尾斜杠。');
  }
  const allowedOrigins=new Set([...origins,`http://127.0.0.1:${port}`,...extraOrigins]);
  const auth=randomBytes(32).toString('hex'); let pairUsed=false, pairedOrigin='', attempts=0, attemptWindow=Date.now();
  const pairExpiry=Date.now()+15*60*1000;
  const tasks=new Map(), installing=new Set(), running=new Set();
  await Promise.all(['datasets','plans','runs','environments'].map(name=>mkdir(path.join(dataDir,name),{recursive:true,mode:0o700})));
  const recordPath=(store,id)=>{if(!uuid(id))throw new Error('记录 ID 无效。');return path.join(dataDir,store,`${id}.json`);};
  const readRecord=async(store,id)=>JSON.parse(await readFile(recordPath(store,id),'utf8'));
  const verifySource=async item=>{
    const source=path.join(dataDir,'datasets',item.id,item.name);
    const info=await lstat(source);
    if(!info.isFile()||info.isSymbolicLink())throw new Error('源文件不是普通文件。');
    const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);
    if(hash.digest('hex')!==item.sha256)throw new Error('源文件已改变，请重新导入。');
    return source;
  };
  const records=async store=>{
    const names=(await readdir(path.join(dataDir,store))).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));
    const values=await Promise.all(names.map(n=>readFile(path.join(dataDir,store,n),'utf8').then(JSON.parse)));
    return values.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  };
  let recovery=Promise.resolve(), recoveryError;
  const skillFor=id=>{const found=catalog.find(item=>item.id===id);if(!found)throw new Error('请选择内置技能。');return found;};
  const envDir=id=>path.join(dataDir,'environments',id);
  const python=id=>path.join(envDir(id),process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const uv=existsSync(path.join(root,'runtime',process.platform==='win32'?'uv.exe':'uv'))?path.join(root,'runtime',process.platform==='win32'?'uv.exe':'uv'):process.env.BIOINFO_UV || 'uv';
  const rscript=process.env.BIOINFO_RSCRIPT || 'Rscript';
  const ready=async id=>{
    try {const info=JSON.parse(await readFile(path.join(envDir(id),'ready.json'),'utf8'));return info.version===skillFor(id).version&&(id==='r-script'?existsSync(path.join(envDir(id),'renv/activate.R')):existsSync(python(id)));} catch{return false;}
  };
  const worker=async(id,request,onLog)=>{
    if(!await ready(id))throw new Error('请先安装此技能的分析环境。');
    return JSON.parse(await command(python(id),[path.join(root,'python/companion_worker.py')],{input:JSON.stringify(request),onLog,env:{MPLCONFIGDIR:path.join(dataDir,'matplotlib')}}));
  };
  function task(work){
    // Retain bounded recent progress; durable run records remain on disk.
    if(tasks.size>=200)for(const [id,state] of tasks){if(state.status!=='running')tasks.delete(id);if(tasks.size<150)break;}
    if(tasks.size>=200)throw new Error('本地任务过多，请等待当前任务结束。');
    const id=randomUUID();const state={id,status:'running',log:'',createdAt:new Date().toISOString()};tasks.set(id,state);
    const log=text=>{state.log=(state.log+text).slice(-12000);};
    Promise.resolve().then(()=>work(log)).then(result=>Object.assign(state,{status:'completed',result})).catch(error=>Object.assign(state,{status:'failed',error:error.message}));
    return state;
  }
  const server=createServer(async(req,res)=>{
    await recovery;
    const origin=req.headers.origin;
    const host=req.headers.host;
    const listeningPort=server.address()?.port || port;
    const validHost=host===`127.0.0.1:${listeningPort}`||host===`localhost:${listeningPort}`;
    const send=(code,value,contentType='application/json')=>{res.writeHead(code,{'Content-Type':contentType});res.end(Buffer.isBuffer(value)?value:JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(recoveryError){send(503,{error:'本地运行记录恢复失败，请检查助手数据目录。'});return;}
    if(!validHost){send(403,{error:'不允许的 Host。'});return;}
    if(origin&&!allowedOrigins.has(origin)){send(403,{error:'未配对的网站来源。'});return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){
      if(!origin){send(403,{error:'缺少来源。'});return;}
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Filename');
      if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');
      res.writeHead(204);res.end();return;
    }
    const url=new URL(req.url,`http://127.0.0.1:${port}`); const route=url.pathname;
    if(route==='/health'&&req.method==='GET'){send(200,{name:'bioinfobuddy-companion',version:'0.3.0'});return;}
    // A browser Origin and a separately entered short-lived pairing code are both required.
    if(req.method==='POST'&&!origin){send(403,{error:'缺少网站来源。'});return;}
    try {
      if(route==='/pair'&&req.method==='POST'){
        if(Date.now()-attemptWindow>60000){attemptWindow=Date.now();attempts=0;}
        if(++attempts>5){send(429,{error:'尝试过多，请稍后重试。'});return;}
        const value=await body(req);const supplied=Buffer.from(String(value.code||''));const expected=Buffer.from(pairCode);
        if(pairUsed||Date.now()>pairExpiry||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){send(401,{error:'配对码无效或已使用，请重新启动本地助手获取新码。'});return;}
        pairUsed=true;pairedOrigin=origin;send(200,{token:auth});return;
      }
      const supplied=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')||'');const expected=Buffer.from(auth);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){send(401,{error:'请连接本地助手。',code:'COMPANION_AUTH_REQUIRED'});return;}
      if(origin&&origin!==pairedOrigin){send(403,{error:'此令牌属于另一个网站来源，请重启助手后重新配对。'});return;}
      if(route==='/status'&&req.method==='GET'){
        send(200,{version:'0.3.0',skills:await Promise.all(catalog.map(async skill=>({...skill,installed:await ready(skill.id)}))),datasets:await records('datasets'),runs:await records('runs'),dataDir});return;
      }
      if(/^\/(datasets|plans|runs)\/[^/]+$/.test(route)&&req.method==='GET'){
        const [,store,id]=route.split('/');send(200,await readRecord(store,id));return;
      }
      if(route==='/skills/install'&&req.method==='POST'){
        const {id}=await body(req);const skill=skillFor(id);
        if(installing.has(id))throw new Error('此环境正在安装。');installing.add(id);
        const state=task(async log=>{try{
          await mkdir(envDir(id),{recursive:true});
          if(skill.runtime==='python'){
            const env={UV_CACHE_DIR:path.join(dataDir,'cache/uv'),UV_PYTHON_INSTALL_DIR:path.join(dataDir,'runtime/python')};
            if(!existsSync(python(id)))await command(uv,['venv','--python','3.12',envDir(id)],{onLog:log,env});
            await command(uv,['pip','install','--python',python(id),'-r',path.join(root,'companion/requirements',skill.requirements)],{onLog:log,env});
            await command(python(id),['-c',id==='single-cell'?'import anndata, matplotlib, openpyxl':'import numpy, pandas, matplotlib, openpyxl']);
          }else{
            await command(rscript,['--vanilla','-e','dir.create("bootstrap",showWarnings=FALSE); .libPaths(c(normalizePath("bootstrap"),.libPaths())); if (!requireNamespace("renv",quietly=TRUE)) install.packages("renv",lib="bootstrap",repos="https://cloud.r-project.org"); renv::init(bare=TRUE); renv::snapshot(prompt=FALSE)'],{cwd:envDir(id),onLog:log,env:{RENV_PATHS_ROOT:path.join(dataDir,'cache/renv')}});
          }
          await jsonFile(path.join(envDir(id),'ready.json'),{version:skill.version,installedAt:new Date().toISOString()});return {skill:id};
        }finally{installing.delete(id);}});send(202,state);return;
      }
      if(route.startsWith('/jobs/')&&req.method==='GET'){const job=tasks.get(route.split('/')[2]);if(!job)throw new Error('任务已过期，请刷新状态。');send(200,job);return;}
      if(route==='/datasets'&&req.method==='POST'){
        const name=decodeURIComponent(String(req.headers['x-filename']||''));
        if(!name||name.length>250||/[\\/\x00-\x1f\x7f]/.test(name)||name==='.'||name==='..')throw new Error('文件名无效。');
        const family=fileKind(name);const id=randomUUID();const folder=path.join(dataDir,'datasets',id);await mkdir(folder);
        const destination=path.join(folder,name);let size=0;const hash=createHash('sha256');
        const max=family==='tables'?10*1024*1024:family==='r-script'?1024*1024:2*1024*1024*1024;
        try{await pipeline(req,new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size>max){callback(new Error('文件超过此类型大小上限。'));return;}hash.update(chunk);callback(null,chunk);}}),createWriteStream(destination,{flags:'wx',mode:0o600}));if(!size)throw new Error('文件为空。');}
        catch(error){await rm(folder,{recursive:true,force:true});throw error;}
        const record={id,name,kind:family,size,sha256:hash.digest('hex'),createdAt:new Date().toISOString()};await jsonFile(recordPath('datasets',id),record);send(201,record);return;
      }
      if(/^\/datasets\/[^/]+\/inspect$/.test(route)&&req.method==='POST'){
        const item=await readRecord('datasets',route.split('/')[2]);const source=await verifySource(item);
        // R is read as text and never executed by inspection.
        const value=item.kind==='r-script'?{kind:item.kind,code:await readFile(source,'utf8')}:await worker(item.kind,{action:'inspect',path:source});
        item.profile=value;await jsonFile(recordPath('datasets',item.id),item);send(200,item);return;
      }
      if(route==='/plans'&&req.method==='POST'){
        const value=await body(req);const item=await readRecord('datasets',value.datasetId);
        const source=await verifySource(item);
        if(!allowedTemplates[item.kind].includes(value.template))throw new Error('图例与数据格式不匹配。');
        let preview, dataSha256=null;
        if(item.kind==='r-script'){
          if(value.dataId){const data=await readRecord('datasets',value.dataId);if(data.kind!=='tables')throw new Error('R 脚本的附加数据应是表格。');await verifySource(data);dataSha256=data.sha256;}
          preview={params:{},preview:[],steps:['运行你导入的 R 脚本；input_file 为附加数据，output_dir 为独立结果目录。'],warnings:['脚本拥有当前用户权限，独立包环境不是安全沙箱。请先阅读全部代码并确认信任。']};
        }else preview=await worker(item.kind,{action:'preview',path:source,sha256:item.sha256,template:value.template,params:value.params});
        const plan={...preview,id:randomUUID(),datasetId:item.id,template:value.template,dataId:item.kind==='r-script'?value.dataId||null:null,dataSha256,sourceSha256:item.sha256,status:'draft',createdAt:new Date().toISOString()};
        await jsonFile(recordPath('plans',plan.id),plan);send(201,plan);return;
      }
      if(route==='/runs'&&req.method==='POST'){
        const value=await body(req);if(value.confirm!==true)throw new Error('需要在界面确认此方案。');
        const plan=await readRecord('plans',value.planId);const item=await readRecord('datasets',plan.datasetId);
        if(item.kind==='r-script'&&value.trustScript!==true)throw new Error('需要确认信任此 R 脚本。');
        if(!await ready(item.kind))throw new Error('请先安装分析环境。');
        if(running.has(plan.id))throw new Error('此方案正在运行。');running.add(plan.id);
        const record={id:randomUUID(),planId:plan.id,datasetId:item.id,name:item.name,template:plan.template,status:'running',createdAt:new Date().toISOString(),artifacts:[]};await jsonFile(recordPath('runs',record.id),record);
        const state=task(async log=>{const output=path.join(dataDir,'runs',record.id);try{
          await mkdir(output);const source=await verifySource({...item,sha256:plan.sourceSha256});
          if(item.kind==='r-script'){
            const data=plan.dataId?await readRecord('datasets',plan.dataId):null;
            const input=data?await verifySource({...data,sha256:plan.dataSha256}):'-';
            await command(rscript,['--vanilla',path.join(root,'companion/r-runner.R'),source,input,output,envDir(item.kind)],{onLog:log,env:{RENV_PATHS_ROOT:path.join(dataDir,'cache/renv')}});
            await copyFile(source,path.join(output,'analysis.R'));
            await copyFile(path.join(envDir(item.kind),'renv.lock'),path.join(output,'renv.lock'));
            record.summary={note:'用户 R 脚本执行结束，请核对输出。'};
          }else record.summary=await worker(item.kind,{action:'render',path:source,sha256:plan.sourceSha256,template:plan.template,params:plan.params,output},log);
          await jsonFile(path.join(output,'plan.json'),plan);
          record.artifacts=[];
          for(const name of await readdir(output)){
            const info=await lstat(path.join(output,name));
            if(info.isFile()&&!info.isSymbolicLink()&&Object.hasOwn(mime,path.extname(name).toLowerCase()))record.artifacts.push(name);
          }
          if(!record.artifacts.some(name=>/\.(png|svg|pdf)$/i.test(name)))throw new Error('执行结束但没有生成 PNG、SVG 或 PDF。');
          record.status='completed';await jsonFile(recordPath('runs',record.id),record);return record;
        }catch(error){record.status='failed';record.error=error.message;await jsonFile(recordPath('runs',record.id),record);throw error;}finally{running.delete(plan.id);}});send(202,{...state,runId:record.id});return;
      }
      if(/^\/runs\/[^/]+\/files\/[^/]+$/.test(route)&&req.method==='GET'){
        const parts=route.split('/'),record=await readRecord('runs',parts[2]),name=decodeURIComponent(parts[4]);
        if(record.status!=='completed'||!record.artifacts.includes(name)||path.basename(name)!==name)throw new Error('文件不可用。');
        const file=path.join(dataDir,'runs',record.id,name);const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>100*1024*1024)throw new Error('文件过大或不是普通文件。');
        res.setHeader('Content-Type',mime[path.extname(name).toLowerCase()]||'application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="${encodeURIComponent(name)}"`);
        await pipeline(createReadStream(file),res);return;
      }
      if(route==='/chat'&&req.method==='POST'){const value=await body(req);const result=await chatRequest(value);send(result.status,result.data);return;}
      if(route==='/analysis'&&req.method==='POST'){
        const value=await body(req,3*1024*1024);const result=await worker('tables',{action:'legacy',body:value});send(200,Buffer.from(result.content,'base64'),result.mime);return;
      }
      send(404,{error:'没有这个接口。'});
    }catch(error){if(!res.headersSent&&!res.destroyed)send(400,{error:error.code==='ENOENT'?'记录不存在。':error.message});else res.destroy();}
  });
  // Only the process that actually acquires the listening port may recover jobs.
  // A second CLI invocation that fails with EADDRINUSE must not touch live runs.
  server.once('listening',()=>{
    recovery=(async()=>{
      for(const run of await records('runs'))if(run.status==='running'){
        run.status='failed';run.error='本地助手在任务完成前退出。';
        await jsonFile(recordPath('runs',run.id),run);
      }
    })().catch(error=>{recoveryError=error;});
  });
  return {server,pairCode,dataDir};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const instance=await createCompanion();
  instance.server.once('error',error=>{console.error(error.code==='EADDRINUSE'?'本地助手已经运行（端口 4317）。':error.message);process.exitCode=1;});
  instance.server.listen(4317,'127.0.0.1',()=>{
    console.log(`bioinfobuddy 本地助手 · http://127.0.0.1:4317\n配对码：${instance.pairCode}\n15 分钟内在网站的“连接本地助手”中输入。请保持本窗口运行。\n数据目录：${instance.dataDir}`);
  });
}
