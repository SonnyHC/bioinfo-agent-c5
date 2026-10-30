import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3,
  BookOpen, Check, CheckCircle2, ChevronRight, CircleHelp, Database, Dna,
  FileCode2, FileSpreadsheet, FlaskConical, History, Laptop,
  Layers, LoaderCircle, Play, RefreshCw, Settings2, Table2, Upload, Workflow, X,
} from 'lucide-react';
import { api, post } from './api';
import { formatAnalysisText } from './analysis-text';
import type { ChartKind, Dataset, DataRow, Plan, PlotConfig, Run, ServiceStatus } from './types';

/* Working brief: researchers move from an experimental table to an inspectable figure.
 * Domain: samples, measured values, groups, transformation, provenance, reproduction.
 * Color world: laboratory paper, graphite labels, blue-grey steel, teal glass, amber notes.
 * Signature: the table-to-figure record, with actual row counts and explicit approval.
 * Avoid dashboard KPI cards, invented chat, and decorative scientific plots.
 * Intent/hierarchy: one working sheet leads; side panels support the current analysis.
 * Palette/depth/surfaces: cool paper and teal actions, quiet borders, no floating cards.
 * Type/spacing: compact Chinese humanist type, mono fields, 4px rhythm, 16px panels.
 */

const charts: { id: ChartKind; name: string; en: string; description: string }[] = [
  { id: 'box', name: '箱线图', en: 'Box plot', description: '比较各组分布，保留样本点' },
  { id: 'violin', name: '小提琴图', en: 'Violin plot', description: '查看各组数值的分布形状' },
  { id: 'scatter', name: '散点图', en: 'Scatter plot', description: '查看两个数值变量的关系' },
  { id: 'histogram', name: '直方图', en: 'Histogram', description: '查看单个数值变量的分布' },
  { id: 'bar', name: '柱状图', en: 'Bar plot', description: '比较组均值，并显示样本点' },
  { id: 'heatmap', name: '热图', en: 'Heatmap', description: '查看数值矩阵' },
];

const defaultConfig: PlotConfig = {
  chart: 'box', layout: 'wide', x: '', y: '', group: '', valueColumns: [],
  missing: 'error', title: '', xLabel: '', yLabel: '',
};

type Tab = 'data' | 'plan' | 'figure' | 'history';
const tabs: { id: Tab; label: string; icon: typeof Table2 }[] = [
  { id: 'data', label: '数据预览', icon: Table2 },
  { id: 'plan', label: '转换方案', icon: Workflow },
  { id: 'figure', label: '结果图', icon: BarChart3 },
  { id: 'history', label: '运行记录', icon: History },
];

function configFor(dataset: Dataset, chart: ChartKind = 'box'): PlotConfig {
  const numeric = dataset.columns.filter(c => c.type === 'number').map(c => c.name);
  const text = dataset.columns.filter(c => c.type !== 'number').map(c => c.name);
  const group = text.find(name => /group|condition|treatment|分组|组别/i.test(name)) ?? text[0] ?? '';
  const value = numeric.find(name => /value|expression|数值|表达/i.test(name)) ?? numeric[0] ?? '';
  return {
    ...defaultConfig, chart,
    layout: (chart === 'scatter' || chart === 'histogram' || chart === 'heatmap') ? 'long' : numeric.length > 1 && !text.some(name => /group|condition|分组|组别/i.test(name)) ? 'wide' : 'long',
    x: chart === 'heatmap' ? text[0] ?? '' : numeric[0] ?? '', y: chart === 'scatter' ? numeric[1] ?? numeric[0] ?? '' : value,
    group: ['scatter','histogram'].includes(chart) ? '' : group, valueColumns: numeric,
  };
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Intent: choose a scientific plot at a glance. Hierarchy: silhouette before label.
// Palette: teal ink. Depth: flat, paper surface. Type: inherited. Spacing: 4px grid.
function ChartGlyph({ kind, large = false }: { kind: ChartKind; large?: boolean }) {
  return <svg viewBox="0 0 88 48" className={`chart-glyph ${large ? 'large' : ''}`} aria-hidden="true">
    <path d="M9 5v35h71" className="glyph-axis" />
    {kind === 'box' && <>
      <path d="M27 9v27M21 9h12M21 36h12M58 5v30M52 5h12M52 30h12" />
      <rect x="19" y="18" width="16" height="11" rx="1" /><path d="M19 23h16" />
      <rect x="50" y="12" width="16" height="12" rx="1" /><path d="M50 18h16" />
      <circle cx="26" cy="32" r="1" /><circle cx="61" cy="8" r="1" />
    </>}
    {kind === 'violin' && <>
      <path d="M28 7c-2 7-11 9-11 17s10 10 11 13c2-3 11-5 11-13S30 14 28 7Z" />
      <path d="M60 5c-1 6-10 12-10 18s9 10 10 13c2-3 10-6 10-13S62 11 60 5Z" />
      <path d="M28 19v10M60 15v12" className="glyph-dark" />
    </>}
    {kind === 'scatter' && [[20,31],[27,28],[33,32],[40,22],[44,27],[49,16],[57,19],[63,13],[69,9],[73,16]].map(([cx,cy],i) => <circle key={i} cx={cx} cy={cy} r="2.4" />)}
    {kind === 'histogram' && [10,19,29,33,23,14,6].map((h,i) => <rect key={i} x={17+i*8} y={39-h} width="7" height={h} />)}
    {kind === 'bar' && <>
      {[16,28,21].map((h,i) => <g key={i}><rect x={20+i*20} y={39-h} width="12" height={h} /><path d={`M${26+i*20} ${34-h}v10m-4-10h8`} /></g>)}
    </>}
    {kind === 'heatmap' && Array.from({length: 24},(_,i) => <rect key={i} x={15+i%6*10} y={6+Math.floor(i/6)*8} width="9" height="7" style={{opacity: .22 + ((i*7)%11)/14}} />)}
  </svg>;
}

// Intent: inspect actual source or transformed rows. Hierarchy: field names and cells.
// Palette/depth: graphite on paper with quiet rules. Type: mono numbers. Spacing: 12px cells.
function DataTable({ rows, columns, count }: { rows: DataRow[]; columns: string[]; count: number }) {
  if (!rows.length) return <p className="table-empty">没有可预览的数据行。</p>;
  return <div className="data-table-wrap">
    <div className="data-table-scroll" tabIndex={0} aria-label="数据表，可横向滚动">
      <table className="data-table"><thead><tr><th className="row-number" scope="col">#</th>{columns.map(col => <th key={col} scope="col"><span title={col}>{col}</span></th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}><td className="row-number">{String(index+1).padStart(2,'0')}</td>{columns.map(col => <td key={col} title={row[col] == null ? '缺失值' : String(row[col])} className={typeof row[col] === 'number' ? 'numeric' : ''}>{row[col] == null || row[col] === '' ? <span className="missing-cell">缺失</span> : String(row[col])}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className="table-caption"><span>显示前 {rows.length} 行 / 共 {count.toLocaleString()} 行</span><span>{columns.length} 个字段</span></div>
  </div>;
}

function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div className={`notice ${danger ? 'danger' : ''}`}><AlertTriangle size={15} aria-hidden="true" /><div>{children}</div></div>;
}

function FieldSelect({ label, value, onChange, columns, optional = false, emptyLabel = '不分组' }: { label: string; value: string; onChange: (value: string) => void; columns: string[]; optional?: boolean; emptyLabel?: string }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{optional ? emptyLabel : '选择字段'}</option>{columns.map(name => <option key={name} value={name}>{name}</option>)}
  </select></label>;
}

export default function App({embedded = false, initialHistory = false, onDataset}: {embedded?:boolean;initialHistory?:boolean;onDataset?:(id:string)=>void}) {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [config, setConfig] = useState<PlotConfig>(defaultConfig);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialHistory ? 'history' : 'data');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<'help' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function initialize() {
    setLoading(true);
    setError('');
    try {
      const [service, data, history, proposals] = await Promise.all([
        api<ServiceStatus>('/status'), api<{datasets: Dataset[]}>('/datasets'), api<{runs: Run[]}>('/runs'), api<{plans: Plan[]}>('/plans'),
      ]);
      setStatus(service); setDatasets(data.datasets); setRuns(history.runs); setPlans(proposals.plans);
      const search = new URLSearchParams(window.location.search);
      const runId = search.get('run');
      const planId = search.get('plan');
      if (runId) {
        const linkedRun = await api<Run>(`/runs/${encodeURIComponent(runId)}`);
        const [sourcePlan, sourceData] = await Promise.all([
          api<Plan>(`/plans/${linkedRun.planId}`), api<Dataset>(`/datasets/${linkedRun.datasetId}`),
        ]);
        if (sourcePlan.datasetId !== sourceData.id || linkedRun.datasetId !== sourceData.id || linkedRun.planId !== sourcePlan.id) {
          throw new Error('运行记录与方案不匹配，请重新选择记录。');
        }
        applyPlan(sourcePlan, sourceData);
        setRun(linkedRun);
        setRuns(previous => [linkedRun, ...previous.filter(item => item.id !== linkedRun.id)]);
        setTab('figure');
      } else if (planId) {
        const linkedPlan = await api<Plan>(`/plans/${encodeURIComponent(planId)}`);
        const sourceData = await api<Dataset>(`/datasets/${linkedPlan.datasetId}`);
        if (linkedPlan.datasetId !== sourceData.id) throw new Error('方案与数据不匹配，请重新选择方案。');
        applyPlan(linkedPlan, sourceData);
        setTab('plan');
      } else if (search.get('dataset')) {
        const selected = await api<Dataset>(`/datasets/${encodeURIComponent(search.get('dataset')!)}`);
        selectDataset(selected);
      } else if (data.datasets.length) {
        setDataset(data.datasets[0]); setConfig(configFor(data.datasets[0]));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '加载失败，请重试。'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    if (dialog && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!dialog && dialogRef.current?.open) dialogRef.current.close();
  }, [dialog]);

  const numericColumns = dataset?.columns.filter(c => c.type === 'number').map(c => c.name) ?? [];
  const allColumns = dataset?.columns.map(c => c.name) ?? [];
  const selectedChart = charts.find(chart => chart.id === config.chart)!;
  const groupedChart = ['box','violin','bar'].includes(config.chart);
  const isBusy = Boolean(busy) || loading;
  const missingCount = dataset?.columns.reduce((sum,col) => sum+col.missing,0) ?? 0;

  function changeConfig(patch: Partial<PlotConfig>) {
    setConfig(previous => ({...previous,...patch})); setPlan(null); setRun(null); setReviewed(false); setError('');
  }

  function selectDataset(next: Dataset, chart: ChartKind = config.chart) {
    setDataset(next); setConfig(configFor(next,chart)); setPlan(null); setRun(null); setReviewed(false); setTab('data'); setError('');
  }

  function selectChart(chart: ChartKind) {
    const layout = ['scatter','histogram','heatmap'].includes(chart) ? 'long' : config.layout;
    changeConfig({chart,layout, ...(chart === 'scatter' ? {x: numericColumns[0] ?? '',y: numericColumns[1] ?? numericColumns[0] ?? '',group:''} : {}), ...(chart === 'histogram' ? {group:''} : {}), ...(chart === 'heatmap' ? {x:dataset?.columns.find(column => column.type !== 'number')?.name ?? ''} : {})});
  }

  async function perform<T>(message: string, action: () => Promise<T>): Promise<T | undefined> {
    setBusy(message); setError('');
    try { return await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); }
    finally { setBusy(''); }
  }

  async function loadExample(id: 'wide' | 'long' | 'expression') {
    const result = await perform('正在载入合成样例', () => post<Dataset>(`/examples/${id}`));
    if (result) { setDatasets(previous => [result,...previous.filter(item => item.id !== result.id)]); selectDataset(result,id === 'expression' ? 'heatmap' : 'box'); }
  }

  async function upload(file: File) {
    if (!/\.(csv|tsv|xlsx)$/i.test(file.name)) { setError('请选择 CSV、TSV 或 XLSX 文件。'); return; }
    if (file.size > (status?.maxUploadMB ?? 2)*1024*1024) { setError(`文件超过 ${status?.maxUploadMB ?? 2} MB，请先截取需要分析的表格。`); return; }
    const form = new FormData(); form.append('file',file);
    const result = await perform('正在检查数据结构', () => api<Dataset>('/datasets',{method:'POST',body:form}));
    if (result) { setDatasets(previous => [result,...previous]); selectDataset(result); }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '';
  }
  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault(); setDragging(false);
    if (isBusy) return;
    const file = event.dataTransfer.files[0]; if (file) void upload(file);
  }

  async function previewPlan() {
    if (!dataset) return;
    const result = await perform('正在检查字段与转换结果', () => post<Plan>('/plans',{datasetId:dataset.id,...config}));
    if (result) { setPlan(result); setPlans(previous => [result,...previous.filter(item => item.id !== result.id)]); setRun(null); setReviewed(false); setTab('plan'); }
  }

  async function refreshRecords() {
    await perform('正在刷新记录',async () => {
      const [data,history,proposals] = await Promise.all([
        api<{datasets: Dataset[]}>('/datasets'), api<{runs: Run[]}>('/runs'), api<{plans: Plan[]}>('/plans'),
      ]);
      setDatasets(data.datasets); setRuns(history.runs); setPlans(proposals.plans);
      if (!dataset && data.datasets.length) selectDataset(data.datasets[0]);
    });
  }

  function applyPlan(next: Plan, data: Dataset) {
    const defaults = configFor(data,next.chart);
    setDataset(data);
    setDatasets(previous => previous.some(item => item.id === data.id) ? previous.map(item => item.id === data.id ? data : item) : [data,...previous]);
    setConfig({
      chart: next.chart, layout: next.layout ?? defaults.layout,
      x: next.x ?? defaults.x, y: next.y ?? defaults.y, group: next.group ?? defaults.group,
      valueColumns: next.valueColumns ?? defaults.valueColumns, missing: next.missing ?? defaults.missing,
      title: next.title ?? '', xLabel: next.xLabel ?? '', yLabel: next.yLabel ?? '',
    });
    setPlan(next);
    setPlans(previous => previous.some(item => item.id === next.id) ? previous.map(item => item.id === next.id ? next : item) : [next,...previous]);
    setRun(null); setReviewed(false); setFailedImageUrl(null); setError('');
  }

  async function loadPlan(next: Plan) {
    const data = datasets.find(item => item.id === next.datasetId) ?? await perform('正在读取方案数据', () => api<Dataset>(`/datasets/${next.datasetId}`));
    if (!data) return;
    applyPlan(next,data); setTab('plan');
  }

  async function loadRun(next: Run) {
    const result = await perform('正在读取结果',async () => {
      const [data,sourcePlan] = await Promise.all([
        api<Dataset>(`/datasets/${next.datasetId}`), api<Plan>(`/plans/${next.planId}`),
      ]);
      if (sourcePlan.datasetId !== data.id || next.datasetId !== data.id || next.planId !== sourcePlan.id) {
        throw new Error('运行记录与方案不匹配，请重新选择记录。');
      }
      return {data,sourcePlan};
    });
    if (!result) return;
    applyPlan(result.sourcePlan,result.data); setRun(next); setTab('figure');
  }

  async function executePlan() {
    if (!plan || !reviewed) return;
    const result = await perform('正在生成图表',async () => {
      const approved = await post<Plan>(`/plans/${plan.id}/approve`);
      setPlan(approved);
      return post<Run>(`/plans/${plan.id}/run`);
    });
    if (result) {
      setRun(result); setRuns(previous => [result,...previous.filter(item => item.id !== result.id)]); setTab('figure');
      if (result.status === 'failed') setError(result.error || '本次绘图未成功，请检查参数后重试。');
    } else {
      // Failed runs are persisted by the server even when it responds with HTTP 422.
      try { setRuns((await api<{runs: Run[]}>('/runs')).runs); } catch { /* Keep the original execution error visible. */ }
    }
  }

  function artifact(name: string) { return run?.artifacts.find(item => item.name === name)?.url; }
  const imageUrl = artifact('chart.svg') ?? artifact('chart.png');
  const chartStep = run?.status === 'completed' ? 3 : plan ? 2 : dataset ? 1 : 0;

  return <div className={`app-shell ${embedded ? 'embedded-workbench' : ''}`}>
    {!embedded && <header className="topbar">
      <a className="brand" href="/" aria-label="返回对话"><span className="brand-symbol"><Dna size={23} strokeWidth={1.65}/></span><span className="brand-name">bioinfobuddy</span></a>
      <div className="project-name"><span className="header-divider"/><FlaskConical size={16}/><span>绘图工具</span></div>
      <div className="topbar-actions"><span className={`service-state ${status?.pythonReady ? 'ready' : ''}`}><span className="status-dot"/>{loading ? '连接中' : status?.pythonReady ? '绘图就绪' : '待连接'}</span><button className="icon-button help-button" title="使用指南" aria-label="打开使用指南" onClick={() => setDialog('help')}><CircleHelp size={19}/></button><a className="button agent-button" href="/"><Workflow size={16}/><span>返回对话</span><ArrowUpRight size={15}/></a></div>
    </header>}

    <div className="workspace">
      <aside className="sidebar" aria-label="数据与图表模板">
        <div className="sidebar-heading"><span className="eyebrow">WORKSPACE</span><span className="local-label"><Laptop size={13}/>此浏览器</span></div>
        <section className="side-section">
          <div className="section-heading"><h2><Database size={15}/>数据文件</h2><span className="counter">{datasets.length}</span></div>
          <input ref={fileRef} className="sr-only" type="file" accept=".csv,.tsv,.xlsx" onChange={onFile} disabled={isBusy} aria-label="上传 CSV、TSV 或 Excel 文件"/>
          <button className={`upload-zone ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} disabled={isBusy} onDragOver={event => {event.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <Upload size={19}/><strong>导入数据</strong><span>CSV / TSV / Excel</span><small>最大 {status?.maxUploadMB ?? 2} MB · 上传至本站分析服务</small>
          </button>
          {datasets.length > 0 && <div className="dataset-list">{datasets.map(item => <button key={item.id} className={`dataset-item ${dataset?.id === item.id ? 'active' : ''}`} onClick={() => selectDataset(item)} disabled={isBusy} title={item.name}><FileSpreadsheet size={16}/><span><strong>{item.name}</strong><small>{item.rows.toLocaleString()} 行 · {item.columns.length} 列</small></span>{dataset?.id === item.id && <span className="selection-dot"/>}</button>)}</div>}
        </section>
        <section className="side-section sample-section"><div className="section-heading"><h2><FlaskConical size={15}/>试用样例</h2><span className="muted tiny">合成数据</span></div>
          <button className="sample-button" disabled={isBusy} onClick={() => void loadExample('wide')}><span><strong>分组实验 · 宽表</strong><small>每一列对应一个组</small></span><ChevronRight size={15}/></button>
          <button className="sample-button" disabled={isBusy} onClick={() => void loadExample('long')}><span><strong>分组实验 · 长表</strong><small>每一行对应一次测量</small></span><ChevronRight size={15}/></button>
          <button className="sample-button" disabled={isBusy} onClick={() => void loadExample('expression')}><span><strong>表达矩阵</strong><small>查看基因与样本数值</small></span><ChevronRight size={15}/></button>
        </section>
        <section className="side-section templates-section"><div className="section-heading"><h2><BarChart3 size={15}/>图表模板</h2><span className="counter">06</span></div>
          <div className="template-grid">{charts.map(chart => <button key={chart.id} className={`template-option ${config.chart === chart.id ? 'active' : ''}`} onClick={() => selectChart(chart.id)} disabled={isBusy} aria-pressed={config.chart === chart.id} title={chart.description}><ChartGlyph kind={chart.id}/><span>{chart.name}</span>{config.chart === chart.id && <Check size={11} className="template-check"/>}</button>)}</div>
        </section>
        <div className="sidebar-bottom"><span className="small-mark"><Dna size={15}/>BIOINFOBUDDY</span><span>v{status?.version ?? '0.1.0'}</span></div>
      </aside>

      <section className="main-panel" aria-label="绘图工作区">
        <div className="workspace-heading"><div><div className="breadcrumb">科研分析 <ChevronRight size={12}/> 数据绘图</div><h1>{dataset ? dataset.name : '从一份数据开始'}<span className="file-label">{dataset ? dataset.name.split('.').pop()?.toUpperCase() : 'NEW ANALYSIS'}</span></h1><p>{dataset ? <>{dataset.rows.toLocaleString()} 行数据<span className="dot-separator">·</span>{dataset.columns.length} 个字段</> : '导入数据并选择图表。'}</p></div><span className="workspace-number">01<span>/ WORKBENCH</span></span></div>
        <div className="workflow-strip" aria-label="分析流程">{['导入数据','确认字段','检查方案','生成与导出'].map((label,index) => <div key={label} className={`workflow-step ${index <= chartStep ? 'reached' : ''} ${index === chartStep ? 'current' : ''}`}><span className="step-number">{index < chartStep ? <Check size={12}/> : `0${index+1}`}</span><span>{label}</span>{index < 3 && <ChevronRight className="step-arrow" size={13}/>}</div>)}</div>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={17}/><span>{formatAnalysisText(error)}</span><button className="icon-button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={16}/></button></div>}
        {status && !status.pythonReady && <div className="engine-warning"><AlertTriangle size={15}/><span>绘图服务尚未就绪，请重试。</span><button className="text-button" onClick={() => void initialize()} disabled={isBusy}><RefreshCw size={13}/>重试</button></div>}
        <nav className="view-tabs" aria-label="工作区视图">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><item.icon size={15}/>{item.label}{item.id === 'plan' && plan && <span className="tab-dot"/>}{item.id === 'history' && runs.length > 0 && <span className="tab-counter">{runs.length}</span>}</button>)}<button className="refresh-records" onClick={() => void refreshRecords()} title="刷新记录" aria-label="刷新记录" disabled={isBusy}><RefreshCw size={14}/></button></nav>

        <div className="work-area">
          {loading ? <div className="empty-state"><LoaderCircle className="spinning" size={28}/><h2>正在加载</h2><p>读取数据与运行记录。</p></div> : !status ? <div className="empty-state"><Laptop size={34}/><h2>服务连接失败</h2><p>请重新连接。</p><button className="button primary" onClick={() => void initialize()}><RefreshCw size={15}/>重新连接</button></div> : <>
            {tab === 'data' && (dataset ? <>
              <div className="section-toolbar"><div><h2>原始数据</h2></div><span className={`inline-status ${missingCount ? 'attention' : ''}`}>{missingCount ? <AlertTriangle size={13}/> : <CheckCircle2 size={13}/>} {missingCount ? `${missingCount} 个缺失单元格` : '未发现缺失值'}</span></div>
              {dataset.warnings?.map((warning,index) => <Notice key={index}>{formatAnalysisText(warning)}</Notice>)}
              <DataTable rows={dataset.preview} columns={allColumns} count={dataset.rows}/>
              <div className="field-summary"><h3>字段概览</h3><div className="field-chips">{dataset.columns.map(column => <span className="field-chip" key={column.name}><b className={column.type === 'number' ? 'type-numeric' : ''}>{column.type === 'number' ? '#' : 'Aa'}</b><span>{column.name}</span>{column.missing > 0 && <small>{column.missing} 缺失</small>}</span>)}</div></div>
              <div className="next-action"><div className="next-action-symbol"><Settings2 size={19}/></div><div><strong>设置绘图字段</strong><p>{selectedChart.name} · 选择字段后预览方案。</p></div><button className="button" onClick={() => void previewPlan()} disabled={isBusy}>预览方案<ArrowRight size={15}/></button></div>
            </> : <div className="empty-state welcome-state"><div className="empty-sheet"><div className="sheet-top"><FileSpreadsheet size={18}/><span>experiment.csv</span><i/></div><div className="sheet-grid"><span>sample</span><span>group</span><span>value</span>{Array.from({length:12},(_,i)=><i key={i}/>)}</div><span className="sheet-chart"><ChartGlyph kind="box"/></span></div><span className="eyebrow">YOUR DATA, YOUR WORKSPACE</span><h2>导入数据，开始绘图</h2><p>选择 CSV、TSV 或 XLSX 文件。</p><div className="empty-actions"><button className="button primary" onClick={() => fileRef.current?.click()} disabled={isBusy}><Upload size={16}/>导入数据</button><button className="button" onClick={() => void loadExample('wide')} disabled={isBusy}><FlaskConical size={16}/>使用合成样例</button></div><div className="empty-footnotes"><span><Laptop size={14}/>浏览器保存结果</span><span><FileCode2 size={14}/>导出代码与参数</span></div></div>)}

            {tab === 'plan' && <div className="plan-inbox"><div><Workflow size={14}/><span>分析方案</span><button className="text-button" disabled={isBusy} onClick={() => void refreshRecords()}><RefreshCw size={12}/>刷新</button></div><select aria-label="打开分析方案" value={plan?.id ?? ''} onChange={event => {const next = plans.find(item => item.id === event.target.value);if(next) void loadPlan(next);}} disabled={isBusy}><option value="">选择方案</option>{plans.filter(item => !dataset || item.datasetId === dataset.id).map(item => <option key={item.id} value={item.id}>{charts.find(chart => chart.id === item.chart)?.name ?? item.chart} · {dateLabel(item.createdAt)} · {item.status === 'approved' ? '已确认' : '待使用'} · {item.id.slice(0,6)}</option>)}</select><p>查看当前数据的方案。</p></div>}
            {tab === 'plan' && (plan ? <>
              <div className="section-toolbar"><div><h2>转换方案</h2><span>数据转换与字段设置</span></div><span className={`inline-status ${plan.status === 'approved' ? '' : 'neutral'}`}>{plan.status === 'approved' ? <CheckCircle2 size={13}/> : <Workflow size={13}/>} {plan.status === 'approved' ? '已确认' : '待使用'}</span></div>
              <div className="transformation-summary"><div><span>输入</span><strong>{plan.inputRows.toLocaleString()}<small>行</small></strong></div><ArrowRight size={20}/><div><span>转换后</span><strong>{plan.outputRows.toLocaleString()}<small>行</small></strong></div><div className="drop-count"><span>排除</span><strong>{plan.droppedRows}<small>行</small></strong></div></div>
              <div className="plan-steps">{plan.steps.map((step,index)=><div key={index}><span>{String(index+1).padStart(2,'0')}</span><p>{formatAnalysisText(step)}</p><Check size={14}/></div>)}</div>
              {plan.warnings?.map((warning,index) => <Notice key={index}>{formatAnalysisText(warning)}</Notice>)}
              <div className="section-toolbar compact"><div><h3>转换后预览</h3></div></div>
              <DataTable rows={plan.preview} columns={plan.outputColumns} count={plan.outputRows}/>
              <div className="approval-panel"><label className="approval-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={isBusy}/><span>使用此方案</span></label><button className="button primary" onClick={() => void executePlan()} disabled={!reviewed || isBusy || !status.pythonReady}>{busy ? <LoaderCircle size={15} className="spinning"/> : <Play size={15}/>}生成图表</button></div>
            </> : <div className="empty-state"><Workflow size={34}/><h2>预览转换方案</h2><p>选择数据与字段，查看转换后的表格。</p><button className="button primary" disabled={!dataset || isBusy} onClick={() => void previewPlan()}><Layers size={16}/>预览转换方案</button></div>)}

            {tab === 'figure' && (run ? run.status === 'completed' ? <>
              <div className="section-toolbar"><div><h2>生成结果</h2><span>{dateLabel(run.createdAt)}</span></div><span className="inline-status"><CheckCircle2 size={14}/>已完成</span></div>
              <div className="figure-paper">{imageUrl ? failedImageUrl === imageUrl ? <div className="figure-preview-error" role="alert"><AlertTriangle size={24}/><strong>图片预览加载失败</strong><p>请重新加载，或下载图片。</p><button className="button" onClick={() => setFailedImageUrl(null)}><RefreshCw size={14}/>重新加载预览</button></div> : <img src={imageUrl} alt="科研图表" onError={() => setFailedImageUrl(imageUrl)}/> : <p>暂无图片预览，请查看导出文件。</p>}</div>
              <div className="figure-caption"><span>{run.summary.rows.toLocaleString()} 行参与绘图{run.summary.groups !== undefined ? ` · ${run.summary.groups} 个组` : ''}</span><span>Run <code>{run.id.slice(0,8)}</code></span></div>
              <div className="export-panel"><div className="export-title"><ArrowDownToLine size={19}/><div><strong>导出结果</strong><p>图片、数据、代码和参数。</p></div></div><div className="export-actions">{(['chart.png','chart.svg','chart.pdf'] as const).map(name => artifact(name) && <a key={name} className="button" href={artifact(name)} download={name}>{name.split('.')[1].toUpperCase()}<ArrowDownToLine size={13}/></a>)}{artifact('bundle.zip') && <a className="button primary" href={artifact('bundle.zip')} download="bioinfobuddy-results.zip">下载复现包<ArrowDownToLine size={15}/></a>}</div></div>
              <details className="artifact-details"><summary>查看本次输出文件<span>{run.artifacts.length} 个文件</span></summary><div>{run.artifacts.map(item => <a key={item.name} href={item.url} download={item.name}><FileCode2 size={15}/><span>{item.name}</span><ArrowDownToLine size={14}/></a>)}</div></details>
            </> : <div className="empty-state failed-state"><AlertTriangle size={34}/><h2>本次绘图未完成</h2><p>{formatAnalysisText(run.error || '请检查数据与参数后重新生成。')}</p><button className="button" onClick={() => setTab('plan')}>返回方案<ArrowRight size={15}/></button></div> : <div className="empty-state"><BarChart3 size={36}/><h2>图表将在这里生成</h2><p>使用转换方案生成图表，导出图片与复现包。</p><button className="button" onClick={() => setTab(plan ? 'plan' : 'data')}>{plan ? '检查方案' : '查看数据'}<ArrowRight size={15}/></button></div>)}

            {tab === 'history' && <><div className="section-toolbar"><div><h2>运行记录</h2><span>数据、参数与结果</span></div><span className="muted tiny">{runs.length} 次运行</span></div>{runs.length ? <div className="history-list">{runs.map(item => <button key={item.id} className="history-item" onClick={() => void loadRun(item)} disabled={isBusy}>{item.status === 'completed' ? <CheckCircle2 size={19} className="history-success"/> : <AlertTriangle size={19} className="history-failure"/>}<div><strong>{datasets.find(data => data.id === item.datasetId)?.name ?? '分析记录'}</strong><span>{dateLabel(item.createdAt)} · {item.status === 'completed' ? `${item.summary.rows} 行参与绘图` : '运行失败'}</span></div><code>{item.id.slice(0,8)}</code><ChevronRight size={15}/></button>)}</div> : <div className="empty-state"><History size={34}/><h2>还没有运行记录</h2><p>生成图表后，可在此打开结果。</p></div>}</>}
          </>}
        </div>
        <footer className="workbench-footer"><span><BarChart3 size={13}/>绘图工具</span><span>{busy ? <><LoaderCircle size={12} className="spinning"/>{busy}</> : <><span className="status-dot"/>{loading ? '连接中' : status?.pythonReady ? '就绪' : '待连接'}</>}</span></footer>
      </section>

      <aside className="parameters" aria-label="图表参数">
        <div className="parameter-header"><Settings2 size={17}/><h2>绘图设置</h2><span>CONFIG</span></div>
        <div className="selected-template"><ChartGlyph kind={config.chart}/><div><strong>{selectedChart.name}</strong><span>{selectedChart.en}</span></div><span className="template-indicator"/></div>
        <p className="template-description">{selectedChart.description}。</p>
        <fieldset className="parameter-fields" disabled={!dataset || isBusy}>
          <legend className="sr-only">设置图表数据与样式</legend>
          {groupedChart && <div className="parameter-section"><div className="parameter-section-title"><span>01</span><h3>数据结构</h3></div><div className="segmented"><button type="button" className={config.layout === 'wide' ? 'active' : ''} aria-pressed={config.layout === 'wide'} onClick={() => changeConfig({layout:'wide'})}>宽表</button><button type="button" className={config.layout === 'long' ? 'active' : ''} aria-pressed={config.layout === 'long'} onClick={() => changeConfig({layout:'long'})}>长表</button></div><p className="field-hint">{config.layout === 'wide' ? '每个数值列对应一组。' : '分组和数值各占一列。'}</p></div>}
          <div className="parameter-section"><div className="parameter-section-title"><span>{groupedChart ? '02' : '01'}</span><h3>字段映射</h3></div>
            {config.chart === 'heatmap' && <FieldSelect label="行标签（可选）" value={config.x} onChange={x => changeConfig({x})} columns={allColumns.filter(name => !config.valueColumns.includes(name))} optional emptyLabel="使用行号"/>}
            {(groupedChart && config.layout === 'wide' || config.chart === 'heatmap') ? <div className="column-picker"><span className="field-label">{config.chart === 'heatmap' ? '矩阵数值列' : '参与绘图的组'}</span>{numericColumns.length ? numericColumns.map(name => <label key={name}><input type="checkbox" checked={config.valueColumns.includes(name)} onChange={event => changeConfig({valueColumns:event.target.checked ? [...config.valueColumns,name] : config.valueColumns.filter(value => value !== name)})}/><span>{name}</span><b>#</b></label>) : <p className="field-hint">导入后显示数值字段</p>}</div> : <>
              {config.chart === 'scatter' && <FieldSelect label="X 轴数值" value={config.x} onChange={x => changeConfig({x})} columns={numericColumns}/>}
              <FieldSelect label={config.chart === 'histogram' ? '数值字段' : 'Y 轴数值'} value={config.y} onChange={y => changeConfig({y})} columns={numericColumns}/>
              {config.chart !== 'histogram' && <FieldSelect label={config.chart === 'scatter' ? '颜色分组（可选）' : '分组字段'} value={config.group} onChange={group => changeConfig({group})} columns={allColumns} optional={config.chart === 'scatter'}/>}
            </>}
          </div>
          <div className="parameter-section"><div className="parameter-section-title"><span>{groupedChart ? '03' : '02'}</span><h3>缺失值处理</h3></div><label className={`radio-option ${config.missing === 'error' ? 'selected' : ''}`}><input type="radio" name="missing" value="error" checked={config.missing === 'error'} onChange={() => changeConfig({missing:'error'})}/><span><strong>遇到缺失值时停止</strong><small>补全数据后继续</small></span></label><label className={`radio-option ${config.missing === 'drop' ? 'selected' : ''}`}><input type="radio" name="missing" value="drop" checked={config.missing === 'drop'} onChange={() => changeConfig({missing:'drop'})}/><span><strong>排除缺失值</strong><small>显示排除数量</small></span></label></div>
          <details className="label-options"><summary>标题与坐标轴<span>可选</span></summary><label className="field"><span>图表标题</span><input value={config.title} onChange={event => changeConfig({title:event.target.value})} placeholder="使用默认标题" maxLength={160}/></label><label className="field"><span>X 轴名称</span><input value={config.xLabel} onChange={event => changeConfig({xLabel:event.target.value})} placeholder="使用字段名称" maxLength={100}/></label><label className="field"><span>Y 轴名称</span><input value={config.yLabel} onChange={event => changeConfig({yLabel:event.target.value})} placeholder="使用字段名称" maxLength={100}/></label></details>
        </fieldset>
        <div className="parameter-action"><button className="button primary full-width" onClick={() => void previewPlan()} disabled={!dataset || isBusy}>{busy ? <LoaderCircle size={16} className="spinning"/> : <Layers size={16}/>}预览转换方案<ArrowRight size={15}/></button><p>查看转换后的数据。</p></div>
        <div className="agent-note"><Workflow size={17}/><div><strong>继续分析</strong><button className="text-button" disabled={!dataset || isBusy} onClick={()=>dataset&&onDataset?.(dataset.id)}>让 AI 帮我选参数<ArrowUpRight size={13}/></button></div></div>
      </aside>
    </div>

    <div className="live-announcement sr-only" aria-live="polite">{busy || (run?.status === 'completed' ? '图表生成完成，可在结果图中下载。' : '')}</div>
    <dialog className="help-dialog" ref={dialogRef} onCancel={() => setDialog(null)} onClick={event => {if (event.target === event.currentTarget) setDialog(null);}}>
      <div className="dialog-header"><span className="dialog-symbol"><BookOpen size={22}/></span><button className="icon-button" aria-label="关闭窗口" onClick={() => setDialog(null)}><X size={20}/></button></div>
      <span className="eyebrow">QUICK START</span><h2>使用绘图工具</h2>
      <ol className="guide-steps">
        <li><span>01</span><div><strong>导入数据</strong><p>选择 CSV、TSV 或 XLSX 文件。</p></div></li>
        <li><span>02</span><div><strong>选择图表与字段</strong><p>设置分组、数值列和坐标轴。</p></div></li>
        <li><span>03</span><div><strong>生成与导出</strong><p>查看方案后生成图表，下载图片与复现包。</p></div></li>
      </ol>
      <button className="button primary full-width" onClick={() => setDialog(null)}>开始绘图<ArrowRight size={16}/></button>
    </dialog>
  </div>;
}
