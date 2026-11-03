import guides from './data/omics-guides.json';
import skillReading from './data/skill-guides.json';

export interface GuideSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
  table?: {headers: string[]; rows: string[][]};
  screenshot?: string;
  caption?: string;
}
interface SkillGuideReading {
  id: string; title: string; summary: string; source: string;
  sections: GuideSection[];
  sources: {label: string; url: string}[];
}
export interface OmicsGuide {
  id: string; title: string; summary: string; source: string; markdown: string;
}
export const omicsGuides: OmicsGuide[] = guides;
// Tutorial source documents are independent of the curated agent guidance.
export const skillGuides: SkillGuideReading[] = skillReading;
export function guideText(guide: SkillGuideReading): string {
  return `# ${guide.title}\n\n${guide.summary}\n\n` + guide.sections.map(section =>
    `## ${section.title}\n\n` + (section.paragraphs ?? []).join('\n\n') + '\n' +
    (section.items ?? []).map(item => '- ' + item).join('\n') + '\n' +
    (section.table ? [section.table.headers, ...section.table.rows].map(row => row.join(' | ')).join('\n') : '')
  ).join('\n\n') + '\n\n参考：\n' + guide.sources.map(source => `${source.label}: ${source.url}`).join('\n');
}

export const omicsCases = [
  {
    id: 'single-cell' as const, label: '单细胞', title: 'PBMC2700：从质控到 marker 复核',
    description: '一份单样本 10x 表达矩阵，配合 Seurat 四图工作流，学习核对分群与表达证据。',
    source: '用户提供的 V1.0 / 单细胞；矩阵与目录按附件标注，未与原始发布文件做哈希比对。',
    facts: [['输入', '32,738 genes × 2,700 cells'], ['原附件记录', '质控后 2,638 cells · clusters 0–8'], ['执行环境', '外部 R / Seurat']],
    boundary: '一个来源样本，没有实验/对照标签。cluster 尚未人工注释；marker 汇总没有 P 值。下方图片均为附件已有结果。',
    command: 'Rscript "generate_four_plots.R" "./filtered_gene_bc_matrices/hg19" "./results"',
    files: [['generate_four_plots.R', '四图脚本'], ['install.R', 'R 依赖安装脚本'], ['colors.R', '20 / 38 色配色'], ['supplied-marker-summary.csv', '附件 marker 汇总'], ['README.md', 'macOS / Windows 复现指南']],
    figures: [
      ['01_QC_violin.png', '01 · 质控分布', '输入对象中的基因数、总计数和线粒体比例。黑点与数字表示中位数；只有 All cells 一组。'],
      ['02_UMAP_clusters.png', '02 · UMAP 聚类', '颜色和编号是算法 cluster；98% 数据椭圆及小群包络只辅助显示，不是生物边界。'],
      ['03_marker_dotplot.png', '03 · Marker DotPlot', '点大小表示检出比例，颜色表示平均 log 归一化表达；上方名称为 marker 组合，不是最终 cluster 标签。'],
      ['04_marker_featureplot.png', '04 · Marker FeaturePlot', '各面板共用 UMAP 坐标；每个基因按阳性表达第 99 百分位缩放，颜色不能跨基因直接比较。'],
    ],
  },
  {
    id: 'spatial' as const, label: '空间转录组', title: 'GBM1：把表达放回组织位置',
    description: '按附件 GSE194329 / GBM1 标注的 Visium 示例，连接质量控制、UMAP、聚类与组织图。',
    source: '用户提供的 V1.0 / 空间转录组，目录 GSE194329_RAW/GBM1_spaceranger_out；未独立核验 GEO 样本元数据。',
    facts: [['输入', 'H5 表达矩阵 + spatial/'], ['过滤参数', '5,000–35,000 counts · mt < 20%'], ['执行环境', '外部 Python 3.12 / Scanpy 1.12.1']],
    boundary: '分析单位是 spot，可能混合多个细胞。cluster marker 排名属于探索性比较。下方九图来自原附件，本次没有重新执行分析。',
    command: 'python "st_scanpy.py" --data-dir "./GSE194329_RAW/GBM1_spaceranger_out" --output-dir "./results"',
    files: [['st_scanpy.py', '九图脚本'], ['st_scanpy.qmd', 'Quarto 阅读报告'], ['environment.yml', '独立 Conda 环境定义'], ['README.md', 'macOS / Windows 复现指南']],
    figures: [
      ['01_QC_histograms.png', '01 · 质控直方图', '检查 spot 总计数和检出基因数分布；部分面板只显示特定数值范围，并非另一份样本。'],
      ['02_UMAP_total_counts.png', '02 · UMAP 总计数', '在同一降维空间中观察总计数与结构的关系。颜色差异不等于细胞类型。'],
      ['03_UMAP_n_genes_by_counts.png', '03 · UMAP 基因数', '按检出基因数着色，辅助识别复杂度是否与降维分布相关。'],
      ['04_UMAP_clusters.png', '04 · UMAP clusters', 'Leiden 聚类得到的 spot 群，编号不是人工注释的细胞类型。'],
      ['05_spatial_total_counts.png', '05 · 空间总计数', '将总计数叠加回组织图，检查信号与组织位置之间的关系。'],
      ['06_spatial_n_genes_by_counts.png', '06 · 空间基因数', '将检出基因数放回组织位置，和前面的质控及 UMAP 一起检查。'],
      ['07_spatial_clusters.png', '07 · 空间 clusters', '观察各 cluster 在组织中的分布；相邻 spot 的相似性不能当作独立生物重复。'],
      ['08_marker_heatmap_cluster2.png', '08 · Cluster 2 marker 热图', '按 clusters 使用 t-test 排名，显示 cluster 2 的前 10 个基因；不等同于病例对照差异分析。'],
      ['09_spatial_COL1A2_SYPL1.png', '09 · 特定基因空间分布', '查看 COL1A2 与 SYPL1 在组织中的表达位置，不由两个基因直接推断细胞身份或因果机制。'],
    ],
  },
];
