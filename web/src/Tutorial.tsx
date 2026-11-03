import OmicsGuides from './OmicsGuides';
import './tutorial.css';

export default function Tutorial() {
  return <div className="tutorial-scroll"><div className="tutorial-doc-layout">
    <header className="tutorial-intro"><h1>使用教程</h1><p>从数据质控到结果解读，按专题阅读组学分析文档。</p></header>
    <OmicsGuides/>
  </div></div>;
}
