import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Download, FileText, Info } from 'lucide-react';
import type { MainView } from './navigation';
import './tutorial.css';

const chapters = [
  ['start','准备与连接'], ['first-chart','生成第一张图'], ['choose','选择图例'],
  ['parameters','理解绘图参数'], ['read','读懂图表'], ['versions','调整与导出'],
  ['ai','让 AI 协助'], ['faq','常见问题'],
] as const;
const formats = [
  ['表格绘图','CSV / TSV / XLSX','箱线图、小提琴图、散点图、直方图、均值柱状图、矩阵热图','≤ 10 MiB；50,000 行、100 列；Excel 读取第一张工作表'],
  ['FASTQ 质控','FASTQ / FQ / .gz','Read 长度分布、Read 平均质量','≤ 2 GiB；四行格式，质量编码为 Phred+33'],
  ['单细胞','H5AD','绘制已有嵌入的前两维，按类别着色','≤ 2 GiB；需有至少二维的 obsm 嵌入'],
  ['R 脚本','R / r','运行自己编写或已审阅的绘图脚本','≤ 1 MiB；可附加一份已导入表格'],
];
const chartChoices = [
  ['比较各组数值分布','箱线图','分组列 + 数值列，或多个数值列组成的宽表'],
  ['查看各组分布形状','小提琴图','每组至少两个数值，且不能全部相同；样本少时先看原始点'],
  ['查看两个变量的关系','散点图','两个数值列；可另选分类列着色'],
  ['查看数值落在哪些区间','直方图','一个数值列；可选分组'],
  ['比较各组均值与原始值','均值柱状图','分组列 + 数值列，或宽表'],
  ['比较矩阵中的数值高低','矩阵热图','多个数值列；最多 50 行 × 30 个数值字段'],
];
const appearance = [
  ['图标题 / X、Y 轴标签','各 ≤ 160 字符','填写变量含义和单位；坐标轴标签留空时使用默认名称。'],
  ['配色方案','按图例选择','分类图中颜色区分类别；热图中颜色表示数值。'],
  ['字号','6 至 24 pt','控制图中文字的大小；导出前按最终使用尺寸检查。'],
  ['点面积','1 至 100 pt²','只出现在带散点的图例中；单位是面积，不是直径。'],
  ['不透明度','0.05 至 1','数值越小越透明，重叠的点更容易分辨。'],
  ['图宽 / 图高','各 3 至 16 英寸','设置图片尺寸。例如 8 × 6 英寸、300 dpi 的图片为 2400 × 1800 像素。'],
  ['PNG 分辨率','72 至 600 dpi，整数','图宽 × 图高 × dpi² 不得超过 4,000 万像素。'],
];
const faqs = [
  ['没有 API Key，能不能画图？','可以。“数据与绘图”使用本地固定模板，不需要模型密钥。只有使用 AI 对话时，才需要在“模型设置”配置自己的 API Key。'],
  ['配对失败或本地助手断开了怎么办？','先确认助手终端仍在运行。配对码是八位数字，有效期 15 分钟且只能使用一次；助手重启后要使用新码连接。如果浏览器询问本地网络访问权限，需允许本站访问本机。连接到其他部署地址时，按“本地助手”页面检查允许的网站来源。'],
  ['技能已经安装，为什么仍不能绘图？','安装技能后，还需要准备对应的运行环境。打开“分析环境”，确认对应环境显示“已就绪”。安装失败时先读日志：检查 uv 是否可用、软件源是否能连接；运行 R 还需预先安装 R。解决原因后点击“重试安装”。'],
  ['预览的行数为什么变多或变少？','宽表会把选中的多个数值列展开为 group / value，两列各有 6 个有效数值时可得到 12 个观测。选择删除缺失值时，会排除参与绘图字段含缺失值的行或展开后的观测。核对预览中的转换步骤、输出行数和删除提示，再决定是否执行。'],
  ['为什么小提琴图报错，或图上没有显著性星号？','小提琴图每组至少需要两个数值，且不能全部相同。数值都相同或样本太少时，可改看箱线图或原始点。内置图例不进行显著性检验，也不计算 p 值；图上看起来有差别，不代表差异具有统计显著性。'],
  ['H5AD 里没有可选嵌入或注释怎么办？','请先在上游分析中准备数据：obsm 中需要至少二维的嵌入，obs 中需要可用于着色的分类注释。本站不会自动计算 UMAP、聚类或注释细胞类型。分类着色最多支持 30 类，连续表达量目前不能直接作为连续色标。'],
  ['修改参数后，为什么图还没变？','编辑时显示的是上一次已完成的图。点击“预览更改”，重新核对并确认执行，成功后才显示新版本。只改配色或字号时，也要重新预览并确认。'],
  ['R 脚本完成了，却没有图片怎么办？','检查脚本是否把 PNG、SVG 或 PDF 写入 output_dir。input_file 是可选附加表格的路径，未选时为 NULL；params 当前为空列表。使用与文件格式对应的读取函数。R 脚本没有通用外观控件，修改代码后需重新导入。'],
  ['关闭网页后，结果还在吗？','已保存的数据、方案和结果仍在助手的数据目录中，重新连接后可在“运行记录”打开。聊天记录保存在当前浏览器中。关闭网页后，本机任务仍可能继续运行。重要结果请下载并另行备份。'],
];

function DataTable({ headings, rows, label }: { headings: string[]; rows: string[][]; label: string }) {
  return <div className="tutorial-table" role="region" aria-label={label} tabIndex={0}><table><thead><tr>{headings.map(title=><th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=>j===0?<th key={j} scope="row">{cell}</th>:<td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
function Figure({ file, alt, caption }: { file: string; alt: string; caption: string }) {
  return <figure className="tutorial-figure"><a href={`/tutorial/${file}`} target="_blank" rel="noopener noreferrer" aria-label={`放大查看：${alt}`}><img src={`/tutorial/${file}`} alt={alt} loading="lazy" width="1440" height={file==='first-chart.png'?1200:1000}/><span>查看大图 <ArrowUpRight size={13}/></span></a><figcaption>{caption}</figcaption></figure>;
}

export default function Tutorial({ onNavigate }: { onNavigate: (view: MainView) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>('start');
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry=>entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id.replace('tutorial-',''));
    }, {root:root.current,rootMargin:'-5% 0px -65% 0px',threshold:0});
    root.current?.querySelectorAll('section[id]').forEach(section=>observer.observe(section));
    return ()=>observer.disconnect();
  }, []);
  function jump(id:string) {
    const section = root.current?.querySelector<HTMLElement>(`#tutorial-${id}`);
    section?.scrollIntoView({block:'start'}); section?.focus({preventScroll:true}); setActive(id);
  }
  function RouteLink({ view, children }: {view:MainView; children:React.ReactNode}) {
    return <a href={view==='chat'?'/':`/?view=${view}`} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(view);}}}>{children}<ArrowUpRight size={13}/></a>;
  }
  return <div className="tutorial-scroll" ref={root}>
    <div className="tutorial-layout">
      <article className="tutorial-article" aria-labelledby="tutorial-title">
        <header className="tutorial-intro">
          <p className="tutorial-eyebrow">BIOINFOBUDDY / 使用指南</p>
          <h1 id="tutorial-title">数据分析<br/>与绘图教程</h1>
          <p className="tutorial-lead">用合成样例练习选图、核对转换和调整参数，再导入自己的实验数据。保存图表时，也可以一并保存数据和复现记录。</p>
          <div className="tutorial-actions"><button className="button primary" onClick={()=>jump('first-chart')}>查看绘图步骤<ArrowRight size={16}/></button><RouteLink view="analysis">打开数据与绘图</RouteLink></div>
          <div className="tutorial-overview" aria-label="绘图流程">{['连接本地助手','导入数据与选图','预览并确认','调整与导出'].map((step,i)=><div key={step}><span>0{i+1}</span>{step}</div>)}</div>
          <p className="tutorial-scope"><Info size={16}/><span>本教程介绍表格绘图、FASTQ 概览、已有单细胞嵌入的绘制和 R 脚本运行。目前不支持差异表达分析、GO / KEGG 富集或 GSEA。</span></p>
        </header>

        <section id="tutorial-start" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>01</span><h2>准备与连接</h2></div>
          <p>你在网页上选择数据和设置参数，本地助手负责保存文件、运行分析。首次使用需要安装并配对助手，之后使用时保持助手运行。</p>
          <ol className="tutorial-steps">
            <li><h3>启动本地助手</h3><p>目前需要从源码启动助手。先安装 Node.js（22.x 中的 22.18+，或 24.2+）和 uv，再在项目根目录依次运行下面的命令。要运行 R 脚本，还需安装 R。</p><pre aria-label="启动助手命令"><code>{'npm ci --ignore-scripts\nnpm run setup:companion\nnpm run companion'}</code></pre><p>终端显示八位配对码后，不要关闭这个窗口。如果要在本机启动网页，另开一个终端，在项目根目录运行 <code>npm run dev</code>。</p></li>
            <li><h3>输入配对码</h3><p>打开 <RouteLink view="connection">本地助手</RouteLink>，输入终端中的配对码并连接。配对码有效期为 15 分钟、仅可使用一次；重启助手后需要重新配对。</p></li>
            <li><h3>安装技能和运行环境</h3><p>在 <RouteLink view="skills">数据分析技能</RouteLink> 中启用需要的技能，再到 <RouteLink view="environments">分析环境</RouteLink> 点击“一键安装环境”。等对应环境显示“已就绪”后，就可以检查数据并绘图。首次安装需要联网。</p></li>
          </ol>
          <aside className="tutorial-note"><strong>本例只需要“基础科研绘图”</strong><p>安装它的运行环境即可完成下一节，不必安装其他环境。手动绘图不需要 API Key。</p></aside>
        </section>

        <section id="tutorial-first-chart" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>02</span><h2>生成第一张图</h2></div>
          <p>下面用 Control 和 Treated 两组数据画箱线图。表格是合成样例，只用于练习，不是真实实验数据。</p>
          <div className="tutorial-example-heading"><span><FileText size={16}/> 分组样例 · 6 行观测</span><a href="/tutorial/grouped-example.csv" download><Download size={14}/>下载样例 CSV</a></div>
          <DataTable label="合成样例数据" headings={['sample','group','value','measure']} rows={[
            ['S01','Control','4.2','12'],['S02','Control','5.1','15'],['S03','Control','4.8','14'],
            ['S04','Treated','6.7','21'],['S05','Treated','7.2','23'],['S06','Treated','6.9','22'],
          ]}/>
          <ol className="tutorial-steps">
            <li><h3>载入合成样例</h3><p>打开 <RouteLink view="analysis">数据与绘图</RouteLink>，在“表格绘图”选择“箱线图”，点击“载入合成样例”。也可以导入上面下载的 CSV。已有图表时，先点击“创建另一张图”。</p></li>
            <li><h3>选择分组列和数值列</h3><p>“数据排布”选择“长表：分组列 + 数值列”，“分组字段”选 <code>group</code>，“数值字段”选 <code>value</code>。缺失值处理保持“发现缺失值时停止”。样本名 <code>sample</code> 和另一数值列 <code>measure</code> 不参与本次绘图。</p></li>
            <li><h3>预览并核对</h3><p>点击“预览转换方案”。本例应显示输入 6 行、输出 6 行，两组各 3 个观测，没有删除行。核对预览的 group / value 是否与上表一致。</p></li>
            <li><h3>确认生成</h3><p>勾选“我已核对字段、转换步骤、行数及提示”，再点击“确认并在本机生成”。生成后，页面会显示图表和下载按钮。每个点对应一个原始观测；图中不含统计显著性检验。</p></li>
          </ol>
          <Figure file="first-chart.png" alt="分组样例的箱线图结果，展示 Control 与 Treated 两组及图表下载入口" caption="图 1 · 合成样例的箱线图结果。先核对各组的原始点，再看分布。点击截图可放大。"/>
        </section>

        <section id="tutorial-choose" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>03</span><h2>根据数据选择图例</h2></div>
          <p>根据文件类型和要观察的内容选择图例。文件大小低于导入上限，也可能受到本机内存或处理时间的限制。</p>
          <DataTable label="支持的文件和功能" headings={['入口','输入格式','可完成的操作','当前限制']} rows={formats}/>
          <h3>表格数据怎么选图？</h3>
          <DataTable label="表格图例选择" headings={['你想看什么','选择图例','需要的数据']} rows={chartChoices}/>
          <aside className="tutorial-note"><strong>长表和宽表的区别</strong><p>长表用一列写组名、一列写数值；宽表把每组放在一个数值列中。箱线图、小提琴图和均值柱状图支持将宽表展开为 group / value。选择宽表时只勾选要比较的数值列，避免把样本编号或不同单位的指标混在一起。</p></aside>
        </section>

        <section id="tutorial-parameters" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>04</span><h2>理解绘图参数</h2></div>
          <p>在“图表外观”中设置颜色、字号等，在“数据与转换参数”中选择字段和读取数量。修改任一类参数后，都要重新预览并确认。</p>
          <DataTable label="图表外观参数" headings={['参数','范围','含义与使用方式']} rows={appearance}/>
          <h3>不同数据类型的专用参数</h3>
          <dl className="tutorial-definitions">
            <div><dt>缺失值处理</dt><dd>表格默认遇到缺失值停止。选择删除后，程序会排除参与绘图字段含缺失值的行或展开后的观测。请在预览里核对删除数量。程序不自动补值或删除异常值。</dd></div>
            <div><dt>FASTQ：最多读取的记录数</dt><dd>默认 10,000，允许 1 至 1,000,000。按文件顺序读取前 N 条，不做随机抽样。文件不足 N 条时，使用实际读到的记录。</dd></div>
            <div><dt>H5AD：已有嵌入与细胞数量</dt><dd>选择已有 UMAP、PCA 等嵌入，绘制前两维。默认取前 50,000 个细胞，可设置 1 至 200,000；不会重新计算嵌入。</dd></div>
            <div><dt>H5AD：注释字段与配色</dt><dd>“按细胞注释着色”决定用哪一列分类，最多支持 30 类；“配色方案”设置各类别的颜色。选择注释不会自动生成或校正细胞类型。</dd></div>
            <div><dt>R：附加数据</dt><dd>可选择一份已导入的表格，作为 input_file 传给脚本。图表外观由脚本控制，页面不提供通用的字号、配色控件。</dd></div>
          </dl>
        </section>

        <section id="tutorial-read" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>05</span><h2>读懂图表</h2></div>
          <p>阅读本站生成的图表时，先核对横纵轴及单位，再看点、柱和颜色的含义。</p>
          <div className="tutorial-reading">
            <div><h3>箱线图与小提琴图</h3><p>横轴为组别，纵轴为数值。箱体从第 25 百分位延伸到第 75 百分位，中线为中位数；须线延伸到 1.5 倍四分位距范围内的最远观测。所有原始点叠加显示，包括须线外的点。小提琴轮廓来自核密度估计，越宽表示估计密度越高；样本较少时，轮廓未必能反映总体分布。</p></div>
            <div><h3>散点图与均值柱状图</h3><p>散点图的每个点对应一条观测，横纵轴分别是选定的两个数值字段；颜色可区分组别。均值柱状图的柱高为组内算术均值，叠加原始点，不自动添加误差线。图形本身不提供相关系数、回归或因果结论。</p></div>
            <div><h3>直方图与矩阵热图</h3><p>直方图横轴为数值区间，纵轴为频数；表格图例使用 20 个等宽区间，各组共享区间。热图按输入行列顺序展示数值，色标对应数值大小，不自动进行标准化或聚类。比较不同量纲的列前，需要先确定合理的数据处理方法。</p></div>
            <div><h3>FASTQ 长度与质量</h3><p>长度图横轴为 read 长度（nt），纵轴为 read 数量。质量图横轴为每条 read 的 Phred+33 质量值算术平均，纵轴为 read 数量，两种图均使用 40 个区间。这两种图反映读取到的记录的分布，不包含逐碱基位置的质量分析、比对或表达定量。</p></div>
            <div><h3>细胞嵌入图</h3><p>每个点是一条细胞观测，横纵轴来自所选嵌入的前两维。颜色对应已有分类注释。可以观察点的聚集情况，但仅凭这张图无法判断聚类、批次校正或细胞注释是否正确。</p></div>
          </div>
          <aside className="tutorial-note"><strong>关于统计显著性</strong><p>内置图例不计算 p 值、差异基因或通路富集。判断组间差异是否显著，需要根据实验设计选择统计方法，不能只看图上的高低或颜色。</p></aside>
        </section>

        <section id="tutorial-versions" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>06</span><h2>修改图表和保存版本</h2></div>
          <ol className="tutorial-steps">
            <li><h3>打开已有结果</h3><p>在图表结果点击“调整参数”，或从 <RouteLink view="history">运行记录</RouteLink> 打开已有结果后再编辑。页面会载入这次运行的源文件、图例和实际参数。</p></li>
            <li><h3>修改后重新核对</h3><p>可以先改标题、配色、字号和图幅；需要改字段或读取数量时，展开“数据与转换参数”。点击“预览更改”，核对新方案并重新确认。编辑期间显示的仍是上一版图。</p></li>
            <li><h3>生成新版本</h3><p>新图生成后会自动保存为一个版本，旧图和原始数据都保留。下载按钮对应当前显示的版本；点击“查看原始结果”可以回到修改前的版本。</p></li>
          </ol>
          <Figure file="edit-figure.png" alt="FASTQ 合成数据的图表编辑界面，左侧为当前图，右侧为标题配色字号图幅和预览更改控件" caption="图 2 · FASTQ 合成样例的编辑页面。左侧是上一版图，右侧是参数。修改后需重新预览、确认，才会生成新图。"/>
          <h3>哪些文件需要保存？</h3>
          <DataTable label="结果文件说明" headings={['产物','用途']} rows={[
            ['chart.png / chart.svg / chart.pdf','图表图片；PNG 用于预览，SVG / PDF 便于后续排版。部分散点图层可能栅格化。'],
            ['processed.csv','实际用于绘图的转换后数据。核对样本、数值和分组时使用。'],
            ['plan.json / manifest.json / provenance.json','保存转换方案、产物说明、源文件摘要、实际参数与版本来源等记录。'],
            ['analysis.py / requirements.txt','内置 Python 图例的复现代码和依赖；与同次运行的数据文件一起保存。'],
            ['analysis.R / renv.lock','R 运行的脚本副本和依赖锁文件；图表产物取决于脚本。'],
          ]}/>
          <p>在结果区逐个下载需要的文件。FASTQ / H5AD 的复现脚本从处理后的 CSV 重新绘图，不会从原始文件重新运行整个分析。完整留档还需要单独保存原始数据。默认本机数据目录为 <code>~/.bioinfobuddy/</code>，自定义目录以助手终端显示为准。</p>
        </section>

        <section id="tutorial-ai" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>07</span><h2>让 AI 帮你选择参数</h2></div>
          <p>在已导入数据旁点击“让 AI 帮我选择参数”，即可在对话中针对这份数据提问。首次使用，在顶部“模型设置”选择提供商并配置自己的 API Key。</p>
          <blockquote className="tutorial-prompt">请先检查这份表格。用 group 作为分组，value 作为数值，生成箱线图的转换方案。保留原始观测，遇到缺失值先提示我，执行前让我核对。</blockquote>
          <p>提问时写明要比较的对象、使用的字段，以及缺失值等数据如何处理。AI 可以检查数据，使用已支持的图例提出方案。执行前，需要你在绘图页面核对并确认。</p>
          <aside className="tutorial-note"><strong>哪些内容会发给模型？</strong><p>原始文件和绘图在本机处理。使用 AI 时，对话及工具返回的必要概要、少量数据预览会发送给所选模型提供商。API Key 默认只保留在当前标签会话，勾选“记住”后才持久保存在浏览器。</p></aside>
          <p>运行自有 R 脚本时，还需逐次确认信任代码。独立 renv 环境隔离包依赖，脚本仍以本机用户权限执行。</p>
        </section>

        <section id="tutorial-faq" tabIndex={-1}>
          <div className="tutorial-section-heading"><span>08</span><h2>常见问题</h2></div>
          <div className="tutorial-faq">{faqs.map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
          <footer className="tutorial-footer"><div><strong>打开绘图页面</strong><p>可以先载入合成样例，熟悉操作后再导入自己的数据。</p></div><button className="button primary" onClick={()=>onNavigate('analysis')}>开始绘图<ArrowRight size={16}/></button></footer>
        </section>
      </article>
      <nav className="tutorial-toc" aria-label="教程目录"><p>本页内容</p>{chapters.map(([id,label],index)=><a key={id} href={`#tutorial-${id}`} aria-current={active===id?'location':undefined} onClick={event=>{event.preventDefault();jump(id);}}><span>0{index+1}</span>{label}</a>)}<div className="tutorial-toc-help">连接助手后，<br/>可按第二节的步骤<br/>用 6 行样例练习绘图。</div></nav>
    </div>
  </div>;
}
