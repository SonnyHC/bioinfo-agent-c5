import { ArrowDownToLine } from 'lucide-react';
import resources from './data/environment-resources.json';
import './environments.css';

const contents: Record<string, string> = {
  'single-cell-windows': 'Conda 环境定义与依赖锁文件',
  'single-cell-macos': 'Conda 依赖版本清单',
  'spatial-windows': 'Conda 环境定义与安装步骤',
  'spatial-macos': 'Miniconda 安装与依赖配置命令',
};

const caseDependencies = [
  {id: 'single-cell', title: '单细胞 · R', name: 'install.R', instruction: '在 R 中运行', command: 'source("install.R")'},
  {id: 'spatial', title: '空间转录组 · Python', name: 'environment.yml', instruction: '在 Conda 终端运行', command: 'conda env create -f environment.yml\nconda activate bioinfobuddy-st'},
];

export default function Environments() {
  return <section className="environment-panel" aria-labelledby="environment-heading">
    <div className="environment-layout">
      <header className="environment-heading">
        <h1 id="environment-heading">环境配置</h1>
        <p>按分析类型和操作系统下载。</p>
      </header>
      <div className="environment-grid">
        {resources.map(resource => <article key={resource.id} className="environment-card" aria-labelledby={`${resource.id}-heading`}>
          <h2 id={`${resource.id}-heading`}>{resource.title}</h2>
          <p className="environment-platform">{resource.platform}</p>
          <p className="environment-contents">{contents[resource.id]}</p>
          <a className="button" href={resource.url} download aria-label={`下载${resource.title} · ${resource.platform}`}>
            <ArrowDownToLine size={15}/>下载配置包 <span>· {(resource.bytes / 1024).toFixed(1)} KB</span>
          </a>
        </article>)}
      </div>
      <section className="environment-dependencies" aria-labelledby="case-dependencies-heading">
        <header><h2 id="case-dependencies-heading">案例配套依赖</h2><p>用于“案例与图表”中的复现包。下载后在文件所在目录运行。</p></header>
        {caseDependencies.map(dependency => <article key={dependency.id} className="environment-dependency">
          <div><h3>{dependency.title}</h3><p>{dependency.instruction}</p><pre><code>{dependency.command}</code></pre></div>
          <a className="button" href={`/resources/v1/${dependency.id}/${dependency.name}`} download><ArrowDownToLine size={15}/>下载 {dependency.name}</a>
        </article>)}
      </section>
    </div>
  </section>;
}
