import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, CheckCircle2, Clock3, FileCode2, RefreshCw } from 'lucide-react';
import { api } from './api';
import type { Run } from './types';
import './run-history.css';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function RunHistory({initialRunId}: {initialRunId?: string}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState(initialRunId ?? '');
  const [selected, setSelected] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);

  useEffect(() => {setSelectedId(initialRunId ?? '');}, [initialRunId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void api<{runs: Run[]}>('/runs', {signal: controller.signal}).then(result => {
      if (!controller.signal.aborted) setRuns(result.runs);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取运行记录。');
    }).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setSelected(null); setDetailError(''); setImageFailed(false); setImageAttempt(0);
    if (!selectedId) {setDetailLoading(false); return () => controller.abort();}
    setDetailLoading(true);
    void api<Run>(`/runs/${encodeURIComponent(selectedId)}`, {signal: controller.signal}).then(result => {
      if (!controller.signal.aborted) setSelected(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setDetailError(reason instanceof Error ? reason.message : '无法读取该运行记录。');
    }).finally(() => {if (!controller.signal.aborted) setDetailLoading(false);});
    return () => controller.abort();
  }, [selectedId, refresh]);

  const preview = selected?.artifacts.find(file => /\.png$/i.test(file.name));
  return <section className="run-archive" aria-label="运行记录">
    <header className="run-archive-heading"><div><h1>运行记录</h1><p>查看此前保存的结果与输出文件。</p></div><button className="button" disabled={loading || detailLoading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15}/>刷新记录</button></header>
    {error && <p role="alert" className="run-archive-error">{error}</p>}
    {loading ? <p role="status" className="run-archive-status">正在读取运行记录…</p> : error && !selectedId ? null : !runs.length && !selectedId ? <div className="run-archive-empty"><Clock3 size={30}/><h2>暂无运行记录</h2><p>本机尚未保存分析结果。</p></div> : <div className="run-archive-layout">
      <nav className="run-archive-list" aria-label="已保存的运行记录">
        <p className="run-archive-count">共 {runs.length} 条</p>
        {runs.map(run => <button key={run.id} aria-pressed={selectedId === run.id} onClick={() => setSelectedId(run.id)}>
          {run.status === 'completed' ? <CheckCircle2 size={17} className="run-archive-success"/> : <AlertTriangle size={17} className="run-archive-failure"/>}
          <span><strong>记录 {run.id.slice(0, 8)}</strong><small>{dateLabel(run.createdAt)}</small><small>{run.status === 'completed' ? `${run.summary.rows.toLocaleString()} 行 · 已完成` : '运行失败'}</small></span>
        </button>)}
      </nav>
      <section className="run-archive-detail" aria-label="运行详情" aria-busy={detailLoading}>
        {detailLoading ? <p role="status">正在读取结果…</p> : detailError ? <div className="run-archive-error" role="alert"><p>{detailError}</p><button className="button" onClick={() => setRefresh(value => value + 1)}>重新读取</button></div> : selected ? <>
          <header><h2>记录 {selected.id.slice(0, 8)}</h2><span className={selected.status === 'completed' ? 'run-archive-success' : 'run-archive-failure'}>{selected.status === 'completed' ? '已完成' : '运行失败'}</span></header>
          <dl className="run-archive-facts"><div><dt>保存时间</dt><dd>{dateLabel(selected.createdAt)}</dd></div><div><dt>数据 ID</dt><dd>{selected.datasetId}</dd></div><div><dt>参与绘图</dt><dd>{selected.summary.rows.toLocaleString()} 行{selected.summary.groups !== undefined && ` · ${selected.summary.groups} 组`}</dd></div></dl>
          {selected.status === 'failed' && <p role="alert" className="run-archive-error">{selected.error || '此次运行未成功，没有可用结果。'}</p>}
          {selected.status === 'completed' && <figure className="run-archive-preview">{preview ? imageFailed ? <div role="alert"><p>图片预览加载失败，可下载原文件查看。</p><button className="button" onClick={() => {setImageAttempt(value => value + 1);setImageFailed(false);}}>重试预览</button></div> : <img key={`${selected.id}-${imageAttempt}`} src={preview.url} alt={`记录 ${selected.id.slice(0, 8)} 保存的图表`} onError={() => setImageFailed(true)}/> : <p>此记录没有可预览的 PNG 文件。</p>}</figure>}
          {!!selected.artifacts.length && <section className="run-archive-files" aria-label="输出文件"><h3>输出文件 <span>{selected.artifacts.length}</span></h3><div>{selected.artifacts.map(file => <a key={file.name} href={file.url} download={file.name}><FileCode2 size={16}/><span>{file.name}</span><ArrowDownToLine size={15}/></a>)}</div></section>}
        </> : <div className="run-archive-empty"><Clock3 size={30}/><h2>选择一条记录</h2><p>查看已保存的图表、摘要和下载文件。</p></div>}
      </section>
    </div>}
  </section>;
}
