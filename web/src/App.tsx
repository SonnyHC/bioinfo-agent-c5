import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2,
  ChevronRight, CircleHelp, Dna, FileCode2, FileSpreadsheet, LoaderCircle, Play,
  RefreshCw, Upload, X,
} from 'lucide-react';
import { api, post } from './api';
import V1ExamplePicker from './V1ExamplePicker';
import { v1Examples } from './v1-examples';
import { formatAnalysisText } from './analysis-text';
import ChartPreview from './ChartPreview';
import { chartPreviews } from './chart-previews';
import type { ChartKind, Dataset, DataRow, Plan, PlotConfig, Run, ServiceStatus } from './types';

const charts: { id: ChartKind; name: string; description: string }[] = [
  { id: 'box', name: '箱线图', description: '比较各组分布，叠加样本点' },
  { id: 'violin', name: '小提琴图', description: '比较各组分布形状' },
  { id: 'scatter', name: '散点图', description: '两个数值变量的关系' },
  { id: 'histogram', name: '直方图', description: '单个数值变量的分布' },
  { id: 'bar', name: '柱状图', description: '组均值，叠加样本点' },
  { id: 'heatmap', name: '热图', description: '数值矩阵' },
];

const defaultConfig: PlotConfig = {
  chart: 'box', layout: 'wide', x: '', y: '', group: '', valueColumns: [],
  missing: 'error', title: '', xLabel: '', yLabel: '',
};

type Tab = 'data' | 'plan' | 'figure' | 'history';
const tabs: { id: Tab; label: string }[] = [
  { id: 'data', label: '1 数据' },
  { id: 'plan', label: '2 转换方案' },
  { id: 'figure', label: '3 结果图' },
  { id: 'history', label: '运行记录' },
];

function configFor(dataset: Dataset, chart: ChartKind = 'box'): PlotConfig {
  const supplied = v1Examples.find(item=>item.filename===dataset.name && item.columns.every(name=>dataset.columns.some(column=>column.name===name)));
  if(supplied && (chart==='box'||chart==='scatter')) return {...defaultConfig,chart:'scatter',layout:'long',x:supplied.caseId==='single-cell'?'pct':'array_col',y:supplied.caseId==='single-cell'?'avg':'array_row',group:supplied.caseId==='single-cell'?'marker_group':'in_tissue'};
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

function DataTable({ rows, columns, count, fields }: { rows: DataRow[]; columns: string[]; count: number; fields?: Dataset['columns'] }) {
  if (!rows.length) return <p className="table-empty">没有可预览的数据行。</p>;
  return <div className="data-table-wrap">
    <div className="data-table-scroll" tabIndex={0} aria-label="数据表，可横向滚动">
      <table className="data-table"><thead><tr><th className="row-number" scope="col"></th>{columns.map(col => { const field = fields?.find(item => item.name === col); return <th key={col} scope="col" className={field?.type === 'number' ? 'numeric' : ''}><span title={col}>{col}</span>{field && <small>{field.type === 'number' ? '数值' : '文本'}{field.missing > 0 && <b> · 缺失 {field.missing}</b>}</small>}</th>; })}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}><td className="row-number">{index+1}</td>{columns.map(col => <td key={col} title={row[col] == null ? '缺失值' : String(row[col])} className={typeof row[col] === 'number' || fields?.find(item => item.name === col)?.type === 'number' ? 'numeric' : ''}>{row[col] == null || row[col] === '' ? <span className="missing-cell">缺失</span> : String(row[col])}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className="table-caption"><span>显示 {rows.length} / {count.toLocaleString()} 行</span><span>{columns.length} 列</span></div>
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

export default function App({embedded = false, initialHistory = false, onDataset,onExampleImported}: {embedded?:boolean;initialHistory?:boolean;onDataset?:(id:string)=>void;onExampleImported?:(id:string)=>void}) {
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
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<'help' | null>(null);
  const [examplePicker,setExamplePicker] = useState(false);
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
    setConfig(previous => ({...previous,...patch})); setPlan(null); setRun(null); setError('');
  }

  function selectDataset(next: Dataset, chart: ChartKind = config.chart) {
    setDataset(next); setConfig(configFor(next,chart)); setPlan(null); setRun(null); setTab('data'); setError('');
  }

  function selectChart(chart: ChartKind) {
    if(chart==='scatter' && dataset && v1Examples.some(item=>item.filename===dataset.name)) {changeConfig(configFor(dataset,chart));return;}
    const layout = ['scatter','histogram','heatmap'].includes(chart) ? 'long' : config.layout;
    changeConfig({chart,layout, ...(chart === 'scatter' ? {x: numericColumns[0] ?? '',y: numericColumns[1] ?? numericColumns[0] ?? '',group:''} : {}), ...(chart === 'histogram' ? {group:''} : {}), ...(chart === 'heatmap' ? {x:dataset?.columns.find(column => column.type !== 'number')?.name ?? ''} : {})});
  }

  async function perform<T>(message: string, action: () => Promise<T>): Promise<T | undefined> {
    setBusy(message); setError('');
    try { return await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); }
    finally { setBusy(''); }
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
    if (result) { setPlan(result); setPlans(previous => [result,...previous.filter(item => item.id !== result.id)]); setRun(null); setTab('plan'); }
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
    setRun(null); setFailedImageUrl(null); setError('');
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
    if (!plan) return;
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
  const reached: Record<Tab, boolean> = { data: Boolean(dataset), plan: Boolean(plan), figure: run?.status === 'completed', history: false };
  const maxUpload = status?.maxUploadMB ?? 2;

  return <div className={`app-shell ${embedded ? 'embedded-workbench' : ''}`}>
    {!embedded && <header className="topbar">
      <a className="brand" href="/" aria-label="返回对话"><span className="brand-symbol"><Dna size={18} strokeWidth={1.8}/></span><span className="brand-name">bioinfobuddy</span></a>
      <div className="project-name"><span className="header-divider"/><span>绘图</span></div>
      <div className="topbar-actions"><button className="icon-button help-button" title="使用说明" aria-label="打开使用说明" onClick={() => setDialog('help')}><CircleHelp size={18}/></button><a className="button agent-button" href="/">返回对话</a></div>
    </header>}

    <div className="workspace">
      <aside className="sidebar" aria-label="数据与图表类型">
        <section className="side-section">
          <div className="section-heading"><h2>数据</h2>{datasets.length > 0 && <span className="counter">{datasets.length}</span>}</div>
          <input ref={fileRef} className="sr-only" type="file" accept=".csv,.tsv,.xlsx" onChange={onFile} disabled={isBusy} aria-label="上传 CSV、TSV 或 Excel 文件"/>
          <button className={`upload-zone ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} disabled={isBusy} onDragOver={event => {event.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <Upload size={16}/><strong>导入文件</strong><span>CSV / TSV / XLSX</span>
          </button>
          {datasets.length > 0 && <div className="dataset-list">{datasets.map(item => <button key={item.id} className={`dataset-item ${dataset?.id === item.id ? 'active' : ''}`} onClick={() => selectDataset(item)} disabled={isBusy} title={item.name}><FileSpreadsheet size={15}/><span><strong>{item.name}</strong><small>{item.rows.toLocaleString()} 行 × {item.columns.length} 列</small></span></button>)}</div>}
        </section>
        <section className="side-section sample-section"><div className="section-heading"><h2>附件样例</h2></div>
          <button className="sample-button" disabled={isBusy} onClick={()=>setExamplePicker(true)}><strong>选择 V1.0 案例</strong><small>单细胞 marker · 空间点位</small></button>
        </section>
        <section className="side-section templates-section"><div className="section-heading"><h2>图表类型</h2></div>
          <div className="template-grid">{charts.map(chart => <button key={chart.id} className={`template-option ${config.chart === chart.id ? 'active' : ''}`} onClick={() => selectChart(chart.id)} disabled={isBusy} aria-pressed={config.chart === chart.id} title={chart.description}><ChartPreview kind={chart.id}/><span>{chart.name}</span></button>)}</div><p className="chart-preview-note">V1.0 附件原图 · 仅作图型参考</p>
        </section>
      </aside>

      <section className="main-panel" aria-label="绘图工作区">
        <div className="workspace-heading"><h1>{dataset ? dataset.name : '未选择数据'}</h1>{dataset && <p>{dataset.rows.toLocaleString()} 行 × {dataset.columns.length} 列<span className="dot-separator">·</span>{missingCount ? <span className="attention-text">{missingCount} 个缺失值</span> : '无缺失值'}</p>}</div>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={16}/><span>{formatAnalysisText(error)}</span><button className="icon-button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={16}/></button></div>}
        {status && !status.pythonReady && <div className="engine-warning"><AlertTriangle size={15}/><span>绘图服务未就绪。</span><button className="text-button" onClick={() => void initialize()} disabled={isBusy}><RefreshCw size={13}/>重试</button></div>}
        <nav className="view-tabs" aria-label="工作区视图">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>{item.label}{reached[item.id] && <Check size={13} className="tab-check" aria-label="已完成"/>}{item.id === 'history' && runs.length > 0 && <span className="tab-counter">{runs.length}</span>}</button>)}<button className="refresh-records" onClick={() => void refreshRecords()} title="刷新记录" aria-label="刷新记录" disabled={isBusy}><RefreshCw size={14}/></button></nav>

        <div className="work-area">
          {loading ? <div className="empty-state"><LoaderCircle className="spinning" size={22}/><p>正在加载数据与运行记录…</p></div> : !status ? <div className="empty-state"><h2>无法连接绘图服务</h2><p>请检查网络后重新连接。</p><button className="button primary" onClick={() => void initialize()}><RefreshCw size={14}/>重新连接</button></div> : <>
            {tab === 'data' && (dataset ? <>
              {dataset.warnings?.map((warning,index) => <Notice key={index}>{formatAnalysisText(warning)}</Notice>)}
              <DataTable rows={dataset.preview} columns={allColumns} count={dataset.rows} fields={dataset.columns}/>
              <div className="next-action"><span>图表类型：{selectedChart.name}</span><button className="button" onClick={() => void previewPlan()} disabled={isBusy}>预览转换方案<ArrowRight size={14}/></button></div>
            </> : <div className="empty-state welcome-state"><h2>导入一份表格</h2><p>支持 CSV、TSV、XLSX，单个文件不超过 {maxUpload} MB。也可以先用样例数据练习。</p><div className="empty-actions"><button className="button primary" onClick={() => fileRef.current?.click()} disabled={isBusy}><Upload size={15}/>导入文件</button><button className="button" onClick={() => setExamplePicker(true)} disabled={isBusy}>选择附件样例</button></div></div>)}

            {tab === 'plan' && <div className="plan-inbox"><label><span>已保存的方案</span><select value={plan?.id ?? ''} onChange={event => {const next = plans.find(item => item.id === event.target.value);if(next) void loadPlan(next);}} disabled={isBusy}><option value="">选择方案</option>{plans.filter(item => !dataset || item.datasetId === dataset.id).map(item => <option key={item.id} value={item.id}>{charts.find(chart => chart.id === item.chart)?.name ?? item.chart} · {dateLabel(item.createdAt)} · {item.status === 'approved' ? '已确认' : '未确认'} · {item.id.slice(0,6)}</option>)}</select></label><button className="text-button" disabled={isBusy} onClick={() => void refreshRecords()}><RefreshCw size={12}/>刷新</button></div>}
            {tab === 'plan' && (plan ? <>
              <div className="section-toolbar"><h2>转换方案</h2><span className={`inline-status ${plan.status === 'approved' ? '' : 'neutral'}`}>{plan.status === 'approved' ? '已确认' : '未确认'}</span></div>
              <div className="transformation-summary"><div><span>输入</span><strong>{plan.inputRows.toLocaleString()}<small>行</small></strong></div><ArrowRight size={18}/><div><span>输出</span><strong>{plan.outputRows.toLocaleString()}<small>行</small></strong></div><div className="drop-count"><span>排除</span><strong>{plan.droppedRows}<small>行</small></strong></div></div>
              <ol className="plan-steps">{plan.steps.map((step,index)=><li key={index}><span>{index+1}</span><p>{formatAnalysisText(step)}</p></li>)}</ol>
              {plan.warnings?.map((warning,index) => <Notice key={index}>{formatAnalysisText(warning)}</Notice>)}
              <div className="section-toolbar compact"><h3>转换后数据</h3></div>
              <DataTable rows={plan.preview} columns={plan.outputColumns} count={plan.outputRows}/>
              <div className="approval-panel"><p>核对转换步骤和输出行数后，确认方案并生成图表。</p><button className="button primary" onClick={() => void executePlan()} disabled={isBusy || !status.pythonReady}>{busy ? <LoaderCircle size={15} className="spinning"/> : <Play size={14}/>}确认方案并生成图表</button></div>
            </> : <div className="empty-state"><h2>还没有转换方案</h2><p>选好图表类型和字段后，预览转换方案。</p><button className="button primary" disabled={!dataset || isBusy} onClick={() => void previewPlan()}>预览转换方案</button></div>)}

            {tab === 'figure' && (run ? run.status === 'completed' ? <>
              <div className="section-toolbar"><h2>结果图</h2><span className="muted tiny">{dateLabel(run.createdAt)} · 运行 <code>{run.id.slice(0,8)}</code></span></div>
              <div className="figure-paper">{imageUrl ? failedImageUrl === imageUrl ? <div className="figure-preview-error" role="alert"><AlertTriangle size={22}/><strong>图片预览加载失败</strong><p>可以重新加载，或直接下载图片。</p><button className="button" onClick={() => setFailedImageUrl(null)}><RefreshCw size={14}/>重新加载</button></div> : <img src={imageUrl} alt="生成的图表" onError={() => setFailedImageUrl(imageUrl)}/> : <p>没有图片预览，请下载导出文件查看。</p>}</div>
              <div className="figure-caption"><span>{run.summary.rows.toLocaleString()} 行参与绘图{run.summary.groups !== undefined ? ` · ${run.summary.groups} 组` : ''}</span></div>
              <div className="export-panel"><span className="export-label">导出</span><div className="export-actions">{(['chart.png','chart.svg','chart.pdf'] as const).map(name => artifact(name) && <a key={name} className="button" href={artifact(name)} download={name}>{name.split('.')[1].toUpperCase()}</a>)}{artifact('bundle.zip') && <a className="button primary" href={artifact('bundle.zip')} download="bioinfobuddy-results.zip"><ArrowDownToLine size={14}/>复现包（数据、代码、参数）</a>}</div></div>
              <details className="artifact-details"><summary>全部输出文件<span>{run.artifacts.length}</span></summary><div>{run.artifacts.map(item => <a key={item.name} href={item.url} download={item.name}><FileCode2 size={14}/><span>{item.name}</span><ArrowDownToLine size={13}/></a>)}</div></details>
            </> : <div className="empty-state failed-state"><AlertTriangle size={24}/><h2>绘图失败</h2><p>{formatAnalysisText(run.error || '请检查数据与参数后重新生成。')}</p><button className="button" onClick={() => setTab('plan')}>返回转换方案</button></div> : <div className="empty-state"><h2>尚未生成图表</h2><p>确认转换方案后，图表会显示在这里。</p><button className="button" onClick={() => setTab(plan ? 'plan' : 'data')}>{plan ? '前往转换方案' : '前往数据'}</button></div>)}

            {tab === 'history' && <><div className="section-toolbar"><h2>运行记录</h2><span className="muted tiny">共 {runs.length} 次</span></div>{runs.length ? <div className="history-list">{runs.map(item => <button key={item.id} className="history-item" onClick={() => void loadRun(item)} disabled={isBusy}>{item.status === 'completed' ? <CheckCircle2 size={16} className="history-success"/> : <AlertTriangle size={16} className="history-failure"/>}<div><strong>{datasets.find(data => data.id === item.datasetId)?.name ?? '分析记录'}</strong><span>{dateLabel(item.createdAt)} · {item.status === 'completed' ? `${item.summary.rows} 行参与绘图` : '运行失败'}</span></div><code>{item.id.slice(0,8)}</code><ChevronRight size={15}/></button>)}</div> : <div className="empty-state"><h2>暂无运行记录</h2><p>每次生成图表都会留下记录，可以随时重新打开。</p></div>}</>}
          </>}
        </div>
        <footer className="workbench-footer"><span>{dataset ? `${dataset.name} · ${dataset.rows.toLocaleString()} 行 × ${dataset.columns.length} 列` : '未选择数据'}</span><span className={status?.pythonReady ? 'ready' : ''}>{busy ? <><LoaderCircle size={12} className="spinning"/>{busy}</> : <><span className="status-dot"/>{loading ? '连接中' : status?.pythonReady ? '绘图服务就绪' : '绘图服务未连接'}</>}</span></footer>
      </section>

      <aside className="parameters" aria-label="绘图设置">
        <div className="parameter-header"><h2>绘图设置</h2></div>
        <div className="selected-template"><ChartPreview kind={config.chart}/><div><strong>{selectedChart.name}</strong><span>{selectedChart.description}</span>{chartPreviews[config.chart] && <small className="chart-preview-caption">{chartPreviews[config.chart]!.caption}</small>}</div></div>{chartPreviews[config.chart] && <a className="chart-preview-source" href={chartPreviews[config.chart]!.url} target="_blank" rel="noreferrer">查看附件原图<ArrowUpRight size={12}/></a>}
        <fieldset className="parameter-fields" disabled={!dataset || isBusy}>
          <legend className="sr-only">设置图表数据与样式</legend>
          {groupedChart && <div className="parameter-section"><h3>数据格式</h3><div className="segmented"><button type="button" className={config.layout === 'wide' ? 'active' : ''} aria-pressed={config.layout === 'wide'} onClick={() => changeConfig({layout:'wide'})}>宽表</button><button type="button" className={config.layout === 'long' ? 'active' : ''} aria-pressed={config.layout === 'long'} onClick={() => changeConfig({layout:'long'})}>长表</button></div><p className="field-hint">{config.layout === 'wide' ? '每个数值列是一组。' : '一列分组，一列数值。'}</p></div>}
          <div className="parameter-section"><h3>字段</h3>
            {config.chart === 'heatmap' && <FieldSelect label="行标签（可选）" value={config.x} onChange={x => changeConfig({x})} columns={allColumns.filter(name => !config.valueColumns.includes(name))} optional emptyLabel="使用行号"/>}
            {(groupedChart && config.layout === 'wide' || config.chart === 'heatmap') ? <div className="column-picker"><span className="field-label">{config.chart === 'heatmap' ? '矩阵数值列' : '参与绘图的组'}</span>{numericColumns.length ? numericColumns.map(name => <label key={name}><input type="checkbox" checked={config.valueColumns.includes(name)} onChange={event => changeConfig({valueColumns:event.target.checked ? [...config.valueColumns,name] : config.valueColumns.filter(value => value !== name)})}/><span>{name}</span></label>) : <p className="field-hint">导入数据后显示数值列。</p>}</div> : <>
              {config.chart === 'scatter' && <FieldSelect label="X 轴" value={config.x} onChange={x => changeConfig({x})} columns={numericColumns}/>}
              <FieldSelect label={config.chart === 'histogram' ? '数值列' : 'Y 轴'} value={config.y} onChange={y => changeConfig({y})} columns={numericColumns}/>
              {config.chart !== 'histogram' && <FieldSelect label={config.chart === 'scatter' ? '颜色分组（可选）' : '分组列'} value={config.group} onChange={group => changeConfig({group})} columns={allColumns} optional={config.chart === 'scatter'}/>}
            </>}
          </div>
          <div className="parameter-section"><h3>缺失值</h3><label className={`radio-option ${config.missing === 'error' ? 'selected' : ''}`}><input type="radio" name="missing" value="error" checked={config.missing === 'error'} onChange={() => changeConfig({missing:'error'})}/><span>报错并停止</span></label><label className={`radio-option ${config.missing === 'drop' ? 'selected' : ''}`}><input type="radio" name="missing" value="drop" checked={config.missing === 'drop'} onChange={() => changeConfig({missing:'drop'})}/><span>排除含缺失值的行</span></label></div>
          <details className="label-options"><summary>标题与坐标轴</summary><label className="field"><span>图表标题</span><input value={config.title} onChange={event => changeConfig({title:event.target.value})} placeholder="默认标题" maxLength={160}/></label><label className="field"><span>X 轴名称</span><input value={config.xLabel} onChange={event => changeConfig({xLabel:event.target.value})} placeholder="默认使用列名" maxLength={100}/></label><label className="field"><span>Y 轴名称</span><input value={config.yLabel} onChange={event => changeConfig({yLabel:event.target.value})} placeholder="默认使用列名" maxLength={100}/></label></details>
        </fieldset>
        <div className="parameter-action"><button className="button primary full-width" onClick={() => void previewPlan()} disabled={!dataset || isBusy}>{busy ? <LoaderCircle size={15} className="spinning"/> : null}预览转换方案</button></div>
        {onDataset && <div className="agent-note"><button className="text-button" disabled={!dataset || isBusy} onClick={()=>dataset&&onDataset(dataset.id)}>让 AI 推荐字段与参数<ArrowUpRight size={13}/></button></div>}
      </aside>
    </div>

    <div className="live-announcement sr-only" aria-live="polite">{busy || (run?.status === 'completed' ? '图表已生成，可在结果图中下载。' : '')}</div>
    <V1ExamplePicker open={examplePicker} onClose={()=>setExamplePicker(false)} onImported={result=>{setDatasets(previous=>[result,...previous.filter(item=>item.id!==result.id)]);selectDataset(result,'box');if(onExampleImported)onExampleImported(result.id);else window.history.replaceState(null,'',`/?view=analysis&dataset=${result.id}`);}} onCase={id=>{window.location.href=`/?view=omics&case=${id}`;}}/>
    <dialog className="help-dialog" ref={dialogRef} onCancel={() => setDialog(null)} onClick={event => {if (event.target === event.currentTarget) setDialog(null);}}>
      <div className="dialog-header"><h2>使用说明</h2><button className="icon-button" aria-label="关闭窗口" onClick={() => setDialog(null)}><X size={18}/></button></div>
      <ol className="guide-steps">
        <li><strong>导入数据</strong><p>选择 CSV、TSV 或 XLSX 文件，或载入样例数据。</p></li>
        <li><strong>选择图表与字段</strong><p>在右侧设置数据格式、分组、数值列和坐标轴。</p></li>
        <li><strong>确认方案并导出</strong><p>核对转换方案后生成图表，下载图片或复现包。</p></li>
      </ol>
      <button className="button primary full-width" onClick={() => setDialog(null)}>知道了</button>
    </dialog>
  </div>;
}
