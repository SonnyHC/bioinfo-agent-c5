import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowRight, Check, CheckCircle2, Code2, Dna, FileText, FolderOpen, History, Laptop, LoaderCircle, MessageSquare, Play, Plug, RefreshCw, Settings2, Upload } from 'lucide-react';
import { companion, companionConnected, companionFetch, disconnectCompanion, pairCompanion, waitJob } from './companion';
import type { LocalDataset, LocalJob, LocalKind, LocalPlan, LocalRun, LocalSkill, LocalStatus } from './companion';
import catalog from '../../companion/catalog.json';
import rExample from '../../companion/example.R?raw';
import './local-workbench.css';

/* Interface-design working brief:
 * Researchers arrive with a file and choose a figure, then review the data transformation.
 * Domain: sample, measured value, sequencing read, cell annotation, provenance, reproduction.
 * Color world: laboratory paper, graphite labels, teal glass, grey steel, amber annotations.
 * Signature: source → reviewed transformation → local figure; every run retains its source hash.
 * Avoid decorative KPI cards, a chat-shaped workflow, and invisible installation state.
 * Intent: a calm, inspectable lab notebook. Hierarchy: the active dataset and figure lead.
 * Palette/depth: existing paper/teal tokens and quiet borders; inset controls, white work sheet.
 * Typography/spacing: inherited Chinese UI face, 13px body/22px title, mono metadata, 4px grid.
 */

interface Template { id: string; skill: LocalKind; name: string; description: string; note: string }
const templates: Template[] = [
  {id:'box',skill:'tables',name:'箱线图',description:'比较分组分布，保留样本点',note:'横轴为分组，纵轴为连续数值。箱体描述分布，不自动进行显著性检验。'},
  {id:'violin',skill:'tables',name:'小提琴图',description:'查看各组数值的分布形状',note:'适合有足够样本的连续数值；分布轮廓来自核密度估计。'},
  {id:'scatter',skill:'tables',name:'散点图',description:'查看两个数值变量的关系',note:'选择两个数值字段，可按分类字段着色。不自动拟合回归或推断因果。'},
  {id:'histogram',skill:'tables',name:'直方图',description:'查看一个数值变量的频数分布',note:'选择一个数值字段，查看数据落在各个区间的频数。'},
  {id:'bar',skill:'tables',name:'均值柱状图',description:'比较各组均值，保留样本点',note:'柱高为均值，原始样本点叠加显示；不自动进行显著性检验。'},
  {id:'heatmap',skill:'tables',name:'矩阵热图',description:'展示一组数值字段的相对高低',note:'最多 50 行 × 30 个数值字段；按输入值绘制，不自动标准化或聚类。'},
  {id:'fastq-length',skill:'fastq',name:'Read 长度分布',description:'从 FASTQ 提取每条序列的长度',note:'按文件顺序读取前 N 条，不做随机抽样、比对或表达定量。'},
  {id:'fastq-quality',skill:'fastq',name:'Read 平均质量',description:'计算每条 read 的平均 Phred 值',note:'要求 Phred+33 编码；逐条取质量值的算术平均，不等同于每个碱基位置的质量图。'},
  {id:'embedding',skill:'single-cell',name:'细胞嵌入图',description:'绘制 H5AD 已有嵌入的前两维',note:'使用已有 UMAP/PCA 等坐标，可按细胞注释分类着色；不计算嵌入、聚类或归一化。'},
  {id:'r-script',skill:'r-script',name:'自有 R 脚本',description:'查看并执行自己信任的绘图代码',note:'input_file 是附加表格路径，output_dir 是结果目录。脚本必须把图片写入 output_dir。'},
];
const labels: Record<LocalKind,string> = {tables:'表格绘图',fastq:'FASTQ 质控','single-cell':'单细胞','r-script':'R 脚本'};
const sizeLabel = (n: number) => n >= 1024 ** 3 ? `${(n/1024**3).toFixed(1)} GiB` : n >= 1024**2 ? `${(n/1024**2).toFixed(1)} MiB` : `${Math.max(1,Math.round(n/1024))} KiB`;
const dateLabel = (s: string) => new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const columnsOf = (data?: LocalDataset | null) => (data?.profile?.columns ?? []).map(c => typeof c === 'string' ? c : c.name);
const numericOf = (data: LocalDataset) => (data.profile?.columns ?? []).filter(c => typeof c !== 'string' && c.type === 'number').map(c => typeof c === 'string' ? c : c.name);

function defaults(data: LocalDataset, id: string): Record<string, unknown> {
  if (data.kind === 'fastq') return {maxReads:10000};
  if (data.kind === 'single-cell') return {embedding:data.profile?.embeddings?.find(n=>n==='X_umap') ?? data.profile?.embeddings?.[0] ?? '',color:'',maxCells:50000};
  if (data.kind === 'r-script') return {};
  const numeric = numericOf(data), all = columnsOf(data), text = all.filter(c=>!numeric.includes(c));
  const group = text.find(c=>/group|condition|treatment|分组|组别/i.test(c)) ?? text[0] ?? '';
  return {layout:['box','violin','bar'].includes(id) && !group ? 'wide' : 'long',x:id==='heatmap'?text[0]??'':numeric[0]??'',y:id==='scatter'?numeric[1]??'':numeric.find(c=>/value|expression|数值|表达/i.test(c))??numeric[0]??'',group:['scatter','histogram'].includes(id)?'':group,valueColumns:numeric,missing:'error',title:'',xLabel:'',yLabel:''};
}

// Intent: recognize each scientific figure before selecting it. Hierarchy: plot silhouette.
// Palette/surfaces: teal ink on existing paper; flat examples, not fabricated user results.
// Typography/spacing: inherited labels, 4px units, compact 128 × 64 preview.
function PlotExample({id}: {id:string}) {
  return <svg className="local-example" viewBox="0 0 128 64" role="img" aria-label="图形结构示意，非用户分析结果">
    <path d="M13 7v46h104" className="local-example-axis"/>
    {id==='box'&&[0,1,2].map(i=><g key={i} transform={`translate(${29+i*32} ${i===1?-4:0})`}><path d="M0 13v35m-7-35h14m-14 35h14"/><rect x="-10" y="23" width="20" height="16"/><path d="M-10 31h20"/></g>)}
    {id==='violin'&&[0,1,2].map(i=><g key={i} transform={`translate(${31+i*31} 0)`}><path d={`M0 ${10+i*3} C-3 20 -13 25 -10 37 Q-5 45 0 49 Q5 45 10 37 C13 25 3 20 0 ${10+i*3}Z`}/><path d="M0 24v16"/></g>)}
    {(id==='scatter'||id==='r-script')&&[[25,44],[30,40],[37,43],[44,34],[50,38],[59,25],[67,31],[76,22],[81,18],[88,25],[98,12],[109,16]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.4"/>)}
    {['histogram','fastq-length','fastq-quality'].includes(id)&&[8,16,29,39,34,25,15,6].map((h,i)=><rect key={i} x={22+i*11} y={52-h} width="10" height={h}/>)}
    {id==='bar'&&[23,37,29].map((h,i)=><g key={i}><rect x={25+i*30} y={52-h} width="18" height={h}/><circle cx={31+i*30} cy={49-h} r="1.5"/><circle cx={36+i*30} cy={55-h} r="1.5"/></g>)}
    {id==='heatmap'&&Array.from({length:40},(_,i)=><rect key={i} x={20+i%8*11} y={8+Math.floor(i/8)*9} width="10" height="8" style={{opacity:.2+(i*7%13)/16}}/>)}
    {id==='embedding'&&Array.from({length:42},(_,i)=><circle key={i} cx={37+(i%3)*28+Math.sin(i*2.1)*12} cy={31+Math.cos(i*1.7)*14+(i%3)*2} r="1.8" style={{opacity:.35+(i%3)*.3}}/>)}
  </svg>;
}

// Intent: inspect real values before approval. Hierarchy: field headers, then values.
// Existing table tokens supply paper surfaces, quiet rules, mono values, 12px cell padding.
function PreviewTable({rows,columns}: {rows:Record<string,unknown>[];columns?:string[]}) {
  if (!rows.length) return <p className="local-muted">没有可预览的数据行。</p>;
  const fields=columns?.length?columns:Object.keys(rows[0]);
  return <div className="data-table-wrap"><div className="data-table-scroll" tabIndex={0} aria-label="数据预览，可横向滚动"><table className="data-table"><thead><tr>{fields.map(key=><th key={key} scope="col">{key}</th>)}</tr></thead><tbody>{rows.slice(0,10).map((row,i)=><tr key={i}>{fields.map(key=><td key={key} title={String(row[key]??'缺失')}>{row[key]==null||row[key]===''?<span className="missing-cell">缺失</span>:String(row[key])}</td>)}</tr>)}</tbody></table></div><div className="table-caption">仅显示前 {Math.min(rows.length,10)} 行</div></div>;
}

// Intent: map a real source field. Hierarchy: label → choice → explanation.
// Native controls retain keyboard behavior; inherited inset/paper, 36px control and 8px gaps.
function SelectField({label,value,values,onChange,hint,optional=false}: {label:string;value:unknown;values:string[];onChange:(value:string)=>void;hint:string;optional?:boolean}) {
  return <label className="field"><span>{label}</span><select value={String(value??'')} onChange={e=>onChange(e.target.value)}><option value="">{optional?'不选择':'选择字段'}</option>{values.map(v=><option key={v} value={v}>{v}</option>)}</select><small>{hint}</small></label>;
}
function Notice({children}: {children:ReactNode}) { return <div className="notice"><AlertTriangle size={16}/><div>{children}</div></div>; }

export default function LocalWorkbench() {
  const [status,setStatus]=useState<LocalStatus|null>(null);
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [job,setJob]=useState<LocalJob|null>(null);
  const [data,setData]=useState<LocalDataset|null>(null);
  const [family,setFamily]=useState<LocalKind>('tables');
  const [template,setTemplate]=useState('box');
  const [params,setParams]=useState<Record<string,unknown>>({});
  const [dataId,setDataId]=useState('');
  const [plan,setPlan]=useState<LocalPlan|null>(null);
  const [run,setRun]=useState<LocalRun|null>(null);
  const [imageUrl,setImageUrl]=useState('');
  const [imageError,setImageError]=useState('');
  const [reviewed,setReviewed]=useState(false);
  const [trustScript,setTrustScript]=useState(false);
  const [view,setView]=useState<'analysis'|'skills'|'history'>('analysis');
  const lock=useRef(false), mounted=useRef(true), controller=useRef<AbortController|null>(null), input=useRef<HTMLInputElement>(null);
  const skills:LocalSkill[]=status?.skills??catalog as LocalSkill[];
  const activeTemplate=templates.find(t=>t.id===template)!;
  const activeSkill=skills.find(s=>s.id===(data?.kind??family));
  const ready=!!status, disabled=!!busy;
  const query=new URLSearchParams(window.location.search);

  async function refresh() {
    const result=await companion<LocalStatus>('/status');
    if(mounted.current)setStatus(result);
    return result;
  }
  function invalidate(){setPlan(null);setRun(null);setReviewed(false);setTrustScript(false);}
  function changeParams(patch:Record<string,unknown>){setParams(old=>({...old,...patch}));invalidate();}
  function chooseData(next:LocalDataset, id?:string){
    const nextTemplate=id??(templates.some(t=>t.id===template&&t.skill===next.kind)?template:templates.find(t=>t.skill===next.kind)!.id);
    setData(next);setFamily(next.kind);setTemplate(nextTemplate);setParams(defaults(next,nextTemplate));setDataId('');invalidate();setView('analysis');
  }
  async function perform<T>(label:string,fn:()=>Promise<T>):Promise<T|undefined>{
    if(lock.current)return;lock.current=true;setBusy(label);setError('');setJob(null);
    try{return await fn();}catch(e){if(mounted.current){setError(message(e));if(!companionConnected()||message(e).startsWith('无法连接本地助手'))setStatus(null);}return undefined;}
    finally{lock.current=false;if(mounted.current)setBusy('');}
  }
  async function watch(jobId:string){
    controller.current?.abort();const signal=new AbortController();controller.current=signal;
    return await waitJob(jobId,next=>{if(mounted.current)setJob(next);},signal.signal);
  }
  async function openRun(next:LocalRun){
    const [sourcePlan,source]=await Promise.all([companion<LocalPlan>(`/plans/${next.planId}`),companion<LocalDataset>(`/datasets/${next.datasetId}`)]);
    if(sourcePlan.datasetId!==source.id||next.planId!==sourcePlan.id||next.datasetId!==source.id)throw new Error('运行记录、方案与源文件不匹配，请重新选择记录。');
    chooseData(source,next.template);setPlan(sourcePlan);setParams(sourcePlan.params);setDataId(sourcePlan.dataId??'');setRun(next);setView('analysis');
  }
  async function restoreLink(){
    if(query.get('run'))await openRun(await companion<LocalRun>(`/runs/${encodeURIComponent(query.get('run')!)}`));
    else if(query.get('plan')){
      const linked=await companion<LocalPlan>(`/plans/${encodeURIComponent(query.get('plan')!)}`);
      const source=await companion<LocalDataset>(`/datasets/${linked.datasetId}`);
      if(linked.datasetId!==source.id)throw new Error('方案与源文件不匹配，请重新选择。');
      chooseData(source,linked.template);setPlan(linked);setParams(linked.params);setDataId(linked.dataId??'');
    }
  }
  useEffect(()=>{
    mounted.current=true;
    if(companionConnected())void perform('正在连接本地助手',async()=>{const current=await refresh();if(query.has('plan')||query.has('run'))await restoreLink();else if(current.datasets[0])chooseData(current.datasets[0]);});
    return()=>{mounted.current=false;controller.current?.abort();};
  },[]);
  useEffect(()=>{
    setImageUrl('');setImageError('');let url='';let cancelled=false;
    const name=run?.status==='completed'?run.artifacts.find(n=>/\.png$/i.test(n)):undefined;
    if(run&&name)void companionFetch(`/runs/${run.id}/files/${encodeURIComponent(name)}`).then(r=>r.blob()).then(blob=>{if(!cancelled){url=URL.createObjectURL(blob);setImageUrl(url);}}).catch(e=>{if(!cancelled)setImageError(message(e));});
    return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};
  },[run]);

  async function connect(){await perform('正在配对',async()=>{await pairCompanion(code.trim());setCode('');const current=await refresh();if(query.has('plan')||query.has('run'))await restoreLink();else if(current.datasets[0])chooseData(current.datasets[0]);});}
  async function install(skill:LocalSkill){await perform(`正在安装${skill.name}`,async()=>{const task=await companion<LocalJob>('/skills/install',{id:skill.id});await watch(task.id);await refresh();if(data?.kind===skill.id&&!data.profile){const inspected=await companion<LocalDataset>(`/datasets/${data.id}/inspect`,{});chooseData(inspected);await refresh();}});}
  async function inspect(next:LocalDataset){await perform('正在检查本地数据',async()=>{const result=await companion<LocalDataset>(`/datasets/${next.id}/inspect`,{});chooseData(result);await refresh();});}
  async function upload(file:File){
    if(!/(\.(csv|tsv|xlsx|h5ad|r)|\.(fastq|fq)(\.gz)?)$/i.test(file.name)){setError('请选择 CSV、TSV、XLSX、FASTQ(.GZ)、H5AD 或 R 脚本。');return;}
    const limit=/\.(csv|tsv|xlsx)$/i.test(file.name)?10*1024**2:/\.r$/i.test(file.name)?1024**2:2*1024**3;
    if(file.size>limit){setError(`此文件类型上限为 ${sizeLabel(limit)}。`);return;}
    await perform('正在将文件导入本地助手',async()=>{
      let result=await (await companionFetch('/datasets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:file})).json() as LocalDataset;
      chooseData(result);await refresh();
      if(result.kind==='r-script'||skills.some(s=>s.id===result.kind&&s.installed)){
        result=await companion<LocalDataset>(`/datasets/${result.id}/inspect`,{});chooseData(result);await refresh();
      }
    });
  }
  function onFile(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}
  async function sample(){
    if(family==='tables')await upload(new File(['sample,group,value,measure\nS01,Control,4.2,12\nS02,Control,5.1,15\nS03,Control,4.8,14\nS04,Treated,6.7,21\nS05,Treated,7.2,23\nS06,Treated,6.9,22\n'], 'synthetic-example.csv',{type:'text/csv'}));
    else if(family==='fastq')await upload(new File([Array.from({length:40},(_,i)=>{const n=50+i%20;return `@synthetic_read_${i+1}\n${'ACGT'.repeat(Math.ceil(n/4)).slice(0,n)}\n+\n${String.fromCharCode(33+20+i%20).repeat(n)}\n`;}).join('')],'synthetic-example.fastq'));
    else if(family==='r-script')await upload(new File([rExample],'bioinfobuddy-example.R',{type:'text/plain'}));
  }
  async function preview(){if(!data)return;await perform('正在生成转换预览',async()=>{const result=await companion<LocalPlan>('/plans',{datasetId:data.id,template,params,...(data.kind==='r-script'&&dataId?{dataId}:{})});setPlan(result);setRun(null);setReviewed(false);setTrustScript(false);});}
  async function execute(){if(!plan||!reviewed)return;await perform('正在本机生成图表',async()=>{setRun(null);const task=await companion<LocalJob&{runId:string}>('/runs',{planId:plan.id,confirm:true,trustScript});await refresh();try{setRun(await watch(task.id) as LocalRun);}finally{const latest=await refresh();const current=latest.runs.find(item=>item.id===task.runId);if(current)setRun(current);}});}
  async function download(record:LocalRun,name:string){await perform('正在读取结果文件',async()=>{const blob=await (await companionFetch(`/runs/${record.id}/files/${encodeURIComponent(name)}`)).blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
  function selectTemplate(next:Template){setFamily(next.skill);setTemplate(next.id);if(data?.kind===next.skill)setParams(defaults(data,next.id));else{setData(null);setParams({});}invalidate();}

  return <div className="local-shell">
    <header className="local-header"><a href="/" className="brand"><span className="brand-symbol"><Dna size={22}/></span><span className="brand-name">bioinfobuddy</span></a><nav aria-label="主导航"><a href="/"><MessageSquare size={15}/>AI 对话</a><a href="/workbench" aria-current="page"><Laptop size={15}/>本地工作台</a></nav><div className={`local-connection ${ready?'connected':''}`}><span className="status-dot"/>{ready?'已连接本机':'助手未连接'}</div></header>
    <div className="local-page">
      <div className="local-heading"><div><span className="eyebrow">DATA → FIGURE · LOCAL WORKBENCH</span><h1>从你的数据，生成可复现的图。</h1><p>选择图例、核对转换方案，在自己的电脑上运行。</p></div><button className="button" disabled={disabled||!ready} onClick={()=>void perform('正在刷新',async()=>{const latest=await refresh();if(run){const updated=latest.runs.find(r=>r.id===run.id);if(updated)setRun(updated);}})}><RefreshCw size={15}/>刷新状态</button></div>
      {!ready&&<section className="local-pairing" aria-labelledby="pair-title"><div><span className="local-step">01</span><h2 id="pair-title">连接本地助手</h2><p>数据和图表保存在本机。启动助手后，输入终端显示的 8 位配对码；浏览器提示时允许访问本机网络。</p><details><summary>首次使用：安装与启动</summary><ol><li>下载并解压<a href="https://github.com/SonnyHC/bioinfo-agent-c5/archive/refs/heads/main.zip">项目源码</a>，安装 Node.js 22.18+（22.x）或 24.2+，并按<a href="https://docs.astral.sh/uv/getting-started/installation/" target="_blank" rel="noopener noreferrer">官方说明安装 uv</a>。</li><li>在项目目录打开终端，运行：<code className="command">npm ci --ignore-scripts<br/>npm run setup:companion<br/>npm run companion</code></li><li>保持终端窗口运行。配对码 15 分钟内有效，一次使用；助手重启后需要重新配对。</li></ol><p>Python 技能在连接后按需安装。R 技能需要电脑已安装 R。</p></details></div><form onSubmit={e=>{e.preventDefault();void connect();}}><label className="field"><span>本机配对码</span><input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,8))} inputMode="numeric" autoComplete="off" placeholder="8 位数字" maxLength={8} aria-label="本机配对码" disabled={disabled}/></label><button className="button primary" disabled={disabled||code.length!==8}><Plug size={16}/>连接助手</button><small>配对仅保存在当前标签页会话</small></form></section>}
      {error&&<div className="local-error" role="alert"><AlertTriangle size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="关闭错误">×</button></div>}
      {busy&&<section className="local-progress" aria-live="polite"><div><LoaderCircle size={17} className="spinning"/><strong>{busy}</strong><span>请保持助手运行</span></div>{job?.log&&<details open><summary>任务日志</summary><pre>{job.log}</pre></details>}</section>}
      <div className="local-layout">
        <aside className="local-sidebar"><div className="local-section-title"><h2>我的数据</h2><span>{status?.datasets.length??0}</span></div><input ref={input} type="file" hidden accept=".csv,.tsv,.xlsx,.fastq,.fq,.fastq.gz,.fq.gz,.h5ad,.r,.R" onChange={onFile}/><button className="local-import" disabled={disabled||!ready} onClick={()=>input.current?.click()}><Upload size={22}/><strong>导入本机文件</strong><span>CSV · TSV · XLSX · FASTQ · H5AD · R</span></button><p className="local-import-note">文件只传给本机助手；表格 ≤ 10 MiB，测序文件 ≤ 2 GiB，R 脚本 ≤ 1 MiB。</p><div className="local-datasets">{status?.datasets.map(item=><button key={item.id} className={item.id===data?.id?'selected':''} disabled={disabled} onClick={()=>chooseData(item)}><FileText size={16}/><span><strong>{item.name}</strong><small>{labels[item.kind]} · {sizeLabel(item.size)}</small></span>{item.id===data?.id&&<Check size={14}/>}</button>)}{!status?.datasets.length&&<p className="local-empty-list">连接助手后导入数据，或载入合成样例。</p>}</div><div className="local-sidebar-foot"><FolderOpen size={15}/><span>{status?.dataDir??'文件保存在你的电脑'}</span></div>{ready&&<button className="text-button" disabled={disabled} onClick={()=>{disconnectCompanion();setStatus(null);setData(null);invalidate();}}>断开此标签页</button>}</aside>
        <main className="local-main"><nav className="local-tabs" aria-label="工作台视图">{(['analysis','skills','history'] as const).map(tab=><button key={tab} className={view===tab?'active':''} aria-current={view===tab?'page':undefined} onClick={()=>setView(tab)}>{tab==='analysis'?<Settings2 size={16}/>:tab==='skills'?<Code2 size={16}/>:<History size={16}/>}{{analysis:'选图与分析',skills:'技能与环境',history:'运行记录'}[tab]}{tab==='history'&&!!status?.runs.length&&<span>{status.runs.length}</span>}</button>)}</nav>
          {view==='skills'&&<section className="local-content"><div className="local-section-title"><h2>按需安装分析技能</h2><span>独立依赖环境</span></div><p className="local-muted">安装会下载该技能的运行环境和依赖，首次需要联网；完成后可重复使用。图例代码随助手提供。</p><div className="local-skill-list">{skills.map(skill=><article key={skill.id}><div className="local-skill-icon">{skill.runtime==='r'?<Code2 size={22}/>:<Dna size={22}/>}</div><div><h3>{skill.name}<span>v{skill.version}</span></h3><p>{skill.description}</p><small>{skill.extensions.join(' · ')}</small></div><button className={`button ${skill.installed?'':'primary'}`} disabled={disabled||!ready||skill.installed} onClick={()=>void install(skill)}>{skill.installed?<><CheckCircle2 size={16}/>已安装</>:<><ArrowDownToLine size={16}/>一键安装环境</>}</button></article>)}</div></section>}
          {view==='history'&&<section className="local-content"><div className="local-section-title"><h2>本机运行记录</h2><span>{status?.runs.length??0} 次</span></div>{!status?.runs.length&&<div className="local-empty"><History size={32}/><h3>还没有运行记录</h3><p>确认转换方案并执行后，图表和参数记录会出现在这里。</p></div>}{status?.runs.map(item=><button key={item.id} className="local-history-item" disabled={disabled} onClick={()=>void perform('正在读取运行记录',()=>openRun(item))}><span className={`local-run-state ${item.status}`}>{item.status==='completed'?<CheckCircle2 size={18}/>:item.status==='running'?<LoaderCircle size={18}/>:<AlertTriangle size={18}/>}</span><span><strong>{item.name}</strong><small>{templates.find(t=>t.id===item.template)?.name??item.template} · {dateLabel(item.createdAt)}</small>{item.error&&<small className="local-failure">{item.error}</small>}</span><span>{{completed:'已完成',running:'运行中',failed:'失败'}[item.status]}</span><ArrowRight size={16}/></button>)}</section>}
          {view==='analysis'&&<>
            <section className="local-gallery"><div className="local-section-title"><h2><span className="local-step">02</span>选择图例</h2><span>示意图 · 已配套代码</span></div><div className="local-families" aria-label="图例类别">{Object.entries(labels).map(([id,label])=><button key={id} className={family===id?'active':''} disabled={disabled} onClick={()=>selectTemplate(templates.find(t=>t.skill===id)!)}>{label}</button>)}</div><div className="local-templates">{templates.filter(t=>t.skill===family).map(item=><button key={item.id} className={template===item.id?'selected':''} disabled={disabled} onClick={()=>selectTemplate(item)} aria-pressed={template===item.id}><PlotExample id={item.id}/><strong>{item.name}</strong><span>{item.description}</span>{template===item.id&&<CheckCircle2 size={15} className="local-template-check"/>}</button>)}</div><p className="local-template-note">{activeTemplate.note}</p></section>
            {!data?<section className="local-content local-empty"><Upload size={30}/><h3>选择一份{labels[family]}数据</h3><p>从左侧已有文件中选择，或导入本机文件。</p><div><button className="button primary" disabled={disabled||!ready} onClick={()=>input.current?.click()}>导入文件<ArrowRight size={15}/></button>{['tables','fastq','r-script'].includes(family)&&<button className="button" disabled={disabled||!ready} onClick={()=>void sample()}>{family==='r-script'?'载入 R 示例脚本':'载入合成样例'}</button>}</div>{family==='r-script'&&<p>R 是可执行代码，不是数据表。导入后先检查脚本内容。</p>}{family==='single-cell'&&<p>请导入含有 obsm 嵌入坐标的 H5AD 文件。</p>}</section>:<section className="local-content">
              <div className="local-section-title"><h2><span className="local-step">03</span>{data.name}</h2><span>{sizeLabel(data.size)}</span></div>
              {!activeSkill?.installed&&<div className="local-install-inline"><div><strong>先安装{activeSkill?.name}环境</strong><p>文件已保存在本机。安装完成后即可检查数据、预览和执行。</p></div><button className="button primary" disabled={disabled||!ready} onClick={()=>activeSkill&&void install(activeSkill)}>安装环境</button></div>}
              {!data.profile?<div className="local-empty"><FileText size={28}/><h3>文件已导入，尚未检查</h3><button className="button" disabled={disabled||(!activeSkill?.installed&&data.kind!=='r-script')} onClick={()=>void inspect(data)}>检查文件结构</button></div>:<>
                <details className="local-source" open={!plan}><summary>检查原始数据 {data.profile.rows!==undefined?`· ${data.profile.rows.toLocaleString()} 行`:data.profile.cells!==undefined?`· ${data.profile.cells.toLocaleString()} 个细胞 / ${data.profile.genes?.toLocaleString()} 个基因`:''}</summary>{data.profile.note&&<p>{data.profile.note}</p>}{data.kind==='r-script'?<pre className="local-script">{data.profile.code}</pre>:data.profile.preview?<PreviewTable rows={data.profile.preview} columns={columnsOf(data)}/>:<dl className="local-metadata"><dt>已有嵌入</dt><dd>{data.profile.embeddings?.join('、')||'无'}</dd><dt>细胞注释</dt><dd>{data.profile.annotations?.join('、')||'无'}</dd></dl>}</details>
                <div className="local-parameter-heading"><h3>图例参数</h3><a className="text-button" href={`/?dataset=${data.id}`}>让 AI 帮我选择参数<ArrowRight size={13}/></a></div>
                <fieldset disabled={disabled} className="local-params">
                  {data.kind==='tables'&&<>
                    {['box','violin','bar'].includes(template)&&<label className="field"><span>数据排布</span><select value={String(params.layout??'long')} onChange={e=>changeParams({layout:e.target.value})}><option value="long">长表：分组列 + 数值列</option><option value="wide">宽表：每个数值列作为一组</option></select><small>宽表会展开为 group / value 两列，原始文件保持不变。</small></label>}
                    {((['box','violin','bar'].includes(template)&&params.layout==='wide')||template==='heatmap')?<div className="local-column-picker"><span>数值字段（可多选）</span>{numericOf(data).map(name=><label key={name}><input type="checkbox" checked={Array.isArray(params.valueColumns)&&params.valueColumns.includes(name)} onChange={e=>changeParams({valueColumns:e.target.checked?[...(Array.isArray(params.valueColumns)?params.valueColumns:[]),name]:(Array.isArray(params.valueColumns)?params.valueColumns:[]).filter(v=>v!==name)})}/>{name}</label>)}<small>仅使用勾选的数值列，不自动改变单位或标准化。</small></div>:<SelectField label={template==='scatter'?'Y 轴数值':'数值字段'} value={params.y} values={numericOf(data)} onChange={y=>changeParams({y})} hint="选择需要绘制的连续数值。"/>}
                    {template==='scatter'&&<SelectField label="X 轴数值" value={params.x} values={numericOf(data)} onChange={x=>changeParams({x})} hint="与 Y 轴来自同一行的观测值配对。"/>}
                    {template==='heatmap'?<SelectField label="行标签" value={params.x} values={columnsOf(data).filter(c=>!(Array.isArray(params.valueColumns)&&params.valueColumns.includes(c)))} onChange={x=>changeParams({x})} hint="可选择基因或样本名称列；不选则使用行号。" optional/>:params.layout!=='wide'&&<SelectField label="分组字段" value={params.group} values={columnsOf(data)} onChange={group=>changeParams({group})} hint="按此列中的类别分组；留空时作为同一组。" optional/>}
                    <label className="field"><span>缺失值处理</span><select value={String(params.missing??'error')} onChange={e=>changeParams({missing:e.target.value})}><option value="error">发现缺失值时停止</option><option value="drop">删除参与绘图字段中有缺失值的行</option></select><small>默认不删除数据；选择删除后，请在转换预览核对行数。</small></label>
                    <label className="field"><span>图标题（可选）</span><input value={String(params.title??'')} maxLength={160} onChange={e=>changeParams({title:e.target.value})}/><small>填写具体指标与实验条件，避免把图标题写成统计结论。</small></label>
                  </>}
                  {data.kind==='fastq'&&<label className="field"><span>最多读取的记录数</span><input type="number" min={1} max={1000000} step={1} value={String(params.maxReads??10000)} onChange={e=>changeParams({maxReads:e.target.value===''?'':Number(e.target.value)})}/><small>1–1,000,000；按文件顺序读取前 N 条。预览与执行使用相同参数。</small></label>}
                  {data.kind==='single-cell'&&<><SelectField label="已有嵌入" value={params.embedding} values={data.profile.embeddings??[]} onChange={embedding=>changeParams({embedding})} hint="使用该嵌入的前两维；不会重新计算 UMAP。"/><SelectField label="按细胞注释着色" value={params.color} values={data.profile.annotations??[]} onChange={color=>changeParams({color})} hint="最多支持 30 个类别；连续数值应先按科研目的合理分组。" optional/><label className="field"><span>最多绘制的细胞数</span><input type="number" min={1} max={200000} step={1} value={String(params.maxCells??50000)} onChange={e=>changeParams({maxCells:e.target.value===''?'':Number(e.target.value)})}/><small>1–200,000；取文件中的前 N 个细胞，不是随机抽样。</small></label></>}
                  {data.kind==='r-script'&&<label className="field"><span>附加数据文件（可选）</span><select value={dataId} onChange={e=>{setDataId(e.target.value);invalidate();}}><option value="">无附加数据</option>{status?.datasets.filter(d=>d.kind==='tables').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><small>传给脚本的 input_file 变量。数据格式须与脚本读取方式一致。</small></label>}
                </fieldset><div className="local-preview-action"><p>先检查转换后的数据，再确认执行。</p><button className="button primary" disabled={disabled||!activeSkill?.installed} onClick={()=>void preview()}>预览转换方案<ArrowRight size={16}/></button></div>
              </>}
              {plan&&<section className="local-plan" aria-labelledby="plan-title"><div className="local-section-title"><h2 id="plan-title"><span className="local-step">04</span>核对转换方案</h2><span>{run?.status==='completed'?'已执行':'待确认'}</span></div>{plan.inputRows===undefined&&plan.outputRows!==undefined&&<p className="local-row-flow">提取 <strong>{plan.outputRows.toLocaleString()}</strong> 条记录用于绘图</p>}{plan.inputRows!==undefined&&<p className="local-row-flow">输入 <strong>{plan.inputRows.toLocaleString()}</strong> 行<ArrowRight size={16}/>输出 <strong>{plan.outputRows?.toLocaleString()}</strong> 行{plan.droppedRows?` · 删除 ${plan.droppedRows} 行`:''}</p>}<ol className="local-steps">{plan.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>{plan.warnings.map((warning,i)=><Notice key={i}>{warning}</Notice>)}{!!plan.preview.length&&<PreviewTable rows={plan.preview} columns={plan.outputColumns}/>}<details className="local-source"><summary>查看执行参数与源文件校验值</summary><pre>{JSON.stringify({template:plan.template,params:plan.params,sourceSha256:plan.sourceSha256},null,2)}</pre></details><div className="approval-panel"><label className="approval-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={disabled}/>我已核对字段、转换步骤、行数及提示</label>{data?.kind==='r-script'&&<label className="approval-check"><input type="checkbox" checked={trustScript} onChange={e=>setTrustScript(e.target.checked)} disabled={disabled}/>我已阅读并信任此 R 脚本，允许它以本机用户权限运行；独立包环境不是安全沙箱</label>}<button className="button primary" disabled={disabled||!reviewed||(data?.kind==='r-script'&&!trustScript)||!activeSkill?.installed} onClick={()=>void execute()}><Play size={15}/>确认并在本机生成</button></div></section>}
              {run&&<section className="local-result"><div className="local-section-title"><h2>{run.status==='completed'?'图表已生成':run.status==='failed'?'运行失败':'任务正在运行'}</h2><span>{dateLabel(run.createdAt)}</span></div>{run.status==='failed'?<Notice>{run.error}</Notice>:run.status==='running'?<p className="local-muted">保持助手运行，稍后点击“刷新状态”查看结果。</p>:<>{imageError?<Notice>{imageError}</Notice>:<div className="figure-paper">{imageUrl?<img src={imageUrl} alt={`${activeTemplate.name}：${run.name}`} onError={()=>setImageError('图片无法预览，请下载结果文件查看。')}/>:<p>{run.artifacts.some(n=>/\.png$/i.test(n))?'正在读取本机图表…':'未生成 PNG 预览，请下载 SVG 或 PDF 查看。'}</p>}</div>}{Array.isArray(run.summary?.warnings)&&run.summary.warnings.map((w,i)=><Notice key={i}>{String(w)}</Notice>)}<div className="local-downloads">{run.artifacts.map(name=><button key={name} className="button" disabled={disabled} onClick={()=>void download(run,name)}><ArrowDownToLine size={14}/>{name}</button>)}</div><p className="local-muted">图表、处理后的数据和参数记录均保存在本机。请下载所需文件用于复现和分享。</p></>}</section>}
            </section>}
          </>}
        </main>
      </div><footer className="local-footer"><span>本地计算 · 原始文件保留 · 转换方案可核对</span><span>AI 对话会向你选择的模型发送工具返回的数据概要与预览</span></footer>
    </div>
  </div>;
}
