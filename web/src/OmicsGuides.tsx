import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDownToLine, List } from 'lucide-react';
import { omicsGuides } from './omics-content';
import GuideMarkdown from './GuideMarkdown';
import { parseGuideMarkdown } from './guide-markdown';
import './omics-guides.css';

export default function OmicsGuides() {
  const [selected, setSelected] = useState(omicsGuides[0].id);
  const [activeHeading, setActiveHeading] = useState('');
  const reader = useRef<HTMLElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const mobileToc = useRef<HTMLDetailsElement>(null);
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const guide = omicsGuides.find(item => item.id === selected)!;
  const parsed = useMemo(() => parseGuideMarkdown(guide.markdown, `${instance}-${guide.id}`), [guide, instance]);
  const chapters = parsed.headings.filter(heading => heading.level > 1);
  const panelId = `${instance}-guide-panel`;

  useEffect(() => {
    const host = reader.current;
    const scrollRoot = host?.closest<HTMLElement>('.tutorial-scroll, .omics-scroll');
    if (!host || !scrollRoot) return;
    let frame = 0;
    const update = () => {
      const top = scrollRoot.getBoundingClientRect().top + 112;
      let current = parsed.headings.find(heading => heading.level > 1)?.id ?? '';
      for (const heading of parsed.headings) {
        if (heading.level <= 1) continue;
        const node = document.getElementById(heading.id);
        if (node && node.getBoundingClientRect().top <= top) current = heading.id;
      }
      if (scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 2) {
        current = parsed.headings.filter(heading => heading.level > 1).at(-1)?.id ?? current;
      }
      setActiveHeading(current);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    scrollRoot.addEventListener('scroll', onScroll, {passive: true});
    return () => {scrollRoot.removeEventListener('scroll', onScroll);cancelAnimationFrame(frame);};
  }, [parsed]);

  function selectGuide(index: number, focus = false) {
    setSelected(omicsGuides[index].id);
    if (mobileToc.current) mobileToc.current.open = false;
    if (focus) tabs.current[index]?.focus();
    const host = reader.current;
    const scrollRoot = host?.closest<HTMLElement>('.tutorial-scroll, .omics-scroll');
    if (host && scrollRoot) {
      const offset = host.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top;
      if (offset < 0) scrollRoot.scrollTo({top: scrollRoot.scrollTop + offset, behavior: 'instant'});
    }
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = omicsGuides.length - 1;
    const next = event.key === 'ArrowRight' ? (index + 1) % omicsGuides.length
      : event.key === 'ArrowLeft' ? (index + last) % omicsGuides.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    selectGuide(next, true);
  }

  function navigateHeading(id: string) {
    if (mobileToc.current) mobileToc.current.open = false;
    const node = document.getElementById(id);
    node?.scrollIntoView({block: 'start', behavior: 'instant'});
    node?.focus({preventScroll: true});
    setActiveHeading(id);
  }

  const contents = <nav aria-label="本篇章节">{chapters.map(heading =>
    <a key={heading.id} href={`#${heading.id}`} className={`guide-toc-level-${Math.min(heading.level, 4)}`} aria-current={activeHeading === heading.id ? 'location' : undefined} onClick={event => {event.preventDefault();navigateHeading(heading.id);}}>{heading.text}</a>
  )}</nav>;

  return <section ref={reader} className="guide-reader" aria-label="四篇组学专题教程">
    <div className="guide-tabs" role="tablist" aria-label="组学专题">{omicsGuides.map((item, index) =>
      <button key={item.id} ref={node => {tabs.current[index] = node;}} type="button" role="tab" id={`${instance}-tab-${item.id}`} aria-selected={selected === item.id} aria-controls={panelId} tabIndex={selected === item.id ? 0 : -1} onClick={() => selectGuide(index)} onKeyDown={event => onTabKey(event, index)}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{item.title}</button>
    )}</div>
    <div id={panelId} role="tabpanel" aria-labelledby={`${instance}-tab-${selected}`} tabIndex={0} className="guide-reading-layout">
      <details ref={mobileToc} className="guide-mobile-toc"><summary><List size={16}/>本篇目录</summary>{contents}</details>
      <article className="guide-document" key={guide.id}>
        <div className="guide-document-actions"><span>组学专题 · {String(omicsGuides.indexOf(guide) + 1).padStart(2, '0')}</span><div><a download href={`/resources/v1/guides/${guide.id}.md`}><ArrowDownToLine size={14}/>下载本篇</a><a download href="/resources/v1/guides-reproduction.zip">下载全部教程</a></div></div>
        <GuideMarkdown blocks={parsed.blocks}/>
        <footer className="guide-document-source"><p>原文来源：{guide.source}</p><p>文中平台界面与操作说明沿用原文。</p></footer>
      </article>
      <aside className="guide-toc" aria-label="章节目录"><p><List size={14}/>本篇目录</p>{contents}</aside>
    </div>
  </section>;
}
