# 单细胞复现指南 · BioInfoBuddy V1.0 资料适配版

## 内容与验证范围

本包包含附件 PBMC2700 的三件套矩阵、修订脚本、配色和既有 marker 汇总。
示例原图由网站案例页与完整原始资料提供。脚本在外部 R 环境运行，网页不执行 R。
原矩阵为 32,738 genes × 2,700 cells；原附件记录质控后 2,638 cells。
没有样本分组标签；marker_summary.csv 不是差异检验结果，没有 P 值。
本次只验证资源完整性与脚本静态检查，未完成 macOS / Windows 全流程重跑。

## macOS

1. 从 https://cran.r-project.org/ 安装适合机器架构的 R，可选安装 RStudio。
2. 解压本包，在 R / RStudio 切换到本包目录，执行 source("install.R")。
3. 终端进入本包目录，执行下面的 Rscript 命令。若 Rscript 不在 PATH，用 R 安装位置的完整路径。

## Windows

1. 从 https://cran.r-project.org/ 安装 Windows R，可选安装 RStudio。
2. 在 R / RStudio 切换到本包目录，执行 source("install.R")。
3. PowerShell 进入本包目录运行下面命令。若找不到 Rscript，用实际 R 版本目录中的 Rscript.exe 完整路径（PowerShell 用 & 调用带引号路径）。
4. 优先使用官方提供的二进制包；仅当需要编译源码时按 R 官方说明安装匹配版本 Rtools。

```sh
Rscript "generate_four_plots.R" "./filtered_gene_bc_matrices/hg19" "./results"
```

也可在 R 中调用 system2(file.path(R.home("bin"), "Rscript"), "generate_four_plots.R")，默认读取脚本旁矩阵并输出到 results。

## 输出与读图

生成 01_QC_violin.png、02_UMAP_clusters.png、03_marker_dotplot.png、04_marker_featureplot.png、marker_summary.csv、分析说明.txt 和 sessionInfo.txt。
QC 阈值：nFeature_RNA > 200 且 < 2500、percent.mt < 5、nCount_RNA < 10000。
UMAP 使用 dims 1:20，聚类 resolution=0.5。随机种子 20261102。
灰色椭圆/小群包络不是生物学边界；marker 组合名称不是最终注释。
FeaturePlot 按每个基因的阳性表达第 99 百分位缩放，不能跨基因直接比较颜色强弱。

## 文件说明

- generate_four_plots.R：修正默认路径、依赖/输入检查，保留原分析阈值，增加实际版本记录。
- colors.R：保留原 20 色向量；原 colors_36 实际含 38 色，修订为 colors_38，同时保留兼容别名 colors_36。
- supplied-marker-summary.csv：附件既有汇总，和本次运行结果分开保存。
- 原 Mac Conda 包清单与 Windows R 基础环境未覆盖全部分析依赖，仅在完整原始资料中作为历史文件保留。

官方参考：https://satijalab.org/seurat/articles/install_v5.html
https://satijalab.org/seurat/reference/read10x
https://stat.ethz.ch/R-manual/R-devel/library/utils/html/Rscript.html
