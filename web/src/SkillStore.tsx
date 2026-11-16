import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ClipboardCheck, FileSearch, Grid2X2, Layers, LoaderCircle, Package, Plus, Search, ScatterChart, X } from 'lucide-react';
import { skillCatalog, skillMarkdown, type AnalysisSkill } from './skill-catalog';
import { addSkill, installedSkills, removeSkill, setSkillEnabled, SKILLS_CHANGED, type InstalledSkill } from './skill-library';
import './skill-store.css';

const icons = { 'reviewed-bio-plot': Layers, 'table-check': FileSearch, 'matrix-heatmap': Grid2X2, 'distribution-explorer': ScatterChart, 'result-review': ClipboardCheck };
const categories = ['全部', '数据整理', '科研绘图', '结果复核', '单细胞', '空间组学'] as const;

export default function SkillStore({onUse, agentBusy}: {onUse: (skill: AnalysisSkill) => void; agentBusy: boolean}) {
  const [records, setRecords] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [query, setQuery] = useState('');
  const [shelf, setShelf] = useState<'all' | 'mine'>('all');
  const [category, setCategory] = useState<string>('全部');
  const [selected, setSelected] = useState<AnalysisSkill | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const disabled = loading || !!pending || agentBusy;

  useEffect(() => {
    let active = true;
    async function refresh() {
      try { const next = await installedSkills(); if (active) {setRecords(next); setError('');} }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '技能读取失败，请刷新页面重试。'); }
      finally { if (active) setLoading(false); }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(SKILLS_CHANGED, refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener(SKILLS_CHANGED, refresh); };
  }, []);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);

  async function change(skill: AnalysisSkill, action: 'add' | 'enable' | 'disable' | 'remove') {
    if (disabled) return;
    setPending(skill.id); setError(''); setMessage('');
    try {
      if (action === 'add') await addSkill(skill.id);
      else if (action === 'remove') await removeSkill(skill.id);
      else await setSkillEnabled(skill.id, action === 'enable');
      setRecords(await installedSkills());
      setMessage(`${skill.name}已${{add:'添加并启用', enable:'启用', disable:'停用', remove:'从我的技能移除'}[action]}。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); }
    finally { setPending(''); }
  }
  function useSkill(skill: AnalysisSkill) { setSelected(null); onUse(skill); }
  function download(skill: AnalysisSkill) {
    const url = URL.createObjectURL(new Blob([skillMarkdown(skill)], {type: 'text/markdown;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `${skill.id}.SKILL.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function actions(skill: AnalysisSkill) {
    const record = records.find(item => item.id === skill.id);
    if (!record || record.version !== skill.version) return <button className="button primary" disabled={disabled} onClick={() => void change(skill, 'add')}>{pending === skill.id ? <LoaderCircle size={15} className="spinning"/> : <Plus size={15}/>} {record ? '更新技能' : '添加技能'}</button>;
    if (!record.enabled) return <button className="button" disabled={disabled} onClick={() => void change(skill, 'enable')}>启用技能</button>;
    return <button className="button" disabled={disabled} onClick={() => useSkill(skill)}>在对话中使用<ArrowRight size={15}/></button>;
  }
  const search = query.trim().toLocaleLowerCase();
  const filtered = skillCatalog.filter(skill => (shelf === 'all' || records.some(item => item.id === skill.id))
    && (category === '全部' || skill.category === category)
    && (!search || [skill.name, skill.id, skill.description, skill.inputs, ...skill.tags].join(' ').toLocaleLowerCase().includes(search)));
  const selectedRecord = records.find(item => item.id === selected?.id);

  return <section className="skill-store" aria-labelledby="skill-store-heading">
    <div className="skill-store-inner">
      <header className="skill-heading"><div><h1 id="skill-store-heading">数据分析技能</h1><p>技能是预先写好的分析流程。添加后，模型会按流程检查数据、调用工具并核对结果。</p></div></header>
      <div className="skill-shelves" aria-label="技能列表范围"><button aria-pressed={shelf === 'all'} onClick={() => setShelf('all')}>浏览技能<span>{skillCatalog.length}</span></button><button aria-pressed={shelf === 'mine'} onClick={() => setShelf('mine')}>我的技能<span>{loading ? '…' : records.length}</span></button></div>
      <div className="skill-filters"><label className="skill-search"><Search size={18}/><input type="search" aria-label="搜索技能" placeholder="搜索技能名称、用途或文件类型" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={16}/></button>}</label><div className="skill-categories" aria-label="技能分类">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
      <div className="skill-list-note"><span>{loading ? '正在读取我的技能…' : `${filtered.length} 项技能`}</span><span>均为内置技能，添加记录保存在本机</span></div>
      {error && <p className="skill-error" role="alert">{error}</p>}
      {agentBusy && <p className="skill-feedback">AI 正在回复，完成后可添加、停用或使用技能。</p>}
      <p className="skill-feedback" role="status">{message}</p>
      {loading && shelf === 'mine' ? <p className="skill-empty" role="status">正在载入…</p> : filtered.length ? <div className="skill-grid">{filtered.map(skill => {
        const Icon = icons[skill.id as keyof typeof icons] ?? Package;
        const record = records.find(item => item.id === skill.id);
        return <article className="skill-card" key={skill.id}>
          <div className="skill-card-top"><span className="skill-icon"><Icon size={16}/></span><span className="skill-category">{skill.category}</span>{record && <span className={`skill-installed ${record.enabled ? '' : 'paused'}`}><Check size={12}/>{record.version !== skill.version ? '有更新' : record.enabled ? '已添加' : '已停用'}</span>}</div>
          <h2><button onClick={() => setSelected(skill)}>{skill.name}</button></h2><p className="skill-description">{skill.description}</p>
          <div className="skill-tags">{skill.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div>
          <dl className="skill-input"><dt>适用数据</dt><dd>{skill.inputs}</dd></dl>
          <footer><button className="skill-details-link" onClick={() => setSelected(skill)} aria-label={`查看${skill.name}详情`}>查看流程<ArrowRight size={14}/></button>{actions(skill)}</footer>
        </article>;
      })}</div> : <div className="skill-empty"><Package size={32}/><h2>{shelf === 'mine' && !records.length ? '还没有添加技能' : '没有找到匹配的技能'}</h2><p>{shelf === 'mine' && !records.length ? '从技能库选择你需要的分析流程，添加后即可在对话中使用。' : '试试其他关键词，或清除当前筛选。'}</p><button className="button" onClick={() => {setQuery(''); setCategory('全部'); setShelf('all');}}>浏览全部技能</button></div>}
      <aside className="skill-how"><h2>使用方式</h2><ol><li>查看流程与适用数据，添加需要的技能。</li><li>点击“在对话中使用”，或在普通对话中由模型按任务加载已启用的技能。</li><li>在对话中检查数据、讨论方法；绘图与组学计算按提供的代码在外部 R / Python 环境执行。</li></ol><p className="skill-scope-note">添加技能本身无需安装环境，也不会自动运行分析。单细胞与空间组学技能提供分析流程，计算环境可在“环境配置”中安装。</p></aside>
    </div>
    <dialog ref={dialog} className="skill-dialog" aria-labelledby="skill-detail-heading" onCancel={() => setSelected(null)} onClose={() => setSelected(null)}>
      {selected && <><header><span className="skill-meta">{selected.category} · v{selected.version}</span><button className="icon-button" aria-label="关闭技能详情" onClick={() => setSelected(null)}><X size={20}/></button></header><h2 id="skill-detail-heading">{selected.name}</h2><p className="skill-detail-description">{selected.description}</p><dl className="skill-spec"><dt>来源</dt><dd>BioInfoBuddy 内置</dd><dt>输入</dt><dd>{selected.inputs}</dd><dt>输出</dt><dd>{selected.outputs}</dd></dl><h3>流程</h3><ol className="skill-steps">{selected.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol><div className="skill-limits"><h3>适用范围</h3><p>{selected.limits}</p></div><details className="skill-source"><summary>查看 SKILL.md</summary><pre>{skillMarkdown(selected)}</pre></details>{error && <p role="alert" className="skill-error">{error}</p>}<p role="status" className="skill-feedback">{message}</p><footer><button className="skill-details-link" onClick={() => download(selected)}><ArrowDownToLine size={15}/>下载技能文件</button>{selectedRecord && <><button className="skill-details-link" disabled={disabled} onClick={() => void change(selected, 'remove')}>移除</button>{selectedRecord.enabled && <button className="skill-details-link" disabled={disabled} onClick={() => void change(selected, 'disable')}>停用</button>}</>}{actions(selected)}</footer></>}
    </dialog>
  </section>;
}
