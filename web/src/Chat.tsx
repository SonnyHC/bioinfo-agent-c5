import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, BookOpen, Check, Database, Dna, Download, History, Images, LoaderCircle, Menu, MessageSquare, Package, Plus, Settings2, Square, Upload, X } from 'lucide-react';
import { api, importDataset, post } from './api';
import { providers, PROVIDER, savedSettings, storeSettings, type Provider, type ModelSettings } from './model-settings';
import { requestModel } from './model-api';
import { list, save } from './storage';
import { runAgent } from './agent-loop';
import type { Message, ToolEvent } from './agent-loop';
import { executeTool, systemPrompt, toolDefinitions, toolLabels } from './agent-tools';
import { skillCatalog, type AnalysisSkill } from './skill-catalog';
import { skillPrompt } from './skill-library';

import App from './App';
import Tutorial from './Tutorial';
import { appRoute, messageParts, safeAppLink, viewLabels } from './navigation';
import type { AnalysisView, MainView } from './navigation';
import './chat.css';
const ReferenceGenomes = lazy(() => import('./ReferenceGenomes'));
const SkillStore = lazy(() => import('./SkillStore'));
const OmicsResources = lazy(() => import('./OmicsResources'));

interface Conversation { id: string; title: string; createdAt: string; messages: Message[]; events: ToolEvent[]; skillId?: string }
const fresh = (): Conversation => ({ id: crypto.randomUUID(), title: '新对话', createdAt: new Date().toISOString(), messages: [], events: [] });
interface ChatDataset {id:string; name:string}
function recover(previous: Conversation): Conversation {
  const messages = [...previous.messages];
  const incomplete = messages.findIndex((m, i) => m.tool_calls?.some(call => !messages.slice(i + 1).some(item => item.role === 'tool' && item.tool_call_id === call.id)));
  if (incomplete >= 0) messages.splice(incomplete);
  return { ...previous, messages, events: previous.events.map(event => event.state === 'running' ? { ...event, state: 'error', detail: '上次操作已中断' } : event) };
}

const examplePrompts = [
  '单细胞质控时，nFeature_RNA 和线粒体比例的阈值应该怎么定？',
  '我有一份 RNA-seq count 矩阵，差异分析选 DESeq2 还是 edgeR？',
  '两组样本量都只有 3 个，箱线图上还适合做 t 检验吗？',
];

function MessageText({ text, onOpen }: { text: string; onOpen: (href:string)=>void }) {
  return <div className="chat-message-text">{messageParts(text).map((part,index) => part.href ? <a key={index} href={part.href} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onOpen(part.href!);}}}>{part.text} ↗</a> : <span key={index}>{part.text}</span>)}</div>;
}

export default function Chat() {
  const initialRoute = appRoute(window.location.pathname + window.location.search);
  const [view, setView] = useState<MainView>(initialRoute.view);
  const [panelView,setPanelView] = useState<AnalysisView>(initialRoute.view === 'history' ? 'history' : 'analysis');
  const mobileNavigation = useRef<HTMLDialogElement>(null);
  const [conversation, setConversation] = useState<Conversation>(fresh);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [datasets, setDatasets] = useState<ChatDataset[]>([]);
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(providers.deepseek.model);
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [workspace, setWorkspace] = useState('');
  const activeSettings = useRef<ModelSettings>({provider:'deepseek',key:'',model:providers.deepseek.model,workspace:'',remember:false});
  const [routeKey,setRouteKey] = useState(window.location.search);
  function restoreSettings(value:ModelSettings) {setProvider(value.provider);setApiKey(value.key);setModel(value.model);setWorkspace(value.workspace);setRemember(value.remember);}
  function openSettings() {restoreSettings(activeSettings.current);setError('');setSettings(true);}
  function closeSettings() {restoreSettings(activeSettings.current);setSettings(false);setError('');}
  const [selectedDataset, setSelectedDataset] = useState<ChatDataset|null>(null);
  const requestedDataset = useRef(new URLSearchParams(window.location.search).get('dataset'));
  const preparedRequest = useRef(false);
  const [remember, setRemember] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const abort = useRef<AbortController | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  function showRoute(path: string, push = true) {
    const safe = safeAppLink(path);
    if (!safe) return;
    const next = appRoute(safe);
    if (push) window.history.pushState(null, '', safe);
    setView(next.view); setRouteKey(safe);
    if (next.view === 'analysis' || next.view === 'history') setPanelView(next.view);
    mobileNavigation.current?.close();
    if (next.view === 'chat' && next.request.dataset) void selectForChat(next.request.dataset, false);
    void refreshData();
  }
  function navigate(next:MainView) { showRoute(next === 'chat' ? '/' : `/?view=${next}`); }
  async function selectForChat(id: string, push = true) {
    try {
      const selected = await api<ChatDataset>(`/datasets/${encodeURIComponent(id)}`);
      setSelectedDataset(selected); setError('');
      setInput(`请先检查表格「${selected.name}」（数据 ID：${selected.id}），帮我选择适合的图例和参数，并生成待确认的转换方案。`);
      requestedDataset.current = id; preparedRequest.current = true;
      setView('chat'); mobileNavigation.current?.close();
      if (push) window.history.pushState(null, '', `/?dataset=${encodeURIComponent(id)}`);
      await refreshData();
    } catch (reason) {setError(reason instanceof Error ? reason.message : '无法打开此数据。');setView('chat');}
  }
  function newChat() { setConversation(fresh()); setError(''); setInput(''); setSelectedDataset(null); navigate('chat'); }
  function useSkill(skill: AnalysisSkill) {
    if (started.current || loading) return;
    setConversation({...fresh(), skillId:skill.id}); setError(''); setSelectedDataset(null);
    setInput(skill.starter); navigate('chat');
  }
  async function refreshData() {
    const data = await api<{datasets:ChatDataset[]}>('/datasets');
    setDatasets(data.datasets);
    if (requestedDataset.current && !preparedRequest.current) {
      const selected = data.datasets.find(item=>item.id===requestedDataset.current);
      preparedRequest.current = true;
      if (selected) {setSelectedDataset(selected);setInput(`请先检查表格「${selected.name}」（数据 ID：${selected.id}），帮我选择图例和参数。`);}
      else setError('此浏览器中找不到指定表格，请重新导入。');
    }
  }
  useEffect(() => {
    document.title = 'bioinfobuddy';
    try {
      const selected = localStorage.getItem(PROVIDER) || 'deepseek';
      const current = (Object.hasOwn(providers,selected) ? selected : 'deepseek') as Provider;
      const saved = savedSettings(current);
      restoreSettings(saved); activeSettings.current = saved; setSettings(false);
    } catch { setSettings(false); }
    void Promise.all([list<Conversation>('chats'), refreshData()]).then(([saved]) => {
      // Recover every saved conversation, including older history selections.
      const recovered = saved.map(recover);
      setHistory(recovered);
      if (recovered[0] && !requestedDataset.current) setConversation(recovered[0]);
    }).catch(reason => setError(String(reason.message))).finally(() => setLoading(false));
    const onFocus = () => { void refreshData().catch(() => {}); };
    window.addEventListener('focus', onFocus);

    return () => { window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => {
    const onPop = () => showRoute(window.location.pathname + window.location.search, false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (settings && !dialog.current?.open) dialog.current?.showModal();
    if (!settings && dialog.current?.open) dialog.current.close();
  }, [settings]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [conversation.messages.length, progress]);

  async function persist(next: Conversation) {
    setConversation({ ...next });
    await save('chats', next);
    setHistory(previous => [next, ...previous.filter(item => item.id !== next.id)]);
  }
  function saveSettings() {
    try {
      const value = {provider,key:apiKey.trim(),model:model.trim(),workspace:workspace.trim(),remember};
      storeSettings(value); activeSettings.current = value; restoreSettings(value); setSettings(false); setError('');
    } catch (reason) {setError(reason instanceof Error ? reason.message : '无法保存设置。');}
  }
  async function send() {
    const prompt = input.trim();
    if (!prompt || started.current || loading) return;
    if (!apiKey) { openSettings(); return; }
    started.current = true; setBusy(true); setError(''); setInput('');
    abort.current = new AbortController();
    const signal = abort.current.signal;
    let current = { ...conversation, messages: [...conversation.messages, { role: 'user', content: prompt } as Message], title: conversation.messages.length ? conversation.title : prompt.slice(0, 28) };
    try {
      await persist(current);
      await runAgent({
        messages: current.messages, signal,
        request: async messages => {
          setProgress('正在分析');
          const workflows = await skillPrompt(current.skillId);
          return requestModel(activeSettings.current, [{role:'system',content:`${systemPrompt}\n${workflows}`},...messages], toolDefinitions, signal);
        },
        execute: (name, args) => executeTool(name, args, signal),
        changed: async (messages, event) => {
          const events = event ? [...current.events.filter(item => item.id !== event.id), { ...event }] : current.events;
          current = { ...current, messages, events };
          if (event) setProgress(`${toolLabels[event.name] || event.name}${event.state === 'running' ? '…' : event.state === 'done' ? ' · 完成' : ' · 需处理'}`);
          await persist(current);
        },
      });
      await refreshData();
    } catch (reason) { setError(signal.aborted ? '已停止，可以继续对话。' : reason instanceof Error ? reason.message : '本次请求未完成。'); }
    finally { started.current = false; setBusy(false); setProgress(''); abort.current = null; }
  }
  async function upload(selected: File) {
    if (started.current) return;
    started.current = true; setBusy(true); setProgress('正在读取数据'); setError('');
    try {
      const imported = await importDataset(selected);
      setSelectedDataset(imported); await refreshData();
      showRoute(`/?view=analysis&dataset=${imported.id}`);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败。'); }
    finally { started.current = false; setBusy(false); setProgress(''); }
  }
  async function example() {
    if (started.current) return;
    started.current = true; setBusy(true); setProgress('正在载入样例'); setError('');
    try {
      const imported = await post<ChatDataset>('/examples/wide');
      setSelectedDataset(imported); await refreshData();
      showRoute(`/?view=analysis&dataset=${imported.id}`);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '载入失败。'); }
    finally { started.current = false; setBusy(false); setProgress(''); }
  }
  function exportChat() {
    const blob = new Blob([JSON.stringify(conversation, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `bioinfobuddy-chat-${conversation.id.slice(0, 8)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const navigation = <>
    <a href="/" className="chat-brand" onClick={event=>{event.preventDefault();navigate('chat');}}><Dna size={24}/><strong>bioinfobuddy</strong></a>
    <button className="button new-chat" disabled={busy || loading} onClick={newChat}><Plus size={17}/>新对话</button>
    <nav className="chat-primary-nav" aria-label="主要功能">
      {([{id:'chat',icon:MessageSquare},{id:'analysis',icon:Database},{id:'skills',icon:Package},{id:'omics',icon:Images},{id:'history',icon:History},{id:'tutorial',icon:BookOpen}] as const).map(({id,icon:Icon})=><button key={id} className={view===id?'active':''} aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={17}/><span>{viewLabels[id]}</span></button>)}
      <button className={view==='genomes'?'active':''} aria-current={view==='genomes'?'page':undefined} onClick={()=>navigate('genomes')}><Dna size={17}/><span>参考基因组</span></button>
    </nav>
    <span className="chat-section-label">最近对话</span>
    <nav className="chat-history" aria-label="最近对话">{history.map(item=><button key={item.id} disabled={busy} className={view==='chat'&&item.id===conversation.id?'active':''} onClick={()=>{setConversation(item);setError('');navigate('chat');}} title={item.title}><MessageSquare size={15}/><span>{item.title}</span></button>)}{!history.length&&<p>暂无对话。对话记录保存在此浏览器。</p>}</nav>
    <div className="chat-rail-bottom"><button disabled={busy} onClick={()=>{mobileNavigation.current?.close();openSettings();}}><Settings2 size={16}/>{apiKey?'模型设置':'配置模型 API'}</button></div>
  </>;
  return <div className="chat-shell">
    <aside className="chat-rail" aria-label="主侧边栏">{navigation}</aside>
    <dialog ref={mobileNavigation} className="chat-navigation-dialog" aria-label="导航菜单"><button className="icon-button chat-menu-close" aria-label="关闭导航菜单" onClick={()=>mobileNavigation.current?.close()}><X size={20}/></button>{navigation}</dialog>
    <main className="chat-main">
      <header className="chat-header"><button className="icon-button chat-menu" aria-label="打开导航菜单" onClick={()=>mobileNavigation.current?.showModal()}><Menu size={20}/></button><span>{view==='chat'?(conversation.messages.length?conversation.title:'新对话'):viewLabels[view]}</span><div><button className="chat-model" disabled={busy} onClick={openSettings}>{model}<Settings2 size={13}/></button>{view==='chat'&&<button className="icon-button" aria-label="导出当前对话" disabled={!conversation.messages.length} onClick={exportChat}><Download size={16}/></button>}</div></header>
      <section className="chat-conversation" hidden={view!=='chat'} aria-label="AI 对话">
      <div className="chat-scroll">
        {!conversation.messages.length ? <section className="chat-welcome"><h1>生信分析助手</h1><p>讨论分析方法，或导入表格，让模型检查字段并生成待你确认的绘图方案。</p><div className="chat-starters"><button className="button primary" disabled={busy || loading} onClick={() => file.current?.click()}><Upload size={15}/>导入表格</button><button className="button" disabled={busy || loading} onClick={() => void example()}>载入样例数据</button></div><div className="chat-examples"><span>可以这样问</span>{examplePrompts.map(prompt => <button key={prompt} disabled={busy || loading} onClick={() => setInput(prompt)}>{prompt}</button>)}</div></section> : <div className="chat-transcript">{conversation.messages.map((message, index) => message.role === 'tool' || message.role === 'system' ? null : <div key={index} className={`chat-message ${message.role}`}>
          {message.role === 'assistant' && <Dna className="chat-avatar" size={22}/>}
          <div>{message.content && <MessageText text={message.content} onOpen={showRoute}/>}{message.tool_calls?.map(call => { const event = conversation.events.find(item => item.id === call.id); return <div className="tool-step" key={call.id}>{event?.state === 'running' ? <LoaderCircle className="spinning" size={14}/> : event?.state === 'done' ? <Check size={14}/> : <Settings2 size={14}/>}<span>{toolLabels[call.function.name] || call.function.name}{event?.detail && ` · ${event.detail}`}</span>{event?.url && safeAppLink(event.url) && <a href={safeAppLink(event.url)} onClick={e=>{e.preventDefault();showRoute(event.url!);}}>打开<ArrowUpRight size={12}/></a>}</div>; })}</div>
        </div>)}</div>}
        <div ref={end}/>
      </div>
      <div className="chat-compose-area">
        {!apiKey && <div className="chat-connection"><span>尚未配置模型 API，对话功能暂不可用；绘图和其他页面不受影响。</span><button className="text-link" onClick={openSettings}>配置模型 API</button></div>}
        {error && <div className="chat-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={15}/></button></div>}
        {conversation.skillId && <div className="chat-skill-strip"><Package size={14}/><span>本轮技能：{skillCatalog.find(skill => skill.id === conversation.skillId)?.name ?? conversation.skillId}</span><button disabled={busy} onClick={()=>navigate('skills')}>管理技能</button><button disabled={busy} aria-label="取消本轮指定技能" onClick={()=>{const next = {...conversation,skillId:undefined};if(next.messages.length)void persist(next).catch(reason=>setError(String(reason.message)));else setConversation(next);}}>取消指定<X size={12}/></button></div>}
        {!!datasets.length && <div className="chat-data-strip"><Database size={13}/><span>{selectedDataset ? '当前数据：' : `已导入 ${datasets.length} 份数据，最近：`}</span><a href={`/?view=analysis&dataset=${(selectedDataset||datasets[0]).id}`} onClick={event=>{event.preventDefault();showRoute(`/?view=analysis&dataset=${(selectedDataset||datasets[0]).id}`);}} title={(selectedDataset||datasets[0]).name}>{(selectedDataset||datasets[0]).name}</a></div>}
        <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          <textarea aria-label="分析要求" placeholder="描述数据或分析问题" value={input} onChange={event => setInput(event.target.value)} maxLength={12000} disabled={loading} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/>
          <div className="chat-compose-actions"><div><button type="button" className="icon-button" aria-label="导入数据文件" disabled={busy || loading} onClick={() => file.current?.click()}><Plus size={20}/></button><span aria-live="polite">{progress || '可附加 CSV、TSV、XLSX（≤ 2 MB）'}</span></div>{busy && abort.current ? <button type="button" className="chat-send" aria-label="停止生成" onClick={() => abort.current?.abort()}><Square size={15}/></button> : <button type="submit" className="chat-send" aria-label="发送" disabled={busy || loading || !input.trim()}><ArrowUp size={19}/></button>}</div>
        </form><p className="chat-footnote">表格在本站分析服务中处理，模型只接收必要的数据预览。Enter 发送，Shift + Enter 换行。</p>
      </div>
      <input ref={file} type="file" accept=".csv,.tsv,.xlsx" className="sr-only" aria-label="选择分析数据" onChange={event => { const selected = event.target.files?.[0]; if (selected) void upload(selected); event.target.value = ''; }}/>
      </section>
      {view==='tutorial'&&<Tutorial onNavigate={navigate}/>}
      {view==='omics'&&<Suspense fallback={<p role="status" className="genome-loading">正在载入组学案例…</p>}><OmicsResources onNavigate={navigate}/></Suspense>}
      {view==='genomes'&&<Suspense fallback={<p role="status" className="genome-loading">正在载入参考基因组…</p>}><ReferenceGenomes/></Suspense>}
      {view==='skills'&&<Suspense fallback={<p role="status" className="genome-loading">正在载入技能库…</p>}><SkillStore onUse={useSkill} agentBusy={busy || loading}/></Suspense>}
      {(view==='analysis'||view==='history')&&<section className="chat-analysis" aria-label={viewLabels[panelView]}><App key={routeKey} embedded initialHistory={view==='history'} onDataset={(id:string)=>void selectForChat(id)}/></section>}
    </main>
    <dialog ref={dialog} className="model-dialog" onCancel={closeSettings}>
      <div className="model-dialog-heading"><Dna size={23}/><h2>{apiKey ? '模型设置' : '配置 API Key'}</h2><button className="icon-button" aria-label="关闭模型设置" onClick={closeSettings}><X size={19}/></button></div>
      <p>选择模型提供商并填写该平台的 API Key。</p>
      <form onSubmit={event => { event.preventDefault(); saveSettings(); }}>
        <label className="field"><span>模型提供商</span><select value={provider} onChange={event => {
          const next = event.target.value as Provider;
          try {restoreSettings(savedSettings(next));}
          catch {restoreSettings({provider:next,key:'',remember:false,model:providers[next].model,workspace:''});}
          setError('');
        }}>{Object.entries(providers).map(([id,item])=><option value={id} key={id}>{item.name}</option>)}</select></label>
        <label className="field"><span>{providers[provider].name} API Key</span><input type="password" autoComplete="off" placeholder="粘贴此平台的 API Key" value={apiKey} onChange={event => setApiKey(event.target.value)} required/></label>
        <label className="field"><span>模型 ID</span><input list="provider-models" value={model} onChange={event => setModel(event.target.value)} placeholder={providers[provider].model} required/><datalist id="provider-models">{providers[provider].models.map(name=><option key={name} value={name}/>)}</datalist></label>
        {provider==='qwen'&&<label className="field"><span>业务空间 ID（可选）</span><input value={workspace} onChange={event=>setWorkspace(event.target.value)} placeholder="llm-…"/></label>}
        <p className="model-storage-note">{providers[provider].note}</p>
        <label className="remember-key"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/>在此浏览器记住 API Key</label>
        <p className="model-storage-note">未勾选时，密钥仅保留在当前标签会话。密钥经本站 API 转发至所选官方平台，本站不持久保存密钥。模型接收对话与必要数据预览；表格在本站分析服务临时处理。</p>
        {error && <p className="model-error" role="alert">{error}</p>}
        <button className="button primary full-width" type="submit">保存设置</button>
      </form>
      <div className="model-dialog-links"><a href={providers[provider].keys} target="_blank" rel="noopener noreferrer">获取 API Key ↗</a><a href={providers[provider].docs} target="_blank" rel="noopener noreferrer">官方 API 文档 ↗</a></div>
    </dialog>
  </div>;
}
