import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Check, Database, Dna, Download, LoaderCircle, MessageSquare, Plus, Settings2, Square, Upload, X } from 'lucide-react';
import { companion, companionFetch, companionConnected } from './companion';
import { list, save } from './storage';
import { runAgent } from './agent-loop';
import type { Message, ToolEvent } from './agent-loop';
import { executeTool, systemPrompt, toolDefinitions, toolLabels } from './agent-tools';

import './chat.css';

interface Conversation { id: string; title: string; createdAt: string; messages: Message[]; events: ToolEvent[] }
const fresh = (): Conversation => ({ id: crypto.randomUUID(), title: '新对话', createdAt: new Date().toISOString(), messages: [], events: [] });
const KEY = 'bioinfobuddy-api-key';
const MODEL = 'bioinfobuddy-model';
const PROVIDER = 'bioinfobuddy-provider';
const providers = {
  deepseek: {name:'DeepSeek', model:'deepseek-chat', keys:'https://platform.deepseek.com/api_keys'},
  openai: {name:'OpenAI', model:'gpt-4.1-mini', keys:'https://platform.openai.com/api-keys'},
  qwen: {name:'通义千问（北京）', model:'qwen-plus', keys:'https://bailian.console.aliyun.com/'},
};
type Provider = keyof typeof providers;
interface ChatDataset {id:string; name:string; kind:string}
function savedSettings(provider:Provider) {
  const suffix = ':' + provider;
  const local = localStorage.getItem(KEY + suffix) || (provider === 'deepseek' ? localStorage.getItem(KEY) : null);
  const key = local || sessionStorage.getItem(KEY + suffix) || (provider === 'deepseek' ? sessionStorage.getItem(KEY) : '') || '';
  return {key, remember:!!local, model:localStorage.getItem(MODEL + suffix) || (provider === 'deepseek' ? localStorage.getItem(MODEL) : '') || providers[provider].model};
}
function recover(previous: Conversation): Conversation {
  const messages = [...previous.messages];
  const incomplete = messages.findIndex((m, i) => m.tool_calls?.some(call => !messages.slice(i + 1).some(item => item.role === 'tool' && item.tool_call_id === call.id)));
  if (incomplete >= 0) messages.splice(incomplete);
  return { ...previous, messages, events: previous.events.map(event => event.state === 'running' ? { ...event, state: 'error', detail: '上次操作已中断' } : event) };
}

// Intent: researchers describe an analysis and inspect the resulting plan.
// Hierarchy: the composer/response is central, data and history stay in the rail.
// Domain: samples, groups, tables, analysis plans, figures, reproducible records.
// Color world: laboratory paper, graphite, teal glass, steel rules, amber errors.
// Signature: live scientific-tool steps with direct links into the plotting sheet.
// Avoid decorative charts, metric cards and a second competing dashboard.
// Palette/depth: existing --ink/--sheet/--teal tokens, subtle inset input.
// Type: 14px UI, 30px empty-state title; 4px spacing grid, 240px rail.
function MessageText({ text }: { text: string }) {
  // Render only safe internal Markdown links; all other model text stays text.
  return <div className="chat-message-text">{text.split(/(\[[^\]]+\]\(\/workbench(?:\?[^)\s]*)?\))/g).map((part, index) => {
    const match = /^\[([^\]]+)\]\((\/workbench(?:\?[^)\s]*)?)\)$/.exec(part);
    return match ? <a key={index} href={match[2]}>{match[1]} ↗</a> : <span key={index}>{part}</span>;
  })}</div>;
}

export default function Chat() {
  const [conversation, setConversation] = useState<Conversation>(fresh);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [datasets, setDatasets] = useState<ChatDataset[]>([]);
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [connected, setConnected] = useState(false);
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

  async function refreshData() {
    if (!companionConnected()) {setConnected(false); setDatasets([]); return;}
    try {
      const status = await companion<{datasets:ChatDataset[]}>('/status'); setDatasets(status.datasets); setConnected(true);
      if (requestedDataset.current && !preparedRequest.current) {
        const selected = status.datasets.find(item=>item.id===requestedDataset.current);
        preparedRequest.current = true;
        if (selected) {
          setSelectedDataset(selected);
          setInput(`请先检查本地文件「${selected.name}」（数据 ID：${selected.id}），帮我选择适合的图例和参数，并生成待确认的转换方案。`);
        } else setError('工作台指定的数据不在当前助手中，请重新选择文件。');
      }
    }
    catch { setConnected(false); setDatasets([]); }
  }
  useEffect(() => {
    document.title = 'bioinfobuddy';
    try {
      const selected = localStorage.getItem(PROVIDER) || 'deepseek';
      const current = (Object.hasOwn(providers,selected) ? selected : 'deepseek') as Provider;
      const saved = savedSettings(current);
      setProvider(current); setApiKey(saved.key); setRemember(saved.remember); setModel(saved.model); setSettings(!saved.key);
    } catch { setSettings(true); }
    void Promise.all([list<Conversation>('chats'), refreshData()]).then(([saved]) => {
      // Recover every saved conversation, including older history selections.
      const recovered = saved.map(recover);
      setHistory(recovered);
      if (recovered[0] && !requestedDataset.current) setConversation(recovered[0]);
    }).catch(reason => setError(String(reason.message))).finally(() => setLoading(false));
    const onFocus = () => { void refreshData().catch(() => {}); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('bioinfobuddy-companion-change', onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('bioinfobuddy-companion-change', onFocus); };
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
    if (!/^[\x21-\x7e]{8,512}$/.test(apiKey.trim())) { setError('请填写有效的 API Key。'); return; }
    if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(model.trim())) { setError('请填写有效的模型名称。'); return; }
    try {
      const scopedKey = KEY + ':' + provider;
      localStorage.removeItem(scopedKey); sessionStorage.removeItem(scopedKey);
      if (provider === 'deepseek') {localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);}
      (remember ? localStorage : sessionStorage).setItem(scopedKey, apiKey.trim());
      localStorage.setItem(MODEL + ':' + provider, model.trim()); localStorage.setItem(PROVIDER,provider);
      setApiKey(apiKey.trim()); setModel(model.trim()); setSettings(false); setError('');
    } catch { setError('浏览器未允许保存设置，请检查网站存储权限。'); }
  }
  async function send() {
    const prompt = input.trim();
    if (!prompt || started.current || loading) return;
    if (!connected || !companionConnected()) {setError('请先进入“数据与绘图”连接本地助手，再开始对话。'); return;}
    if (!apiKey) { setSettings(true); return; }
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
          const response = await companionFetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model, provider, messages: [{ role: 'system', content: systemPrompt }, ...messages], tools: toolDefinitions }), signal });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.message) throw new Error(data.error || `模型请求失败（${response.status}）。`);
          return data.message;
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
      if (!connected) throw new Error('请先进入“数据与绘图”连接本地助手。');
      await companionFetch('/datasets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(selected.name)},body:selected}); await refreshData();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败。'); }
    finally { started.current = false; setBusy(false); setProgress(''); }
  }
  async function example() {
    if (started.current) return;
    started.current = true; setBusy(true); setProgress('正在载入样例'); setError('');
    try {
      if (!connected) throw new Error('请先进入“数据与绘图”连接本地助手，并安装基础科研绘图技能。');
      await companionFetch('/datasets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'synthetic-groups.csv'},body:new Blob(['Control,Treatment\n3,5\n4,7\n5,6\n4,8\n6,9\n'],{type:'text/csv'})});
      await refreshData(); setInput('检查刚导入的合成宽表，制定 Control 和 Treatment 的箱线图方案。');
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

  return <div className="chat-shell">
    <aside className="chat-rail" aria-label="对话与数据">
      <a href="/" className="chat-brand"><Dna size={24}/><strong>bioinfobuddy</strong></a>
      <button className="button new-chat" disabled={busy || loading} onClick={() => { setConversation(fresh()); setError(''); setInput(''); }}><Plus size={17}/>新对话</button>
      <a className="chat-workbench" href="/workbench"><Database size={16}/>数据与绘图<ArrowUpRight size={15}/></a>
      <span className="chat-section-label">最近对话</span>
      <nav className="chat-history" aria-label="最近对话">{history.map(item => <button key={item.id} disabled={busy} className={item.id === conversation.id ? 'active' : ''} onClick={() => { setConversation(item); setError(''); }} title={item.title}><MessageSquare size={15}/><span>{item.title}</span></button>)}{!history.length && <p>对话会保存在此浏览器</p>}</nav>
      <div className="chat-rail-bottom"><a href="/workbench"><span className={`status-dot ${connected ? '' : 'disconnected'}`}/>{connected ? '本地助手已连接' : '连接本地助手'}</a><button className="icon-button" aria-label="模型设置" disabled={busy} onClick={() => setSettings(true)}><Settings2 size={18}/></button></div>
    </aside>
    <main className="chat-main">
      <header className="chat-header"><span>{conversation.messages.length ? conversation.title : '生信分析'}</span><div><a className="chat-mobile-workbench" href="/workbench">数据与绘图 ↗</a><button className="chat-model" disabled={busy} onClick={() => setSettings(true)}>{model}<Settings2 size={13}/></button><button className="icon-button" aria-label="导出当前对话" disabled={!conversation.messages.length} onClick={exportChat}><Download size={16}/></button></div></header>
      <div className="chat-mobile-history"><button className="button" disabled={busy || loading} onClick={() => { setConversation(fresh()); setError(''); setInput(''); }}><Plus size={16}/>新对话</button><select aria-label="选择历史对话" disabled={busy || loading} value={history.some(item => item.id === conversation.id) ? conversation.id : ''} onChange={event => { const selected = history.find(item => item.id === event.target.value); if (selected) { setConversation(selected); setError(''); } }}><option value="" disabled>最近对话</option>{history.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      <div className="chat-scroll">
        {!conversation.messages.length ? <section className="chat-welcome"><div className="chat-welcome-mark"><Dna size={38} strokeWidth={1.4}/></div><h1>开始生信分析</h1><p>选一张图，让 AI 帮你整理数据，在自己的电脑上生成。</p><div className="chat-starters"><button disabled={busy || loading} onClick={() => file.current?.click()}><Upload size={17}/>导入实验数据</button><button disabled={busy || loading} onClick={() => void example()}><Database size={17}/>试用分组样例</button></div></section> : <div className="chat-transcript">{conversation.messages.map((message, index) => message.role === 'tool' || message.role === 'system' ? null : <div key={index} className={`chat-message ${message.role}`}>
          {message.role === 'assistant' && <Dna className="chat-avatar" size={22}/>}
          <div>{message.content && <MessageText text={message.content}/>}{message.tool_calls?.map(call => { const event = conversation.events.find(item => item.id === call.id); return <div className="tool-step" key={call.id}>{event?.state === 'running' ? <LoaderCircle className="spinning" size={14}/> : event?.state === 'done' ? <Check size={14}/> : <Settings2 size={14}/>}<span>{toolLabels[call.function.name] || call.function.name}{event?.detail && ` · ${event.detail}`}</span>{event?.url && <a href={event.url}>打开<ArrowUpRight size={12}/></a>}</div>; })}</div>
        </div>)}</div>}
        <div ref={end}/>
      </div>
      <div className="chat-compose-area">
        {!connected && <div className="chat-connection"><span>先启动本地助手，连接后即可导入数据和使用 AI。</span><a href="/workbench">连接与安装指引 ↗</a></div>}
        {error && <div className="chat-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={15}/></button></div>}
        {!!datasets.length && <div className="chat-data-strip"><Database size={13}/><span>{selectedDataset ? '当前选择' : `${datasets.length} 份数据`}</span><a href="/workbench" title={(selectedDataset||datasets[0]).name}>{(selectedDataset||datasets[0]).name}</a></div>}
        <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          <textarea aria-label="分析要求" placeholder="描述你的数据或分析需求…" value={input} onChange={event => setInput(event.target.value)} maxLength={12000} disabled={loading} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/>
          <div className="chat-compose-actions"><div><button type="button" className="icon-button" aria-label="导入数据文件" disabled={busy || loading} onClick={() => file.current?.click()}><Plus size={20}/></button><span aria-live="polite">{progress || '表格 · FASTQ · H5AD · R'}</span></div>{busy && abort.current ? <button type="button" className="chat-send" aria-label="停止生成" onClick={() => abort.current?.abort()}><Square size={15}/></button> : <button type="submit" className="chat-send" aria-label="发送" disabled={busy || loading || !input.trim()}><ArrowUp size={19}/></button>}</div>
        </form><p className="chat-footnote">原始数据在本机 · 模型接收必要概要与预览 · Shift + Enter 换行</p>
      </div>
      <input ref={file} type="file" accept=".csv,.tsv,.xlsx,.fastq,.fq,.gz,.h5ad,.r,.R" className="sr-only" aria-label="选择分析数据" onChange={event => { const selected = event.target.files?.[0]; if (selected) void upload(selected); event.target.value = ''; }}/>
    </main>
    <dialog ref={dialog} className="model-dialog" onCancel={() => setSettings(false)}>
      <div className="model-dialog-heading"><Dna size={23}/><h2>{apiKey ? '模型设置' : '配置 API Key'}</h2><button className="icon-button" aria-label="关闭模型设置" onClick={() => setSettings(false)}><X size={19}/></button></div>
      <p>选择提供商，使用自己的 API Key。</p>
      <form onSubmit={event => { event.preventDefault(); saveSettings(); }}>
        <label className="field"><span>模型提供商</span><select value={provider} onChange={event => {
          const next = event.target.value as Provider; setProvider(next);
          try {const saved = savedSettings(next); setApiKey(saved.key); setRemember(saved.remember); setModel(saved.model);}
          catch {setApiKey('');setRemember(false);setModel(providers[next].model);}
          setError('');
        }}>{Object.entries(providers).map(([id,item])=><option value={id} key={id}>{item.name}</option>)}</select></label>
        <label className="field"><span>{providers[provider].name} API Key</span><input type="password" autoComplete="off" placeholder="sk-…" value={apiKey} onChange={event => setApiKey(event.target.value)} required/></label>
        <label className="field"><span>模型</span><input value={model} onChange={event => setModel(event.target.value)} placeholder={providers[provider].model} required/></label>
        <label className="remember-key"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/>在此浏览器记住 API Key</label>
        <p className="model-storage-note">未勾选时，密钥仅保留在当前标签会话。模型请求由本地助手发往所选提供商，包含对话及工具返回的必要数据预览；绘图在本机执行。</p>
        {error && <p className="model-error" role="alert">{error}</p>}
        <button className="button primary full-width" type="submit">保存设置</button>
      </form>
      <div className="model-dialog-links"><a href={providers[provider].keys} target="_blank" rel="noopener noreferrer">获取 API Key ↗</a><a href="/workbench">先试用绘图 ↗</a></div>
    </dialog>
  </div>;
}
