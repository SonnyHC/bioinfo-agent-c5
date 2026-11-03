import { useState } from 'react';
import { ArrowDownToLine, Terminal } from 'lucide-react';
import resources from './data/environment-resources.json';
import { launcherDownloads, launcherUrl } from './environment-launcher';
import './environments.css';

const contents: Record<string, string> = {
  'single-cell-windows': 'R 4.4.3 与配套依赖',
  'single-cell-macos': 'R 4.4.3 与配套依赖',
  'spatial-windows': 'Python 3.12 · Scanpy 1.12.1',
  'spatial-macos': 'Python 3.12 · Scanpy · Squidpy',
};

const caseDependencies = [
  {id: 'single-cell', title: '单细胞 · R', description: 'Seurat 与案例绘图依赖'},
  {id: 'spatial', title: '空间转录组 · Python', description: 'Scanpy 与空间分析依赖'},
];

export default function Environments() {
  const [requested, setRequested] = useState('');
  return <section className="environment-panel" aria-labelledby="environment-heading">
    <div className="environment-layout">
      <header className="environment-heading">
        <h1 id="environment-heading">环境配置</h1>
        <p>选择环境，在终端中安装。</p>
      </header>
      <section className="environment-setup" aria-labelledby="launcher-setup-heading">
        <div><h2 id="launcher-setup-heading">首次使用</h2><p>下载并解压启动器。macOS 打开 BioInfoBuddy Launcher；Windows 双击 install.cmd。</p><p>启动器会准备 Conda，并在终端显示安装进度。</p></div>
        <div className="environment-setup-actions">
          <a className="button" href={launcherDownloads.macos} download><ArrowDownToLine size={15}/>macOS 启动器</a>
          <a className="button" href={launcherDownloads.windows} download><ArrowDownToLine size={15}/>Windows 启动器</a>
        </div>
      </section>
      {requested && <p className="environment-feedback" role="status">已发起{requested}安装请求，请在终端查看进度。</p>}
      <div className="environment-grid">
        {resources.map(resource => <article key={resource.id} className="environment-card" aria-labelledby={`${resource.id}-heading`}>
          <h2 id={`${resource.id}-heading`}>{resource.title}</h2>
          <p className="environment-platform">{resource.platform}</p>
          <p className="environment-contents">{contents[resource.id]}</p>
          <a className="button" href={launcherUrl(resource.id)} onClick={() => setRequested(resource.title)} aria-label={`在终端安装${resource.title} · ${resource.platform}`}>
            <Terminal size={15}/>在终端安装
          </a>
        </article>)}
      </div>
      <section className="environment-dependencies" aria-labelledby="case-dependencies-heading">
        <header><h2 id="case-dependencies-heading">案例配套依赖</h2><p>用于“案例与图表”中的复现包。</p></header>
        {caseDependencies.map(dependency => <article key={dependency.id} className="environment-dependency">
          <div><h3>{dependency.title}</h3><p>{dependency.description}</p></div>
          <div className="environment-dependency-actions">{(['windows', 'macos'] as const).map(platform => <a key={platform} className="button" href={launcherUrl(`case-${dependency.id}-${platform}`)} onClick={() => setRequested(dependency.title + ' 案例配套依赖')} aria-label={`在终端安装${dependency.title}案例配套依赖 · ${platform === 'windows' ? 'Windows' : 'macOS'}`}><Terminal size={15}/>{platform === 'windows' ? 'Windows' : 'macOS'} 安装</a>)}</div>
        </article>)}
      </section>
    </div>
  </section>;
}
