import { useState } from 'react';
import { ArrowDownToLine, ArrowRight, ExternalLink, FileCode2 } from 'lucide-react';
import type { MainView } from './navigation';
import manifest from './data/omics-manifest.json';
import palettes from './data/omics-palettes.json';
import { omicsCases } from './omics-content';
import './omics.css';

const base = '/resources/v1/';
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
type Topic = 'single-cell' | 'spatial';
const topics: {id: Topic; label: string}[] = [{id:'single-cell',label:'单细胞'}, {id:'spatial',label:'空间转录组'}];

export default function OmicsResources({onNavigate,initialTopic = 'single-cell',onCaseChange}: {onNavigate: (view: MainView) => void;initialTopic?:'single-cell'|'spatial';onCaseChange?:(id:'single-cell'|'spatial')=>void}) {
  const [topic, setTopic] = useState<Topic>(initialTopic);
  const example = omicsCases.find(item => item.id === topic);

  return <div className="omics-scroll"><div className="omics-layout">
    <header className="omics-heading"><h1>案例与图表</h1></header>
    <nav className="omics-tabs" aria-label="组学资料分类">{topics.map(item => <button key={item.id} aria-pressed={topic === item.id} onClick={() => {if(onCaseChange) onCaseChange(item.id);else setTopic(item.id);}}>{item.label}</button>)}</nav>
    {example && <article key={example.id} className="omics-case">
      <div className="omics-case-intro"><div><p className="omics-kicker">{example.label} · 附件示例</p><h2>{example.title}</h2><p>{example.description}</p></div></div>
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
      <footer className="omics-case-footer"><p>{example.source}</p><div><button className="button" onClick={() => onNavigate('skills')}>选择 AI 指导技能<ArrowRight size={15}/></button></div></footer>
    </article>}
  </div></div>;
}
