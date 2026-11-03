import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Dna, Moon, Sun, Pause, Play, SlidersHorizontal, X } from 'lucide-react';
import './launch.css';

interface ParticleOwner {
  dispose(): void; pause(value?: boolean): void; refresh(): void;
  configure(value: {brush?:number; projection?:string; materials?:Record<string, number[]>}): void;
}
interface ParticleModule {
  mountHelix(canvas:HTMLCanvasElement, options:{theme:string;onState:(state:string)=>void}): ParticleOwner | null;
  themes: Record<string,Record<string,number[]>>;
}

// Message: make the path from biological data to a readable result approachable.
// Subject/composition: a tilted volumetric double helix opposite editorial Chinese type.
// Palette: mineral paper, deep teal and restrained brass; paired night palette.
// Motion/camera: slow axial turn, fixed perspective, no scene-switching distraction.
// Interaction: subtle reversible brush, explicit static and no-brush options.
export default function Launch() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const owner = useRef<ParticleOwner | null>(null);
  const module = useRef<ParticleModule | null>(null);
  const [theme, setTheme] = useState<'light'|'dark'>('light');
  const [state, setState] = useState('loading');
  const [brush, setBrush] = useState(true);
  const [projection, setProjection] = useState('perspective');
  const [settings, setSettings] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    document.title = 'BioInfoBuddy · 让数据，显现生命的线索';
    let disposed = false;
    void import('./particle/scene.js').then((runtime:ParticleModule) => {
      if (disposed || !canvas.current) return;
      module.current = runtime;
      owner.current = runtime.mountHelix(canvas.current,{theme:'light',onState:setState});
    }).catch(()=>{if(!disposed)setState('unsupported');});
    return () => {disposed=true;owner.current?.dispose();owner.current=null;};
  },[]);
  useEffect(() => {if(module.current)owner.current?.configure({materials:module.current.themes[theme]});},[theme,state === 'loading']);
  useEffect(() => {owner.current?.configure({brush:brush ? .45 : 0,projection});},[brush,projection,state === 'loading']);
  useEffect(() => {
    if(settings) dialog.current?.showModal();
    else dialog.current?.close();
  },[settings]);
  const unavailable = state === 'loading' || state === 'unsupported';
  return <div className="launch" data-theme={theme}>
    <header className="launch-header">
      <a href="/" className="launch-brand" aria-label="BioInfoBuddy 首页"><Dna size={27} strokeWidth={1.5}/><span>bioinfobuddy<span className="launch-brand-dot">.</span></span></a>
      <nav aria-label="网站导航"><a href="/?view=skills">技能商店</a><a href="/?view=omics">组学案例</a><a href="/?view=tutorial">使用指南</a></nav>
      <div className="launch-header-actions"><button onClick={()=>setTheme(theme==='light'?'dark':'light')} aria-label={theme==='light'?'切换深色':'切换浅色'}>{theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button><a href="/?view=chat">进入工作台<ArrowUpRight size={15}/></a></div>
    </header>
    <main>
      <section className="launch-hero" aria-labelledby="launch-title">
        <div className="launch-copy"><p className="launch-kicker"><span/> YOUR BIOINFORMATICS COMPANION</p>
          <h1 id="launch-title">让数据，<br/>显现生命的<span className="launch-title-end">线索<span className="launch-title-dot">。</span></span></h1>
          <p className="launch-intro">从一个问题，到一份清晰的结果。<br/>与 AI 一起整理实验数据、探索分析技能，<br className="launch-desktop-break"/>让科研中的下一步，更容易开始。</p>
          <div className="launch-cta"><a href="/?view=chat" className="launch-primary">开始探索<ArrowRight size={19}/></a><a href="/?view=skills" className="launch-secondary">浏览分析技能<ArrowUpRight size={16}/></a></div>
          <p className="launch-small-note">在浏览器中开始 · 使用自己的模型 API</p>
        </div>
        <figure className="launch-sculpture">
          <div className="launch-scene-label"><span>01 / THE SHAPE OF LIFE</span><span>生命之序</span></div>
          <canvas ref={canvas} role="img" aria-label="缓慢旋转的青绿色三维粒子 DNA 双螺旋，属于示意造型" data-motion={state}>三维 DNA 双螺旋示意。可直接使用页面上的链接开始分析。</canvas>
          {state==='unsupported' && <div className="launch-fallback"><Dna size={112} strokeWidth={.7}/><p>从生命的线索，开始探索。</p></div>}
          <figcaption><span>{state==='reduced'?'已遵循系统减少动态效果设置':state==='paused'?'静态欣赏':state==='loading'?'正在构建粒子结构…':state==='unsupported'?'生命的形状 · 静态示意':!brush?'生命的形状 · 缓慢旋转':'移动指针，轻触生命的形状'}</span><div><button disabled={unavailable || state==='reduced'} onClick={()=>owner.current?.pause()} aria-label={state==='paused'?'播放动画':'暂停动画'}>{state==='paused'?<Play size={15}/>:<Pause size={15}/>}</button><button onClick={()=>setSettings(true)} aria-label="粒子显示设置"><SlidersHorizontal size={15}/></button></div></figcaption>
        </figure>
      </section>
      <section className="launch-pathways" aria-label="开始你的科研工作"><a href="/?view=chat"><span className="launch-path-number">01</span><div><h2>从问题开始</h2><p>把分析需求，变成可检查的步骤。</p></div><ArrowUpRight size={20}/></a><a href="/?view=skills"><span className="launch-path-number">02</span><div><h2>找到合适的技能</h2><p>按任务选择流程，让 AI 有章可循。</p></div><ArrowUpRight size={20}/></a><a href="/?view=analysis"><span className="launch-path-number">03</span><div><h2>让数据成为图表</h2><p>检查、确认，带走可复现的结果。</p></div><ArrowUpRight size={20}/></a></section>
    </main>
    <footer className="launch-footer"><span>为好奇心，留出更多时间。</span><span>SCIENCE STARTS WITH A QUESTION.</span><a href="/particle/NOTICE" target="_blank" rel="noopener noreferrer">粒子引擎 · 开源说明</a></footer>
    <dialog ref={dialog} className="launch-dialog" onCancel={()=>setSettings(false)} onClose={()=>setSettings(false)} aria-labelledby="particle-settings-title"><header><h2 id="particle-settings-title">粒子显示</h2><button aria-label="关闭显示设置" onClick={()=>setSettings(false)}><X size={20}/></button></header><p>选择你喜欢的观看方式。</p><label><span>镜头</span><select value={projection} onChange={e=>setProjection(e.target.value)}><option value="perspective">固定透视 · 呈现纵深</option><option value="orthographic">正交视角 · 保持比例</option></select></label><label className="launch-check"><input type="checkbox" checked={brush} onChange={e=>setBrush(e.target.checked)}/><span>指针轻触粒子</span></label><button className="launch-static" disabled={unavailable || state==='reduced'} onClick={()=>owner.current?.pause(state!=='paused')}>{state==='paused'?'恢复缓慢旋转':'切换为静态造型'}</button><small>此造型为 DNA 双螺旋的艺术化示意。</small></dialog>
  </div>;
}
