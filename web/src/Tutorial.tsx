import type { MainView } from './navigation';
import './tutorial.css';
export default function Tutorial({onNavigate}:{onNavigate:(view:MainView)=>void}) {
  return <article className="tutorial-scroll"><div className="tutorial-layout tutorial-api-layout">
    <header className="tutorial-intro"><p>使用教程</p><h1>从问题到可复现的图表</h1><p>选择国内模型 API 进行对话，或直接导入表格绘图。</p></header>
    <section className="tutorial-section"><h2>1. 配置模型 API</h2><p>点击左下角“配置模型 API”，选择提供商，填写该平台的 API Key 和模型 ID。可从模型输入框选择预设，也可输入控制台提供的模型 ID。每个平台的密钥独立保存。</p><p>支持 DeepSeek、通义千问、智谱 GLM、Kimi、豆包、MiniMax 和百度文心。设置窗口提供获取密钥和官方 API 文档链接。千问使用北京地域密钥，可填写业务空间 ID；豆包也可填写 ep- 开头的推理接入点。</p><p>未勾选“记住”时，密钥只保存于当前标签会话。对话通过本站 API 转发到所选官方平台；本站不持久保存密钥。直接讨论生信问题不需要导入文件。</p></section>
    <section className="tutorial-section"><h2>2. 导入表格并选图</h2><p>打开“数据与绘图”，导入不超过 2 MB 的 CSV、TSV 或 XLSX。表格会上传到本站分析服务进行检查与绘图，XLSX 读取第一张工作表。可先用页面中的合成样例练习。</p><button className="button" onClick={()=>onNavigate('analysis')}>打开数据与绘图</button><p>先核对字段、行数和缺失值。宽表的每个数值列代表一组，长表通过分组字段和数值字段指定数据。默认遇到缺失值时停止；选择排除后，方案会显示排除的行数。</p><p>箱线图与小提琴图用于比较分布，散点图查看两变量关系，直方图查看数值分布，柱状图显示组均值和样本点，热图显示矩阵。不自动归一化或执行统计检验。</p></section>
    <section className="tutorial-section"><h2>3. 检查方案后生成</h2><p>选择图表、字段和标题，点击“预览转换方案”。检查转换步骤、输入与输出行数及转换后的表格，再勾选“使用此方案”并点击“生成图表”。AI 只能提出方案，不能替你批准运行。</p><p>在绘图设置底部点击“让 AI 帮我选参数”，可将当前表格带入对话。AI 读取真实字段与少量预览，生成的方案链接会返回同一绘图页面。</p><p>本网站当前处理表格，不提供 FASTQ、H5AD 或 R 脚本执行。</p></section>
    <section className="tutorial-section"><h2>4. 调整、导出与保存</h2><p>在结果页下载 PNG、SVG、PDF 或完整复现包。修改字段、标题或缺失值处理后，需要重新预览并确认，新图保存为新的运行记录，旧图仍可从“运行记录”打开。</p><p>文件、方案、图表与聊天保存在此浏览器。清除网站数据或更换浏览器后不会自动恢复，请及时下载重要结果。本站分析服务使用临时工作目录处理表格，请求结束后清理工作目录。</p><p>“参考基因组”可按物种、版本及登录号检索，下载链接指向原始数据站点，无需配置模型。</p><button className="button" onClick={()=>onNavigate('genomes')}>查看参考基因组</button></section>
    <section className="tutorial-section"><h2>常见问题</h2><h3>没有 API Key 能画图吗？</h3><p>可以。手动绘图使用本站固定模板，只有 AI 对话需要模型密钥。</p><h3>模型报错怎么办？</h3><p>检查密钥所属平台和地域、模型是否开通、账户余额与限流状态。编码套餐密钥可能只能用于专属接口，不能直接用于本页标准 API。</p><h3>绘图服务暂时不可用怎么办？</h3><p>可继续使用 AI 对话和参考基因组。稍后重试导入；自行运行网站时，请按 README 配置服务端 Python 依赖。</p></section>
  </div></article>;
}
