import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Database, LoaderCircle, X } from 'lucide-react';
import { importDataset } from './api';
import type { Dataset } from './types';
import { fetchV1Example, v1Examples } from './v1-examples';
import './v1-examples.css';

type Example = typeof v1Examples[number];
export default function V1ExamplePicker({open,onClose,onImported,onCase}: {
  open:boolean; onClose:()=>void; onImported:(dataset:Dataset, example:Example)=>void;
  onCase:(caseId:'single-cell'|'spatial')=>void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy,setBusy] = useState<string|null>(null);
  const [error,setError] = useState('');
  useEffect(()=>{
    if(open) {setError('');dialog.current?.showModal();}
    else {controller.current?.abort();dialog.current?.close();}
    return ()=>{controller.current?.abort();};
  },[open]);
  function close() {controller.current?.abort();onClose();}
  async function choose(example:Example) {
    if(controller.current) return;
    const abort = new AbortController();controller.current=abort;setBusy(example.id);setError('');
    try {
      const file = await fetchV1Example(example.id,abort.signal);
      const dataset = await importDataset(file,abort.signal);
      abort.signal.throwIfAborted();
      onImported(dataset,example);onClose();
    } catch(reason) {
      if(!abort.signal.aborted) setError(reason instanceof Error?reason.message:'载入失败，请重试。');
    } finally {if(controller.current===abort) {controller.current=null;setBusy(null);}}
  }
  return <dialog ref={dialog} className="v1-picker" onCancel={close} onClose={onClose} aria-labelledby={titleId}>
    <header><div><p>V1.0 · 附件案例</p><h2 id={titleId}>选择一份样例</h2></div><button className="icon-button" aria-label="关闭样例选择" onClick={close}><X size={20}/></button></header>
    <p className="v1-picker-intro">从压缩包中的单细胞或空间转录组案例开始。加入对话后，可以请 AI 检查字段并讨论分析方法。</p>
    <div className="v1-example-grid">{v1Examples.map(example=><article key={example.id}>
      <img src={example.previewImage} alt={`${example.label}的附件原图`} loading="lazy"/>
      <div className="v1-example-copy"><h3>{example.label}</h3><p>{example.description}</p><small>{example.rows.toLocaleString()} 行 · CSV 表格</small>
      <div className="v1-example-actions"><button className="button primary" disabled={Boolean(busy)} onClick={()=>void choose(example)}>{busy===example.id?<LoaderCircle size={15} className="spinning"/>:<Database size={15}/>}加入对话</button><button className="button" disabled={Boolean(busy)} onClick={()=>{onCase(example.caseId);close();}}>查看完整案例<ArrowRight size={14}/></button></div></div>
    </article>)}</div>
    <p className="v1-picker-note">这里载入附件中的 marker 汇总或空间点位表。原始表达矩阵、分析代码和全部示例图在完整案例中查看；载入表格不会运行 Seurat 或 Scanpy。</p>
    {busy&&<p role="status">正在读取附件表格并检查字段…</p>}{error&&<p role="alert" className="v1-picker-error">{error}</p>}
  </dialog>;
}
