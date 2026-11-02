import { useState } from 'react';
import { ArrowDownToLine, ExternalLink } from 'lucide-react';
import { omicsGuides } from './omics-content';

export default function OmicsGuides() {
  const [selected, setSelected] = useState(omicsGuides[0].id);
  const guide = omicsGuides.find(item => item.id === selected)!;
  return <section className="omics-guides" aria-label="四篇组学专题教程">
    <div className="omics-guide-picker"><label>选择专题<select value={selected} onChange={event => setSelected(event.target.value)}>{omicsGuides.map((item, i) => <option value={item.id} key={item.id}>{i + 1}. {item.title}</option>)}</select></label><a className="button" download href="/resources/v1/guides-reproduction.zip"><ArrowDownToLine size={15}/>下载全部教程与截图</a></div>
    <article className="omics-lesson" key={guide.id}>
      <header><h2>{guide.title}</h2><p>{guide.summary}</p><a download href={`/resources/v1/guides/${guide.id}.md`}>下载本篇 Markdown <ArrowDownToLine size={13}/></a></header>
      <p className="omics-note">本专题用于方法学习和外部环境复现；实际原始数据分析需要在 R / Python 中执行。</p>
      {guide.sections.map(section => <section key={section.title}>
        <h3>{section.title}</h3>
        {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        {section.items && <ol>{section.items.map(item => <li key={item}>{item}</li>)}</ol>}
        {section.table && <div className="omics-table" tabIndex={0} aria-label={`${section.title}表格，可横向滚动`}><table><thead><tr>{section.table.headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th scope="row" key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
        {section.screenshot && <figure className="omics-screenshot"><a href={`/resources/v1/guides/screenshots/${section.screenshot}`} target="_blank" rel="noreferrer" aria-label={`${section.caption}，打开原图`}><img src={`/resources/v1/guides/screenshots/${section.screenshot}`} alt={section.caption} loading="lazy" width="1280" height="720"/></a><figcaption>{section.caption}</figcaption></figure>}
      </section>)}
      <footer className="omics-sources"><p>按附件《{guide.source}》改写。原文可从完整原始资料下载。</p><h3>官方资料与方法参考</h3>{guide.sources.map(source => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}<ExternalLink size={12}/></a>)}</footer>
    </article>
  </section>;
}
