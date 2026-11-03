export type V1ExampleId = 'pbmc-markers' | 'gbm1-positions';

export interface V1Example {
  id: V1ExampleId;
  caseId: 'single-cell' | 'spatial';
  label: string;
  description: string;
  sourceNote: string;
  suggestedFields: string;
  previewImage: string;
  url: string;
  filename: string;
  rows: number;
  columns: readonly string[];
  bytes: number;
  sha256: string;
  sourcePath: string;
}

// These are supplied V1.0 tables, not generated data or a rerun of the source analyses.
export const v1Examples: readonly V1Example[] = [
  {
    id: 'pbmc-markers', caseId: 'single-cell', label: 'PBMC2700 · Marker 汇总',
    description: '按细胞簇和基因查看表达比例、平均表达量，使用附件已有汇总表练习绘图。',
    sourceNote: '243 行，保持附件原始数值；这是 marker 汇总，不是差异检验结果。',
    suggestedFields: '数值：pct、avg；分组：cluster、gene、marker_group。',
    previewImage: '/resources/v1/single-cell/figures/03_marker_dotplot.png',
    url: '/resources/v1/single-cell/supplied-marker-summary.csv',
    filename: 'V1.0-PBMC2700-marker-summary.csv',
    rows: 243, columns: ['cluster', 'gene', 'pct', 'avg', 'marker_group'], bytes: 13554,
    sha256: '5a8a58c1cef2bf23f781854233c9350fd0f3439c525ca4af0775f5db12a7b654',
    sourcePath: 'V1.0/单细胞/示例数据与代码/marker_summary.csv',
  },
  {
    id: 'gbm1-positions', caseId: 'spatial', label: 'GBM1 · 空间点位',
    description: '查看空间点位的阵列坐标、图像坐标和组织内标记，选择坐标字段绘制散点图。',
    sourceNote: '4,992 行，仅为附件无表头文件补充列名；保留组织内外全部点位，不含表达矩阵。',
    suggestedFields: '坐标：array_col / array_row 或 pxl_col_in_fullres / pxl_row_in_fullres；组织标记：in_tissue。',
    previewImage: '/resources/v1/spatial/figures/07_spatial_clusters.png',
    url: '/resources/v1/spatial/tissue-positions-with-header.csv',
    filename: 'V1.0-GBM1-tissue-positions.csv',
    rows: 4992, columns: ['barcode', 'in_tissue', 'array_row', 'array_col', 'pxl_row_in_fullres', 'pxl_col_in_fullres'], bytes: 191371,
    sha256: '28cc399378ac1f6236ea8e37e48693a871570303e71e91fe219ec3e66f73cd23',
    sourcePath: 'V1.0/空间转录组/示例数据与代码/GSE194329_RAW/GBM1_spaceranger_out/spatial/tissue_positions_list.csv',
  },
];

export async function fetchV1Example(id: V1ExampleId, signal?: AbortSignal, request: typeof fetch = fetch): Promise<File> {
  const example = v1Examples.find(item => item.id === id);
  if (!example) throw new Error('未找到该 V1.0 样例。');
  const response = await request(example.url, { signal });
  if (!response.ok) throw new Error(`样例文件暂时无法读取（${response.status}），请稍后重试。`);
  const bytes = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== example.bytes || hash !== example.sha256) throw new Error('样例文件校验失败，请刷新页面后重试。');
  return new File([bytes], example.filename, { type: 'text/csv' });
}
