# Requires: Seurat, ggplot2, Matrix, patchwork, ggdendro, viridisLite.
# Example: Rscript generate_four_plots.R <hg19_data_dir> <output_dir>
required <- c("Seurat", "ggplot2", "Matrix", "patchwork", "ggdendro", "viridisLite")
missing <- required[!vapply(required, requireNamespace, logical(1), quietly=TRUE)]
if (length(missing)) stop("Missing packages: ", paste(missing, collapse=", "), "; see install.R")
suppressPackageStartupMessages({
  library(Seurat)
  library(ggplot2)
  library(Matrix)
  library(patchwork)
})
set.seed(20261102)
args <- commandArgs(trailingOnly = TRUE)
script_arg <- grep("^--file=", commandArgs(trailingOnly=FALSE), value=TRUE)
script_dir <- if (length(script_arg)) dirname(normalizePath(sub("^--file=", "", script_arg[1]))) else getwd()
data_dir <- if (length(args) >= 1) args[1] else file.path(script_dir, 'filtered_gene_bc_matrices', 'hg19')
out_dir <- if (length(args) >= 2) args[2] else file.path(script_dir, 'results')
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
required_files <- file.path(data_dir, c("matrix.mtx", "genes.tsv", "barcodes.tsv"))
if (!all(file.exists(required_files))) stop("Missing 10x input: ", paste(required_files[!file.exists(required_files)], collapse=", "))
counts <- Read10X(data.dir = data_dir)
seu <- CreateSeuratObject(counts = counts, min.cells = 3, min.features = 200, project = 'PBMC2700')
seu[['percent.mt']] <- PercentageFeatureSet(seu, pattern = '^MT-')

# 01: original cells; only one source sample, so do not invent sample groups.
metrics <- c('nFeature_RNA', 'nCount_RNA', 'percent.mt')
qc <- seu@meta.data[, metrics]
qc$Group <- 'All cells'
long <- data.frame(
  Group = rep(qc$Group, times=length(metrics)),
  Metric = rep(metrics, each=nrow(qc)),
  value = unlist(qc[metrics], use.names=FALSE)
)
long$Metric <- factor(long$Metric, levels=metrics)
med <- aggregate(value ~ Metric + Group, long, median)
med$label <- ifelse(med$Metric == 'percent.mt', sprintf('%.2f', med$value), sprintf('%.0f', med$value))
p1 <- ggplot(long, aes(Group, value)) +
  geom_violin(fill='#829473', color='#5E7156', width=.80, linewidth=.5, trim=FALSE) +
  geom_point(data=med, aes(x=Group, y=value), inherit.aes=FALSE, color='black', size=2.5) +
  geom_text(data=med, aes(x=Group, y=value, label=label), inherit.aes=FALSE,
            color='black', fontface='bold', size=4.8, vjust=-.8) +
  facet_wrap(~Metric, scales='free_y', nrow=1) +
  scale_y_continuous(expand=expansion(mult=c(0,.10))) +
  labs(title=NULL, subtitle=NULL, x=NULL, y=NULL) +
  theme_classic(base_size=15) +
  theme(strip.background=element_blank(), strip.text=element_text(size=17,face='bold'),
        plot.title=element_text(face='bold'), axis.text.x=element_text(face='bold'),
        axis.line=element_line(linewidth=.8), axis.ticks=element_line(linewidth=.7))
ggsave(file.path(out_dir,'01_QC_violin.png'), p1, width=12, height=5, dpi=220, bg='white')

# Standard Seurat preprocessing, with explicit thresholds for reproducibility.
seu <- subset(seu, subset=nFeature_RNA > 200 & nFeature_RNA < 2500 & percent.mt < 5 & nCount_RNA < 10000)
seu <- NormalizeData(seu, verbose=FALSE)
seu <- FindVariableFeatures(seu, selection.method='vst', nfeatures=2000, verbose=FALSE)
seu <- ScaleData(seu, features=VariableFeatures(seu), verbose=FALSE)
seu <- RunPCA(seu, features=VariableFeatures(seu), npcs=30, verbose=FALSE)
seu <- FindNeighbors(seu, dims=1:20, verbose=FALSE)
seu <- FindClusters(seu, resolution=.5, verbose=FALSE)
seu <- RunUMAP(seu, dims=1:20, seed.use=20261102, verbose=FALSE)
cat('Cells after filtering:', ncol(seu), '\n')
cat('Clusters:', paste(levels(Idents(seu)), collapse=', '), '\n')

# Marker groups follow the supplied PBMC example; missing genes are omitted.
marker_groups <- list(
  'Naive CD4 T'=c('LDHB','CCR7','LEF1'),
  'CD14+ Mono'=c('S100A9','S100A8','LYZ'),
  'Memory CD4 T'=c('LTB','CD2','AQP3'),
  'B cells'=c('CD79A','CD79B','TCL1A'),
  'CD8 T'=c('CCL5','GZMK','GZMH'),
  'FCGR3A+ Mono'=c('FCGR3A','LST1','FCER1G'),
  'NK cells'=c('GZMB','FGFBP2','GNLY'),
  'Dendritic'=c('FCER1A','HLA-DQA1','HLA-DPB1'),
  'Platelets'=c('PF4','GNG11','PPBP')
)
marker_groups <- lapply(marker_groups, function(z) z[z %in% rownames(seu)])
marker_groups <- marker_groups[lengths(marker_groups)>0]
markers <- unlist(marker_groups, use.names=FALSE)
feature_genes <- c('CD3D','MS4A1','NKG7','LYZ','FCER1A','PPBP')
feature_genes <- feature_genes[feature_genes %in% rownames(seu)]
cluster_id <- as.character(Idents(seu))
expr <- FetchData(seu, vars=unique(c(markers, feature_genes)))
summary <- do.call(rbind, lapply(sort(unique(cluster_id)), function(cluster) {
  z <- expr[cluster_id == cluster, markers, drop=FALSE]
  data.frame(cluster=cluster, gene=markers,
             pct=colMeans(z > 0)*100,
             avg=colMeans(z), row.names=NULL)
}))
summary$marker_group <- rep(names(marker_groups), lengths(marker_groups))[match(summary$gene, markers)]
write.csv(summary, file.path(out_dir,'marker_summary.csv'), row.names=FALSE)

# 02: cluster labels are algorithmic, not manually validated cell types.
um <- as.data.frame(Embeddings(seu, 'umap'))
colnames(um)[1:2] <- c('UMAP_1', 'UMAP_2')
um$cluster <- factor(cluster_id, levels=sort(unique(cluster_id)))
set.seed(20261102)
plot_um <- um[sample.int(nrow(um)),]
xr <- diff(range(um$UMAP_1)); yr <- diff(range(um$UMAP_2))
x0 <- min(um$UMAP_1) - .11*xr
y0 <- min(um$UMAP_2) - .14*yr
cluster_colors <- c('#F8766D','#D9A400','#56B91F','#00BE9C','#00A9E0',
                    '#9B83E9','#F04AB3','#7D6AB0','#636363')
# Very small clusters can lack enough points for stat_ellipse; draw a padded envelope.
small <- Filter(function(z) nrow(z) < 40, split(um, um$cluster))
small_outline <- do.call(rbind, lapply(names(small), function(k) {
  z <- small[[k]]
  theta <- seq(0, 2*pi, length.out=120)
  cx <- mean(range(z$UMAP_1)); cy <- mean(range(z$UMAP_2))
  rx <- max(diff(range(z$UMAP_1))*.70, .025*xr)
  ry <- max(diff(range(z$UMAP_2))*.70, .025*yr)
  data.frame(cluster=k, x=cx+rx*cos(theta), y=cy+ry*sin(theta))
}))
if (is.null(small_outline)) small_outline <- data.frame(cluster=character(), x=numeric(), y=numeric())
p2 <- ggplot(plot_um, aes(UMAP_1, UMAP_2, color=cluster)) +
  stat_ellipse(aes(group=cluster), level=.98, geom='polygon', fill='#B5B5B5', alpha=.10, color=NA, show.legend=FALSE) +
  stat_ellipse(aes(group=cluster), level=.98, color='#777777', linetype='dashed', linewidth=.55, show.legend=FALSE) +
  geom_polygon(data=small_outline, aes(x=x, y=y, group=cluster), inherit.aes=FALSE,
               fill='#B5B5B5', alpha=.10, color=NA) +
  geom_path(data=small_outline, aes(x=x, y=y, group=cluster), inherit.aes=FALSE,
            color='#777777', linetype='dashed', linewidth=.55) +
  geom_point(size=.70, alpha=.85) +
  scale_color_manual(values=cluster_colors) +
  annotate('segment', x=x0, xend=x0+.15*xr, y=y0, yend=y0,
           linewidth=.7, arrow=grid::arrow(type='closed', length=grid::unit(2.3,'mm'))) +
  annotate('segment', x=x0, xend=x0, y=y0, yend=y0+.15*yr,
           linewidth=.7, arrow=grid::arrow(type='closed', length=grid::unit(2.3,'mm'))) +
  annotate('text', x=x0+.09*xr, y=y0-.035*yr, label='UMAP1', size=4.2, fontface='italic') +
  annotate('text', x=x0-.035*xr, y=y0+.09*yr, label='UMAP2', size=4.2, fontface='italic', angle=90) +
  coord_equal(xlim=c(x0-.07*xr, max(um$UMAP_1)+.04*xr),
              ylim=c(y0-.07*yr, max(um$UMAP_2)+.04*yr), expand=FALSE) +
  labs(title=NULL, subtitle=NULL, color='seurat_clusters') +
  theme_void(base_size=14) +
  theme(plot.title=element_text(face='bold'), panel.border=element_rect(color='#666666', fill=NA, linewidth=.55),
        legend.title=element_text(face='bold'), legend.position='right',
        plot.margin=margin(12,12,12,12))
ggsave(file.path(out_dir,'02_UMAP_clusters.png'), p2, width=9, height=7.5, dpi=220, bg='white')

# 03: dot size is fraction expressing; color is mean log-normalized expression.
cluster_levels <- sort(unique(summary$cluster))
mat <- matrix(NA_real_, nrow=length(cluster_levels), ncol=length(markers),
              dimnames=list(cluster_levels, markers))
for (i in seq_len(nrow(summary))) mat[summary$cluster[i], summary$gene[i]] <- summary$avg[i]
scaled <- scale(mat)
scaled[, !is.finite(colSums(scaled))] <- 0
hc <- hclust(dist(scaled), method='average')
cluster_order <- hc$labels[hc$order]
summary$cluster <- factor(summary$cluster, levels=rev(cluster_order))
summary$gene <- factor(summary$gene, levels=markers)
ng <- length(cluster_order)
starts <- cumsum(c(1, head(lengths(marker_groups), -1)))
ends <- cumsum(lengths(marker_groups))
brackets <- data.frame(group=names(marker_groups), start=starts, end=ends,
                       mid=(starts+ends)/2)
p_dots <- ggplot(summary, aes(gene, cluster)) +
  geom_point(aes(size=pct, fill=avg), shape=21, color='#8A8A8A', stroke=.28) +
  geom_segment(data=brackets, aes(x=start, xend=end, y=ng+.65, yend=ng+.65),
               inherit.aes=FALSE, linewidth=.45) +
  geom_segment(data=brackets, aes(x=start, xend=start, y=ng+.65, yend=ng+.45),
               inherit.aes=FALSE, linewidth=.45) +
  geom_segment(data=brackets, aes(x=end, xend=end, y=ng+.65, yend=ng+.45),
               inherit.aes=FALSE, linewidth=.45) +
  geom_text(data=brackets, aes(x=mid, y=ng+.95, label=group),
            inherit.aes=FALSE, angle=90, hjust=0, size=3.5) +
  scale_size_continuous(name='Fraction of cells (%)', range=c(.3,7.5),
                        limits=c(0,100), breaks=c(0,25,50,75,100)) +
  scale_fill_gradient(low='white', high='#A30000', name='Mean expression
in cluster') +
  scale_x_discrete(expand=expansion(add=.5)) +
  scale_y_discrete(expand=expansion(add=c(.45,4.2))) +
  labs(title=NULL, subtitle=NULL, x=NULL, y='Cluster') +
  theme_bw(base_size=12) +
  theme(axis.text.x=element_text(angle=90, hjust=1, vjust=.5, size=10),
        panel.grid.major=element_line(color='#EDEDED'), panel.grid.minor=element_blank(),
        plot.title=element_text(face='bold'), panel.border=element_rect(color='#777777'))
seg <- ggdendro::segment(ggdendro::dendro_data(hc, type='rectangle'))
p_tree <- ggplot(seg, aes(x=y, y=ng+1-x, xend=yend, yend=ng+1-xend)) +
  geom_segment(linewidth=.45, color='#6D6D6D') +
  coord_cartesian(xlim=c(0,max(seg$y)*1.05), ylim=c(.5,ng+4.7), expand=FALSE) +
  theme_void()
p3 <- p_dots + p_tree + plot_layout(widths=c(1,.11), guides='collect') & theme(legend.position='right')
ggsave(file.path(out_dir,'03_marker_dotplot.png'), p3, width=17, height=9, dpi=220, bg='white')

# 04: representative markers; use the same UMAP coordinates in every panel.
feature_data <- do.call(rbind, lapply(feature_genes, function(g) {
  values <- expr[[g]]
  cap <- as.numeric(quantile(values[values > 0], .99, na.rm=TRUE))
  data.frame(UMAP_1=um$UMAP_1, UMAP_2=um$UMAP_2,
             gene=g, intensity=pmin(values / cap, 1))
}))
feature_data <- feature_data[feature_data$intensity > 0,]
feature_data$gene <- factor(feature_data$gene, levels=feature_genes)
background <- do.call(rbind, lapply(feature_genes, function(g) {
  data.frame(UMAP_1=um$UMAP_1, UMAP_2=um$UMAP_2, gene=g)
}))
background$gene <- factor(background$gene, levels=feature_genes)
p4 <- ggplot() +
  geom_point(data=background, aes(UMAP_1, UMAP_2), color='#E5E5E5', size=.25) +
  geom_point(data=feature_data, aes(UMAP_1, UMAP_2, color=intensity), size=.32, alpha=.95) +
  scale_color_gradientn(colors=viridisLite::viridis(100, option='C', direction=-1),
                        limits=c(0,1), name='Relative\nexpression') +
  facet_wrap(~gene, ncol=3) + coord_equal() +
  labs(title=NULL, subtitle=NULL, x='UMAP 1', y='UMAP 2') +
  theme_classic(base_size=12) +
  theme(plot.title=element_text(face='bold'), strip.text=element_text(face='bold'),
        strip.background=element_rect(fill='#E8EFF3', color=NA))
ggsave(file.path(out_dir,'04_marker_featureplot.png'), p4, width=12, height=8, dpi=220, bg='white')
writeLines(c(
  paste('输入细胞数：', ncol(counts)),
  paste('质控后细胞数：', ncol(seu)),
  paste('基因数：', nrow(seu)),
  paste('聚类编号：', paste(levels(Idents(seu)), collapse=', ')),
  'QC 阈值：nFeature_RNA > 200、< 2500；percent.mt < 5；nCount_RNA < 10000。',
  '原矩阵没有样本分组标签，QC 只绘制 All cells。',
  'UMAP 灰色虚线为 98% 数据椭圆；极小聚类使用留白包络圈，均不代表生物边界。',
  'DotPlot 上方名称为 marker 组合，聚类编号尚未作人工细胞类型注释。',
  '四张图均无顶部主标题和副标题。'
), file.path(out_dir,'分析说明.txt'))

writeLines(capture.output(sessionInfo()), file.path(out_dir, "sessionInfo.txt"))
