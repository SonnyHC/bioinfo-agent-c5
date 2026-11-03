import { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import catalog from './data/reference-genomes.json';
import './reference-genomes.css';

const PAGE_SIZE = 25;
export default function ReferenceGenomes() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState('all');
  const [page, setPage] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const results = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return catalog.entries.filter(entry => (category === 'all' || entry.category === category)
      && (source === 'all' || entry.provider === source)
      && terms.every(term => {
        const haystack = [entry.species, entry.englishName, entry.scientificName, entry.assembly, entry.release, entry.accession, entry.name].join(' ').toLocaleLowerCase();
        return terms.length > 1 && /^[a-z]+$/.test(term) ? new RegExp(`\\b${term}\\b`).test(haystack) : haystack.includes(term);
      }));
  }, [query, category, source]);
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = results.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  function reset() { setQuery(''); setCategory('all'); setSource('all'); setPage(0); }
  function goToPage(next: number) { setPage(next); panel.current?.scrollTo({top:0}); }
  return <section ref={panel} className="genome-panel" aria-labelledby="genome-heading">
    <div className="genome-heading"><div><h1 id="genome-heading">参考基因组</h1><p>按物种和版本查找，下载对应的基因组序列与基因注释。</p></div><span className="genome-date">链接核对于 {catalog.checkedAt}</span></div>
    <div className="genome-filters">
      <label className="genome-search"><Search size={18}/><input type="search" aria-label="搜索参考基因组" placeholder="搜索物种、版本或 GCA / GCF 登录号" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
      <label><span>物种分类</span><select value={category} onChange={e=>{setCategory(e.target.value);setPage(0);}}><option value="all">全部分类</option>{[...new Set(catalog.entries.map(e=>e.category))].map(item=><option key={item}>{item}</option>)}</select></label>
      <label><span>数据来源</span><select value={source} onChange={e=>{setSource(e.target.value);setPage(0);}}><option value="all">全部来源</option>{[...new Set(catalog.entries.map(e=>e.provider))].map(item=><option key={item}>{item}</option>)}</select></label>
    </div>
    <div className="genome-summary"><span role="status">找到 {results.length} 个参考版本</span><button onClick={reset} disabled={!query&&category==='all'&&source==='all'}>重置筛选</button></div>
    <div className="genome-table-wrap"><table className="genome-table"><caption className="sr-only">参考基因组下载目录</caption><thead><tr><th scope="col">物种大类</th><th scope="col">物种</th><th scope="col">物种英文名</th><th scope="col">物种拉丁名</th><th scope="col">参考基因组名称</th><th scope="col">下载链接</th></tr></thead><tbody>{visible.map(entry=><tr key={entry.id}>
      <td>{entry.category}</td>
      <td><strong>{entry.species}</strong></td>
      <td>{entry.englishName}</td>
      <td><span className="genome-latin">{entry.scientificName}</span></td>
      <td><strong className="genome-assembly">{entry.name}</strong><a className="genome-source" href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.provider}<ArrowUpRight size={12}/></a>{entry.note&&<span className="genome-note">{entry.note}</span>}</td>
      <td><div className="genome-downloads">{entry.downloads.map(file=><a key={file.url} href={file.url} target="_blank" rel="noopener noreferrer" aria-label={`${entry.species} ${entry.assembly} ${entry.release} ${file.label}`}><Download size={14}/>{file.label}</a>)}</div></td>
    </tr>)}</tbody></table></div>
    {!results.length&&<div className="genome-empty"><h2>没有匹配的参考基因组</h2><p>试试中文名、拉丁名或更短的版本名称。</p><button className="button" onClick={reset}>显示全部版本</button></div>}
    <nav className="genome-pagination" aria-label="参考基因组分页"><span>第 {currentPage+1} / {pages} 页</span><button aria-label="上一页" disabled={currentPage===0} onClick={()=>goToPage(currentPage-1)}><ChevronLeft size={16}/>上一页</button><button aria-label="下一页" disabled={currentPage+1>=pages} onClick={()=>goToPage(currentPage+1)}>下一页<ChevronRight size={16}/></button></nav>
    <details className="genome-help"><summary>文件与版本怎么选</summary><p>FASTA 是基因组序列，GTF / GFF3 是基因注释；搭配使用时选择同一行。10x 参考包是已构建的 Cell Ranger 参考目录。只有 FASTA 的条目表示该来源未提供对应注释。</p><p>GCA 是 GenBank 组装登录号，GCF 是 RefSeq 组装登录号，末尾的小数点后数字表示组装版本。Ensembl 数字表示注释发布版本。原表中未说明用途的独立数字编号不参与版本选择。</p><a href="https://www.ncbi.nlm.nih.gov/datasets/docs/v2/policies-annotation/genome-processing/version-status/" target="_blank" rel="noopener noreferrer">NCBI 组装版本说明<ArrowUpRight size={12}/></a></details>
  </section>;
}
