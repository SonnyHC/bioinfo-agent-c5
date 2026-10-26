import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Check, Database, Dna, Download, LoaderCircle, MessageSquare, Plus, Settings2, Square, Upload, X } from 'lucide-react';
import { api, importDataset, post } from './api';
import { list, save } from './storage';
import { runAgent } from './agent-loop';
import type { Message, ToolEvent } from './agent-loop';
import { executeTool, systemPrompt, toolDefinitions, toolLabels } from './agent-tools';
import type { Dataset } from './types';
import './chat.css';

interface Conversation { id: string; title: string; createdAt: string; messages: Message[]; events: ToolEvent[] }
const fresh = (): Conversation => ({ id: crypto.randomUUID(), title: '新对话', createdAt: new Date().toISOString(), messages: [], events: [] });
const KEY = 'bioinfobuddy-api-key';
const MODEL = 'bioinfobuddy-model';
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
    return match ? <a key={index} href={match[2]} target="_blank" rel="noopener noreferrer">{match[1]} ↗</a> : <span key={index}>{part}</span>;
  })}</div>;
}

export default function Chat() {
  const [conversation, setConversation] = useState<Conversation>(fresh);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
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

  async function refreshData() { setDatasets((await api<{datasets: Dataset[]}>('/datasets')).datasets); }
  useEffect(() => {
    document.title = 'bioinfobuddy';
    try {
      const remembered = localStorage.getItem(KEY);
      const key = remembered || sessionStorage.getItem(KEY) || '';
      setApiKey(key); setRemember(Boolean(remembered)); setModel(localStorage.getItem(MODEL) || 'deepseek-chat'); setSettings(!key);
    } catch { setSettings(true); }
    void Promise.all([list<Conversation>('chats'), refreshData()]).then(([saved]) => {
      // Recover every saved conversation, including older history selections.
      const recovered = saved.map(recover);
      setHistory(recovered);
      if (recovered[0]) setConversation(recovered[0]);
    }).catch(reason => setError(String(reason.message))).finally(() => setLoading(false));
    const onFocus = () => { void refreshData().catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); };
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
      localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
      (remember ? localStorage : sessionStorage).setItem(KEY, apiKey.trim());
      localStorage.setItem(MODEL, model.trim());
      setApiKey(apiKey.trim()); setModel(model.trim()); setSettings(false); setError('');
    } catch { setError('浏览器未允许保存设置，请检查网站存储权限。'); }
  }
  async function send() {
    const prompt = input.trim();
    if (!prompt || started.current || loading) return;
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
          const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model, messages: [{ role: 'system', content: systemPrompt }, ...messages], tools: toolDefinitions }), signal });
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
    try { await importDataset(selected); await refreshData(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败。'); }
    finally { started.current = false; setBusy(false); setProgress(''); }
  }
  async function example() {
    if (started.current) return;
    started.current = true; setBusy(true); setProgress('正在载入样例'); setError('');
    try { await post('/examples/wide'); await refreshData(); setInput('检查刚导入的合成宽表，制定 Control 和 Treatment 的箱线图方案。'); }
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
      <div className="chat-rail-bottom"><span><span className="status-dot"/>浏览器本地保存</span><button className="icon-button" aria-label="模型设置" disabled={busy} onClick={() => setSettings(true)}><Settings2 size={18}/></button></div>
    </aside>
    <main className="chat-main">
      <header className="chat-header"><span>{conversation.messages.length ? conversation.title : '生信分析'}</span><div><a className="chat-mobile-workbench" href="/workbench">数据与绘图 ↗</a><button className="chat-model" disabled={busy} onClick={() => setSettings(true)}>{model}<Settings2 size={13}/></button><button className="icon-button" aria-label="导出当前对话" disabled={!conversation.messages.length} onClick={exportChat}><Download size={16}/></button></div></header>
      <div className="chat-mobile-history"><button className="button" disabled={busy || loading} onClick={() => { setConversation(fresh()); setError(''); setInput(''); }}><Plus size={16}/>新对话</button><select aria-label="选择历史对话" disabled={busy || loading} value={history.some(item => item.id === conversation.id) ? conversation.id : ''} onChange={event => { const selected = history.find(item => item.id === event.target.value); if (selected) { setConversation(selected); setError(''); } }}><option value="" disabled>最近对话</option>{history.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      <div className="chat-scroll">
        {!conversation.messages.length ? <section className="chat-welcome"><div className="chat-welcome-mark"><Dna size={38} strokeWidth={1.4}/></div><h1>开始生信分析</h1><p>从一份数据，或一个问题开始。</p><div className="chat-starters"><button disabled={busy || loading} onClick={() => file.current?.click()}><Upload size={17}/>导入实验数据</button><button disabled={busy || loading} onClick={() => void example()}><Database size={17}/>试用分组样例</button></div></section> : <div className="chat-transcript">{conversation.messages.map((message, index) => message.role === 'tool' || message.role === 'system' ? null : <div key={index} className={`chat-message ${message.role}`}>
          {message.role === 'assistant' && <Dna className="chat-avatar" size={22}/>}
          <div>{message.content && <MessageText text={message.content}/>}{message.tool_calls?.map(call => { const event = conversation.events.find(item => item.id === call.id); return <div className="tool-step" key={call.id}>{event?.state === 'running' ? <LoaderCircle className="spinning" size={14}/> : event?.state === 'done' ? <Check size={14}/> : <Settings2 size={14}/>}<span>{toolLabels[call.function.name] || call.function.name}{event?.detail && ` · ${event.detail}`}</span>{event?.url && <a href={event.url} target="_blank" rel="noopener noreferrer">打开<ArrowUpRight size={12}/></a>}</div>; })}</div>
        </div>)}</div>}
        <div ref={end}/>
      </div>
      <div className="chat-compose-area">
        {error && <div className="chat-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={15}/></button></div>}
        {!!datasets.length && <div className="chat-data-strip"><Database size={13}/><span>{datasets.length} 份数据</span><a href="/workbench" title={datasets[0].name}>{datasets[0].name}</a></div>}
        <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          <textarea aria-label="分析要求" placeholder="描述你的数据或分析需求…" value={input} onChange={event => setInput(event.target.value)} maxLength={12000} disabled={loading} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/>
          <div className="chat-compose-actions"><div><button type="button" className="icon-button" aria-label="导入数据文件" disabled={busy || loading} onClick={() => file.current?.click()}><Plus size={20}/></button><span aria-live="polite">{progress || 'CSV · TSV · Excel'}</span></div>{busy && abort.current ? <button type="button" className="chat-send" aria-label="停止生成" onClick={() => abort.current?.abort()}><Square size={15}/></button> : <button type="submit" className="chat-send" aria-label="发送" disabled={busy || loading || !input.trim()}><ArrowUp size={19}/></button>}</div>
        </form><p className="chat-footnote">对话与数据保存在当前浏览器 · Shift + Enter 换行</p>
      </div>
      <input ref={file} type="file" accept=".csv,.tsv,.xlsx" className="sr-only" aria-label="选择分析数据" onChange={event => { const selected = event.target.files?.[0]; if (selected) void upload(selected); event.target.value = ''; }}/>
    </main>
    <dialog ref={dialog} className="model-dialog" onCancel={() => setSettings(false)}>
      <div className="model-dialog-heading"><Dna size={23}/><h2>{apiKey ? '模型设置' : '配置 API Key'}</h2><button className="icon-button" aria-label="关闭模型设置" onClick={() => setSettings(false)}><X size={19}/></button></div>
      <p>连接 DeepSeek，开始分析。</p>
      <form onSubmit={event => { event.preventDefault(); saveSettings(); }}>
        <label className="field"><span>DeepSeek API Key</span><input type="password" autoComplete="off" placeholder="sk-…" value={apiKey} onChange={event => setApiKey(event.target.value)} required/></label>
        <label className="field"><span>模型</span><input value={model} onChange={event => setModel(event.target.value)} placeholder="deepseek-chat" required/></label>
        <label className="remember-key"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/>在此浏览器记住 API Key</label>
        <p className="model-storage-note">未勾选时，密钥仅保留在当前标签会话。请求会经本站接口发送至 DeepSeek；绘图文件由临时计算接口处理。</p>
        {error && <p className="model-error" role="alert">{error}</p>}
        <button className="button primary full-width" type="submit">保存设置</button>
      </form>
      <div className="model-dialog-links"><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">获取 API Key ↗</a><a href="/workbench">先试用绘图 ↗</a></div>
    </dialog>
  </div>;
}
