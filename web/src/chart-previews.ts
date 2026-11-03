import type { ChartKind } from './types';

export interface ChartPreviewSource {
  url: string;
  alt: string;
  caption: string;
  sourcePath: string;
}

// Only original figures supplied in V1.0 are used. Missing types stay explicit.
export const chartPreviews: Record<ChartKind, ChartPreviewSource | null> = {
  box: null,
  violin: {
    url: '/resources/v1/single-cell/figures/01_QC_violin.png',
    alt: 'V1.0 原图：PBMC 单细胞基因数、计数和线粒体比例的小提琴图',
    caption: '附件质控小提琴图',
    sourcePath: 'V1.0/单细胞/示例图/01_QC_violin.png',
  },
  scatter: {
    url: '/resources/v1/single-cell/figures/02_UMAP_clusters.png',
    alt: 'V1.0 原图：按 cluster 着色的 PBMC UMAP 散点图；不是本次表格的分析结果',
    caption: '附件 UMAP 散点示例',
    sourcePath: 'V1.0/单细胞/示例图/02_UMAP_clusters.png',
  },
  histogram: {
    url: '/resources/v1/spatial/figures/01_QC_histograms.png',
    alt: 'V1.0 原图：GBM1 空间转录组总计数和检出基因数的直方图',
    caption: '附件质控直方图',
    sourcePath: 'V1.0/空间转录组/示例图/01_QC_histograms.png',
  },
  bar: null,
  heatmap: {
    url: '/resources/v1/spatial/figures/08_marker_heatmap_cluster2.png',
    alt: 'V1.0 原图：GBM1 cluster 2 marker 热图',
    caption: '附件 marker 热图',
    sourcePath: 'V1.0/空间转录组/示例图/08_marker_heatmap_cluster2.png',
  },
};
