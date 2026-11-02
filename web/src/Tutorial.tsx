import { useState } from 'react';
import type { MainView } from './navigation';
import { skillCatalog } from './skill-catalog';
import OmicsGuides from './OmicsGuides';
import './tutorial.css';
import './omics.css';
export default function Tutorial({onNavigate}:{onNavigate:(view:MainView)=>void}) {
  const [topic, setTopic] = useState<'website' | 'omics'>('website');
  return <article className="tutorial-scroll"><div className="tutorial-layout tutorial-api-layout">
    <header className="tutorial-intro"><h1>使用教程</h1><p>网页各功能的操作说明，以及四篇组学专题。</p></header>
    <nav className="omics-tabs" aria-label="教程分类"><button aria-pressed={topic==='website'} onClick={()=>setTopic('website')}>网站操作</button><button aria-pressed={topic==='omics'} onClick={()=>setTopic('omics')}>四篇组学专题</button></nav>
    {topic==='omics' ? <OmicsGuides/> : <>
    <section className="tutorial-section"><h2>1. 配置模型 API</h2><p>点击左下角“配置模型 API”，选择提供商，填写该平台的 API Key 和模型 ID。可从模型输入框选择预设，也可输入控制台提供的模型 ID。每个平台的密钥独立保存。</p><p>支持 DeepSeek、通义千问、智谱 GLM、Kimi、豆包、MiniMax 和百度文心。设置窗口提供获取密钥和官方 API 文档链接。千问使用北京地域密钥，可填写业务空间 ID；豆包也可填写 ep- 开头的推理接入点。</p><p>未勾选“记住”时，密钥只保存于当前标签会话。对话通过本站 API 转发到所选官方平台；本站不持久保存密钥。直接讨论生信问题不需要导入文件。</p></section>
    <section className="tutorial-section"><h2>2. 导入表格并选图</h2><p>打开“数据与绘图”，导入不超过 2 MB 的 CSV、TSV 或 XLSX。表格会上传到本站分析服务进行检查与绘图，XLSX 读取第一张工作表。可先用页面中的合成样例练习。</p><button className="button" onClick={()=>onNavigate('analysis')}>打开数据与绘图</button><p>先核对字段、行数和缺失值。宽表的每个数值列代表一组，长表通过分组字段和数值字段指定数据。默认遇到缺失值时停止；选择排除后，方案会显示排除的行数。</p><p>箱线图与小提琴图用于比较分布，散点图查看两变量关系，直方图查看数值分布，柱状图显示组均值和样本点，热图显示矩阵。不自动归一化或执行统计检验。</p></section>
    <figure className="omics-screenshot"><a href="/resources/v1/guides/screenshots/table-workbench.jpg" target="_blank" rel="noreferrer"><img src="/resources/v1/guides/screenshots/table-workbench.jpg" alt="当前网页的数据与绘图页面，显示本站合成表格样例" loading="lazy" width="1280" height="720"/></a><figcaption>实际网页截图：合成表格用于练习导入、字段核对与绘图。</figcaption></figure>
    <section className="tutorial-section"><h2>3. 检查方案后生成</h2><p>选择图表、字段和标题，点击“预览转换方案”。检查转换步骤、输入与输出行数及转换后的表格，再点击“确认方案并生成图表”。AI 只能提出方案，必须由你确认后才会运行。</p><p>在绘图设置底部点击“让 AI 推荐字段与参数”，可将当前表格带入对话。AI 读取真实字段与少量预览，生成的方案链接会返回同一绘图页面。</p><p>本网站当前处理表格，不提供 FASTQ、H5AD 或 R 脚本执行。</p></section>
    <section className="tutorial-section"><h2>4. 调整、导出与保存</h2><p>在结果页下载 PNG、SVG、PDF 或完整复现包。修改字段、标题或缺失值处理后，需要重新预览并确认，新图保存为新的运行记录，旧图仍可从“运行记录”打开。</p><p>文件、方案、图表与聊天保存在此浏览器。清除网站数据或更换浏览器后不会自动恢复，请及时下载重要结果。本站分析服务使用临时工作目录处理表格，请求结束后清理工作目录。</p><p>“参考基因组”可按物种、版本及登录号检索，下载链接指向原始数据站点，无需配置模型。</p><button className="button" onClick={()=>onNavigate('genomes')}>查看参考基因组</button></section>
    <section className="tutorial-section"><h2>5. 添加数据分析技能</h2><p>在“数据分析技能”中搜索用途，查看输入、输出和完整流程，点击“添加技能”。添加记录保存在当前浏览器；添加本身不需要安装 Python／R。</p><p>点击“在对话中使用”会新建带技能流程的对话草稿，由你发送；普通对话也可以按任务加载已添加且启用的技能。在“我的技能”的详情中可停用或移除，已有数据、图表和对话不受影响。</p><p>当前提供 {skillCatalog.length} 项内置技能，包含网页表格流程和组学分析指导。添加技能不会自动执行分析；单细胞与空间组学的实际计算需要外部 R／Python 环境。使用 AI 仍需配置模型 API。可查看和下载 SKILL.md，尚不支持导入第三方技能。</p><button className="button" onClick={()=>onNavigate('skills')}>浏览数据分析技能</button></section>
    <section className="tutorial-section"><h2>6. 学习与复现组学案例</h2><p>“组学案例”提供 PBMC2700 单细胞四图与 GBM1 空间转录组九图。每张图配有解释、数据说明和参数；点击可查看原图或下载 PNG。</p><p>单细胞与空间转录组各有一个包含必需输入、适配代码和 macOS／Windows 指南的复现包。先阅读 README，再在外部环境执行；网站不安装环境或运行原始矩阵。空间 QMD 报告另需 Quarto 和 Jupyter。</p><p>“完整原始资料”保留压缩包中的全部 44 个文件，约 280 MB。可自动下载并校验合并，或分别下载 7 个分包和合并脚本。原始资料中的旧路径和旧平台描述仅作来源保留，复现时优先使用适配版。</p><p>上方“四篇组学专题”包含过滤整合聚类、注释结果复核、差异表达与富集、注释实操，并配有本版网页截图。专题及截图可一并下载。</p><button className="button" onClick={()=>onNavigate('omics')}>打开组学案例</button></section>
    <section className="tutorial-section"><h2>常见问题</h2><h3>没有 API Key 能画图吗？</h3><p>可以。手动绘图使用本站固定模板，只有 AI 对话需要模型密钥。</p><h3>模型报错怎么办？</h3><p>检查密钥所属平台和地域、模型是否开通、账户余额与限流状态。编码套餐密钥可能只能用于专属接口，不能直接用于本页标准 API。</p><h3>绘图服务暂时不可用怎么办？</h3><p>可继续使用 AI 对话和参考基因组。稍后重试导入；自行运行网站时，请按 README 配置服务端 Python 依赖。</p></section>
    </>}
  </div></article>;
}
