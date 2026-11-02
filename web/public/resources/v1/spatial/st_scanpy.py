import matplotlib
matplotlib.use('Agg')
#| label: load-packages
#| include: false
import os
import scanpy as sc
import anndata as ad
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import pooch
from scipy.sparse import csr_matrix
from scipy.io import mmwrite


from pathlib import Path
import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parent / 'GSE194329_RAW' / 'GBM1_spaceranger_out')
parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parent / 'results')
args = parser.parse_args()
required = [args.data_dir / 'filtered_feature_bc_matrix.h5',
            args.data_dir / 'spatial/scalefactors_json.json',
            args.data_dir / 'spatial/tissue_hires_image.png',
            args.data_dir / 'spatial/tissue_lowres_image.png']
missing = [str(path) for path in required if not path.is_file()]
if not any((args.data_dir / 'spatial' / name).is_file() for name in ['tissue_positions_list.csv', 'tissue_positions.csv']):
    missing.append('spatial/tissue_positions_list.csv or tissue_positions.csv')
if missing:
    parser.error('Missing input: ' + ', '.join(missing))
args.output_dir.mkdir(parents=True, exist_ok=True)
sc.settings.autoshow = False
def save_plot(name):
    plt.gcf().savefig(args.output_dir / (name + '.png'), dpi=200, bbox_inches='tight', facecolor='white')
    plt.close('all')
    print('Saved:', name, flush=True)

sc.logging.print_versions()
sc.set_figure_params(facecolor="white", figsize=(8, 8))
sc.settings.verbosity = 3


# 读取数据
adata = sc.read_visium(args.data_dir)

# 使基因名唯一
adata.var_names_make_unique()

# 标记线粒体基因
adata.var["mt"] = adata.var_names.str.startswith("MT-")
sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], inplace=True)

# 可视化质量控制指标
fig, axs = plt.subplots(1, 4, figsize=(15, 4))
sns.histplot(adata.obs["total_counts"], kde=False, ax=axs[0])
sns.histplot(
    adata.obs["total_counts"][adata.obs["total_counts"] < 10000],
    kde=False,
    bins=40,
    ax=axs[1],
)
sns.histplot(adata.obs["n_genes_by_counts"], kde=False, bins=60, ax=axs[2])
sns.histplot(
    adata.obs["n_genes_by_counts"][adata.obs["n_genes_by_counts"] < 4000],
    kde=False,
    bins=60,
    ax=axs[3],
)

save_plot('01_QC_histograms')

# 过滤细胞和基因
sc.pp.filter_cells(adata, min_counts=5000)
sc.pp.filter_cells(adata, max_counts=35000)
adata = adata[adata.obs["pct_counts_mt"] < 20].copy()
print(f"#spots after MT filter: {adata.n_obs}")

sc.pp.filter_genes(adata, min_cells=10)

# 预处理，不需要scaledata
sc.pp.normalize_total(adata, inplace=True)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, flavor="seurat", n_top_genes=2000)
sc.pp.pca(adata)
sc.pp.neighbors(adata)
sc.tl.umap(adata)
sc.tl.leiden(adata, key_added="clusters")

# 可视化UMAP
plt.rcParams["figure.figsize"] = (4, 4)
sc.pl.umap(adata, color=["total_counts"], wspace=0.4)
save_plot('02_UMAP_total_counts')
sc.pl.umap(adata, color=["n_genes_by_counts"], wspace=0.4)
save_plot('03_UMAP_n_genes_by_counts')
sc.pl.umap(adata, color=["clusters"], wspace=0.4)
save_plot('04_UMAP_clusters')

# 可视化空间分布
plt.rcParams["figure.figsize"] = (8, 8)
sc.pl.spatial(adata,img_key="hires",color=["total_counts"])
save_plot('05_spatial_total_counts')
sc.pl.spatial(adata,img_key="hires",color=["n_genes_by_counts"])
save_plot('06_spatial_n_genes_by_counts')
sc.pl.spatial(adata,img_key="hires",color="clusters",size=1.5)
save_plot('07_spatial_clusters')

# 差异表达分析
sc.tl.rank_genes_groups(adata, "clusters", method="t-test")
if "2" not in set(adata.obs["clusters"].astype(str)):
    raise ValueError("Example heatmap requires cluster 2; inspect clustering before changing the target.")
sc.pl.rank_genes_groups_heatmap(
    adata,
    groups="2",
    n_genes=10,
    groupby="clusters"
)

save_plot('08_marker_heatmap_cluster2')

# 可视化特定基因的空间分布
missing_markers = [gene for gene in ["COL1A2", "SYPL1"] if gene not in adata.var_names]
if missing_markers:
    raise ValueError("Missing example markers: " + ", ".join(missing_markers))
sc.pl.spatial(
    adata,
    img_key="hires",
    color=["COL1A2", "SYPL1"],
    alpha=0.7
)

#print(os.getcwd())
#adata.write("GSE194329.data.anndata.h5ad")
save_plot('09_spatial_COL1A2_SYPL1')

import json
import platform
from importlib.metadata import version
versions = {name: version(name) for name in ["scanpy", "anndata", "numpy", "scipy", "matplotlib", "igraph", "leidenalg"]}
versions["python"] = platform.python_version()
(args.output_dir / "runtime-versions.json").write_text(json.dumps(versions, indent=2), encoding="utf-8")
(args.output_dir / "run-parameters.json").write_text(json.dumps({
    "data_dir": str(args.data_dir.resolve()), "unit": "spot", "min_counts": 5000, "max_counts": 35000,
    "pct_counts_mt_lt": 20, "min_cells_per_gene": 10, "highly_variable_genes": 2000,
    "marker_test": "t-test", "heatmap_cluster": "2", "spatial_markers": ["COL1A2", "SYPL1"],
    "pca": adata.uns.get("pca", {}).get("params", {}),
    "neighbors": adata.uns.get("neighbors", {}).get("params", {}),
    "leiden": adata.uns.get("clusters", {}).get("params", {}),
    "note": "Other options follow the recorded Scanpy version defaults; this is an exploratory single-section example."
}, indent=2, default=str), encoding="utf-8")
