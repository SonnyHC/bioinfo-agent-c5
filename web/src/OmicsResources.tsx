import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ExternalLink, FileCode2, LoaderCircle } from 'lucide-react';
import type { MainView } from './navigation';
import manifest from './data/omics-manifest.json';
import palettes from './data/omics-palettes.json';
import { omicsCases } from './omics-content';
import { assembleArchive, saveResource } from './resource-download';
import OmicsGuides from './OmicsGuides';
import './omics.css';

const base = '/resources/v1/';
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
type Topic = 'single-cell' | 'spatial' | 'guides' | 'original';
const topics: {id: Topic; label: string}[] = [{id:'single-cell',label:'单细胞'}, {id:'spatial',label:'空间转录组'}, {id:'guides',label:'专题教程'}, {id:'original',label:'完整原始资料'}];

export default function OmicsResources({onNavigate}: {onNavigate: (view: MainView) => void}) {
  const [topic, setTopic] = useState<Topic>('single-cell');
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; controller.current?.abort();};}, []);
  const example = omicsCases.find(item => item.id === topic);

  async function downloadOriginal() {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setReceived(0); setFeedback(''); setError('');
    try {
      const blob = await assembleArchive(manifest.original, abort.signal, amount => {if (mounted.current) setReceived(amount);});
      abort.signal.throwIfAborted();
      saveResource(blob, manifest.original.name);
      if (mounted.current) setFeedback('全部分包校验通过，已交给浏览器保存 ZIP。请在浏览器下载列表中确认保存结果。');
    } catch (reason) {
      if (mounted.current) {
        if (abort.signal.aborted) setFeedback('已取消下载，可重新开始或分别下载分包。');
        else setError(reason instanceof Error ? reason.message : '下载失败，请重试。');
      }
    } finally {controller.current = null; if (mounted.current) setBusy(false);}
  }

  return <div className="omics-scroll"><div className="omics-layout">
    <header className="omics-heading"><h1>组学案例</h1><p>单细胞与空间转录组示例结果，附带数据、代码和参数，可在外部 R / Python 环境中复现。资料版本 V1.0。</p></header>
    <nav className="omics-tabs" aria-label="组学资料分类">{topics.map(item => <button key={item.id} aria-pressed={topic === item.id} onClick={() => setTopic(item.id)}>{item.label}</button>)}</nav>
    {example && <article key={example.id} className="omics-case">
      <div className="omics-case-intro"><div><p className="omics-kicker">{example.label} · 附件示例</p><h2>{example.title}</h2><p>{example.description}</p></div><button className="button" onClick={() => setTopic('guides')}><BookOpen size={15}/>阅读专题教程</button></div>
      <dl className="omics-facts">{example.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="omics-note">{example.boundary}</p>
      <section className="omics-reproduce" aria-label={`${example.label}下载与复现`}>
        <div className="omics-download-heading"><div><h3>复现包</h3><p>包含必需输入、适配代码和 macOS / Windows 指南；无需模型密钥。</p></div><a className="button primary" href={manifest.packages[example.id].url} download><ArrowDownToLine size={15}/>下载复现包 · {mb(manifest.packages[example.id].bytes)}</a></div>
        <div className="omics-file-links">{example.files.map(([name, label]) => <a key={name} href={`${base}${example.id}/${name}`} download><FileCode2 size={14}/>{label}<ArrowDownToLine size={12}/></a>)}</div>
        <details className="omics-environment"><summary>查看环境配置与运行步骤</summary>
          {example.id === 'single-cell' ? <><p>macOS / Windows 均先安装官方 R，在解压目录的 R 或 RStudio 中运行：</p><pre><code>source("install.R")</code></pre><p>脚本补齐 Seurat、ggplot2、Matrix、patchwork、ggdendro、viridisLite；随后在终端运行：</p></> : <><p>安装对应平台 Miniconda 后进入解压目录；Windows 使用 Miniconda Prompt，macOS 使用终端：</p><pre><code>{'conda env create -f environment.yml\nconda activate bioinfobuddy-st'}</code></pre><p>这是独立环境定义，不是完整锁文件；不会要求改写全局 Conda 配置。运行：</p></>}
          <pre><code>{example.command}</code></pre><p>输出写入 results。配置文件和脚本已作适配，本次未完成 macOS / Windows 全流程分析重跑；以实际依赖安装结果和运行日志为准。完整平台说明、版本记录与排错见包内 README.md。</p>
          <a href={`${base}${example.id}/README.md`} target="_blank" rel="noreferrer">打开完整环境指南 <ExternalLink size={12}/></a>
        </details>
        <details className="omics-checksum"><summary>复现包 SHA-256</summary><code>{manifest.packages[example.id].sha256}</code></details>
      </section>
      <div className="omics-gallery-heading"><h3>示例结果 <span>{example.figures.length} 张</span></h3><p>点击图片查看原图，或单独下载 PNG。</p></div>
      <div className="omics-gallery">{example.figures.map(([filename, title, caption]) => <figure key={filename}><a className="omics-figure-link" href={`${base}${example.id}/figures/${filename}`} target="_blank" rel="noreferrer" aria-label={`${title}，查看原图`}><img loading="lazy" src={`${base}${example.id}/figures/${filename}`} alt={`${title}。${caption}`}/></a><figcaption><div><h4>{title}</h4><a href={`${base}${example.id}/figures/${filename}`} download aria-label={`下载${title}`}><ArrowDownToLine size={16}/></a></div><p>{caption}</p></figcaption></figure>)}</div>
      {example.id === 'single-cell' && <details className="omics-palettes"><summary>附带配色 · 20 色与 38 色</summary><p>用于外部 R 绘图。原文件中的 colors_36 实际含 38 色；适配版使用 colors_38，并保留兼容别名。</p>{palettes.map((palette, index) => <div className="omics-swatches" key={index} aria-label={`${palette.length} 色配色`}>{palette.map((color, i) => <span key={`${color}-${i}`} title={color} style={{backgroundColor: color}}><span className="sr-only">{color}</span></span>)}</div>)}<a download href={`${base}single-cell/colors.R`}>下载 colors.R <ArrowDownToLine size={14}/></a></details>}
      <footer className="omics-case-footer"><p>{example.source}</p><p>示例图与原始材料保持对应；全部 44 个原文件在完整原始资料中保留。</p><div><button className="button" onClick={() => onNavigate('skills')}>选择 AI 指导技能<ArrowRight size={15}/></button><button className="button" onClick={() => setTopic('original')}>查看完整原始资料</button></div></footer>
    </article>}
    {topic === 'guides' && <OmicsGuides/>}
    {topic === 'original' && <section className="omics-original" aria-labelledby="original-heading"><p className="omics-kicker">完整保留 · 原始字节校验</p><h2 id="original-heading">V1.0 全部原始资料</h2><p>包含 44 个原文件：四篇原教程、单细胞与空间转录组的全部原始数据、代码、环境文件、13 张示例图和配色。molecule_info.h5、MTX 备份及旧环境清单均在其中。</p><p className="omics-note">原始包保留原作者路径和旧平台说明。实际复现请优先使用案例页的适配包与本网站教程。</p>
      <div className="omics-archive-action"><div><strong>{mb(manifest.original.bytes)}</strong><span>{manifest.original.parts.length} 个分包 · 自动校验并合并为 ZIP</span></div><button className="button primary" disabled={busy} onClick={() => void downloadOriginal()}>{busy ? <LoaderCircle className="spinning" size={16}/> : <ArrowDownToLine size={16}/>}下载完整原始包</button>{busy && <button className="button" onClick={() => controller.current?.abort()}>取消下载</button>}</div>
      <p className="omics-small">自动合并需占用数百 MB 浏览器内存；手机或内存不足时，可用下面的分包方式。离开“组学案例”页面会取消尚未完成的合并。</p>
      {busy && <div className="omics-progress"><progress value={received} max={manifest.original.bytes} aria-label="原始包下载进度"/><p role="status">已接收 {mb(received)} / {mb(manifest.original.bytes)}，正在下载并校验。</p></div>}
      {feedback && <p className="omics-feedback" role="status"><Check size={16}/>{feedback}</p>}{error && <p className="omics-error" role="alert">{error}</p>}
      <details className="omics-parts"><summary>分别下载分包，在电脑上合并</summary><p>下载所有分包、清单和合并脚本，放在同一目录，用已安装的 Python 运行 python reassemble.py。它会逐份校验并生成 V1.0-original.zip；不会覆盖已有 ZIP。分包不能单独解压。</p><div className="omics-part-links">{manifest.original.parts.map((part, i) => <a className="button" key={part.url} href={part.url} download>分包 {i + 1} · {mb(part.bytes)}<ArrowDownToLine size={14}/></a>)}</div><div className="omics-file-links"><a download href={`${base}original/archive-manifest.json`}>下载 archive-manifest.json</a><a download href={`${base}original/reassemble.py`}>下载 reassemble.py</a></div><pre><code>python reassemble.py</code></pre></details>
      <details className="omics-checksum"><summary>查看原始 ZIP 的 SHA-256</summary><code>{manifest.original.sha256}</code></details>
      <details className="omics-inventory"><summary>查看全部 44 个原文件清单</summary><ul>{manifest.files.map(file => <li key={file.source}><span>{file.source.replace('V1.0/', '')}</span><span>{mb(file.bytes)}</span></li>)}</ul></details>
      <a className="button" download href={`${base}manifest.json`}>下载文件清单与校验值<ArrowDownToLine size={15}/></a>
    </section>}
  </div></div>;
}
