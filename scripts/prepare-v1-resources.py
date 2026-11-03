#!/usr/bin/env python3
"""Prepare reviewed teaching assets from the supplied V1.0.zip; never execute its code.

Usage: python3 scripts/prepare-v1-resources.py /path/to/V1.0.zip
Original bytes are retained in <=40 MB parts. Reproduction bundles contain
only required inputs and separately adapted scripts. All outputs are deterministic.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import runpy
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web/public/resources/v1'
PREFIX = '/resources/v1/'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(name, data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    dest = OUT / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return {'url': PREFIX + name, 'bytes': len(data), 'sha256': sha(data)}


def package(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 2, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    return stream.getvalue()


R_INSTALL = '''# Run in R / RStudio. Installs only the declared packages and required dependencies.
packages <- c("Seurat", "ggplot2", "Matrix", "patchwork", "ggdendro", "viridisLite")
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly=TRUE)]
if (length(missing)) install.packages(missing, repos="https://cloud.r-project.org")
stopifnot(all(vapply(packages, requireNamespace, logical(1), quietly=TRUE)))
sessionInfo()
'''

PY_ENV = '''name: bioinfobuddy-st
channels:
  - conda-forge
  - nodefaults
dependencies:
  - python=3.12
  - scanpy=1.12.1
  - anndata
  - pandas
  - matplotlib
  - seaborn
  - numpy
  - pooch
  - scipy
  - python-igraph
  - leidenalg
  - h5py
'''

R_GUIDE = '''# 单细胞复现指南 · BioInfoBuddy V1.0 资料适配版

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
'''

PY_GUIDE = '''# 空间转录组复现指南 · BioInfoBuddy V1.0 资料适配版

本包按附件 GSE194329 / GBM1 目录标注，含脚本所需 H5 矩阵和 spatial/。
案例图为附件既有输出；本次未重新运行完整 Scanpy 流程，也未完成 Windows 真机复现。
数据来源标识沿用附件，未以 GEO 原下载哈希独立比对。不要把目录名扩展成患者临床结论。
molecule_info.h5 和 MTX 备份并非此脚本输入，完整原始资料仍包含它们。

## macOS 与 Windows：创建独立环境

从 https://www.anaconda.com/docs/getting-started/miniconda/install 安装对应平台与架构的 Miniconda。
macOS 在终端操作；Windows 在 Miniconda Prompt 操作。进入解压后的本包目录：

```sh
conda env create -f environment.yml
conda activate bioinfobuddy-st
python -c "import scanpy, anndata, pandas, matplotlib, seaborn, numpy, pooch, scipy, igraph, leidenalg, h5py; print(scanpy.__version__)"
python "st_scanpy.py" --data-dir "./GSE194329_RAW/GBM1_spaceranger_out" --output-dir "./results"
```

environment.yml 是环境定义，不是完整锁文件。仅固定 Python 3.12、Scanpy 1.12.1；其他依赖由求解器解析。
创建前确认该环境名未被使用；已有同名环境时先检查用途，不要删除它。
配置仅作用于此环境，不需要编辑全局 .condarc、删除配置文件或清理其他环境。
网络或依赖求解失败时保留错误信息并核对平台支持；下载环境定义不代表安装成功。

## 输入、阈值与输出

输入：filtered_feature_bc_matrix.h5、spatial/ 下组织图、位置与缩放比例文件。
单位为 spot，可能混合多个细胞。过滤：5000–35000 counts、线粒体比例 <20%、基因在至少10个 spot 检出。
流程：归一化、log1p、2000 HVG、PCA、邻居图、UMAP、Leiden、cluster marker t-test。
脚本保存 01–09 九张 PNG、runtime-versions.json、run-parameters.json；没有输出 h5ad 或条件差异表。
热图预设 cluster 2，空间基因为 COL1A2/SYPL1。换数据需修改并核对，缺失时明确报错，不静默替换。
不同版本可能改变聚类或图形；以本次结果与日志为准，不承诺像素级一致。

## 可选：Quarto 阅读报告

先按 https://quarto.org/docs/get-started/ 安装 Quarto，然后在上述已激活环境中执行：

```sh
conda install --override-channels -c conda-forge jupyter
quarto check jupyter
quarto render st_scanpy.qmd --to html
```

适配版 QMD 运行同目录 st_scanpy.py，读取其九张输出图组成 HTML；在本包目录运行，文件夹名不需要与原作者电脑相同。
输出写入 results，不覆盖随附件提供的示例图。

官方参考：https://scanpy.readthedocs.io/en/stable/installation.html
https://scanpy.readthedocs.io/en/stable/generated/scanpy.read_visium.html
https://pypi.org/project/scanpy/1.12.1/
https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html
https://quarto.org/docs/computations/python.html
'''

REASSEMBLE = '''#!/usr/bin/env python3
"""Put this script, archive-manifest.json and all .bin parts in one directory.
Run: python reassemble.py. Validates every part and the completed archive.
"""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "archive-manifest.json").read_text(encoding="utf-8"))
dest = root / "V1.0-original.zip"
temporary = root / "V1.0-original.zip.partial"
if dest.exists() or temporary.exists():
    raise SystemExit("Output already exists; move it aside before retrying.")
whole = hashlib.sha256()
try:
    with temporary.open("xb") as output:
        for item in manifest["parts"]:
            source = root / Path(item["url"]).name
            data = source.read_bytes()
            if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("Invalid or incomplete part: " + source.name)
            whole.update(data)
            output.write(data)
    if whole.hexdigest() != manifest["sha256"] or temporary.stat().st_size != manifest["bytes"]:
        raise ValueError("Archive checksum mismatch")
    temporary.rename(dest)
    print("Verified:", dest)
except BaseException:
    temporary.unlink(missing_ok=True)
    raise
'''


def revised_r(source):
    source = source.replace("suppressPackageStartupMessages({", '''required <- c("Seurat", "ggplot2", "Matrix", "patchwork", "ggdendro", "viridisLite")
missing <- required[!vapply(required, requireNamespace, logical(1), quietly=TRUE)]
if (length(missing)) stop("Missing packages: ", paste(missing, collapse=", "), "; see install.R")
suppressPackageStartupMessages({''', 1)
    source = source.replace("data_dir <- if (length(args) >= 1) args[1] else file.path('示例数据与代码', 'filtered_gene_bc_matrices', 'hg19')", '''script_arg <- grep("^--file=", commandArgs(trailingOnly=FALSE), value=TRUE)
script_dir <- if (length(script_arg)) dirname(normalizePath(sub("^--file=", "", script_arg[1]))) else getwd()
data_dir <- if (length(args) >= 1) args[1] else file.path(script_dir, 'filtered_gene_bc_matrices', 'hg19')''')
    source = source.replace("else '示例图'", "else file.path(script_dir, 'results')")
    source = source.replace("stopifnot(file.exists(file.path(data_dir, 'matrix.mtx')))", '''required_files <- file.path(data_dir, c("matrix.mtx", "genes.tsv", "barcodes.tsv"))
if (!all(file.exists(required_files))) stop("Missing 10x input: ", paste(required_files[!file.exists(required_files)], collapse=", "))''')
    # Keep an empty, typed data frame when no very small clusters exist.
    source = source.replace("p2 <- ggplot(plot_um", "if (is.null(small_outline)) small_outline <- data.frame(cluster=character(), x=numeric(), y=numeric())\np2 <- ggplot(plot_um")
    source += '\nwriteLines(capture.output(sessionInfo()), file.path(out_dir, "sessionInfo.txt"))\n'
    return source


def revised_python(source):
    source = source.replace("Path(__file__).resolve().parents[1] / '示例图'", "Path(__file__).resolve().parent / 'results'")
    source = source.replace('args.output_dir.mkdir(parents=True, exist_ok=True)', '''required = [args.data_dir / 'filtered_feature_bc_matrix.h5',
            args.data_dir / 'spatial/scalefactors_json.json',
            args.data_dir / 'spatial/tissue_hires_image.png',
            args.data_dir / 'spatial/tissue_lowres_image.png']
missing = [str(path) for path in required if not path.is_file()]
if not any((args.data_dir / 'spatial' / name).is_file() for name in ['tissue_positions_list.csv', 'tissue_positions.csv']):
    missing.append('spatial/tissue_positions_list.csv or tissue_positions.csv')
if missing:
    parser.error('Missing input: ' + ', '.join(missing))
args.output_dir.mkdir(parents=True, exist_ok=True)''')
    source = source.replace('#cells after MT filter:', '#spots after MT filter:')
    source = source.replace('sc.pl.rank_genes_groups_heatmap(', '''if "2" not in set(adata.obs["clusters"].astype(str)):
    raise ValueError("Example heatmap requires cluster 2; inspect clustering before changing the target.")
sc.pl.rank_genes_groups_heatmap(''')
    source = source.replace('# 可视化特定基因的空间分布', '''# 可视化特定基因的空间分布
missing_markers = [gene for gene in ["COL1A2", "SYPL1"] if gene not in adata.var_names]
if missing_markers:
    raise ValueError("Missing example markers: " + ", ".join(missing_markers))''')
    source += '''
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
'''
    return source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    archive = args.archive.read_bytes()
    original = {'name': 'V1.0-original.zip', 'bytes': len(archive), 'sha256': sha(archive), 'parts': []}
    for i, start in enumerate(range(0, len(archive), 40_000_000), 1):
        original['parts'].append(write(f'original/V1.0.zip.part{i:03d}.bin', archive[start:start+40_000_000]))
    write('original/archive-manifest.json', json.dumps(original, ensure_ascii=False, indent=2) + '\n')
    write('original/reassemble.py', REASSEMBLE)
    manifest = {'version': '1.0', 'original': original, 'files': [], 'packages': {}}
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        files = {n: z.read(n) for n in z.namelist() if not n.endswith('/')}
    for name, data in sorted(files.items()):
        manifest['files'].append({'source': name, 'bytes': len(data), 'sha256': sha(data), 'access': 'original'})
    single = 'V1.0/单细胞/'
    spatial = 'V1.0/空间转录组/'
    r = revised_r(files[single + '示例数据与代码/generate_four_plots.R'].decode('utf-8-sig'))
    py = revised_python(files[spatial + '示例数据与代码/st_scanpy.py'].decode('utf-8-sig'))
    qmd = '''---
title: "GBM1 空间转录组示例"
format: html
jupyter: python3
---

本报告在外部 Python 环境运行同目录适配脚本，使用附件示例参数；spot 不等于单细胞。

```{python}
from pathlib import Path
import subprocess
import sys
from IPython.display import Image, display
root = Path.cwd()
subprocess.run([sys.executable, str(root / "st_scanpy.py"), "--data-dir", str(root / "GSE194329_RAW/GBM1_spaceranger_out"), "--output-dir", str(root / "results")], check=True)
for path in sorted((root / "results").glob("[0-9][0-9]_*.png")):
    print(path.name)
    display(Image(filename=str(path)))
```
'''
    colors = files[single + '配色/colors.R'].decode('utf-8-sig').replace('colors_36 <-', 'colors_38 <-')
    colors += '\n# Compatibility alias: the supplied vector has 38 entries.\ncolors_36 <- colors_38\n'
    palettes = [re.findall(r'#[A-Fa-f0-9]{6}', chunk) for chunk in colors.split('colors_38 <-')[:2]]
    write('single-cell/palettes.json', json.dumps(palettes, indent=2) + '\n')
    (ROOT / 'web/src/data/omics-palettes.json').write_text(json.dumps(palettes, indent=2) + '\n')
    r_files = {'generate_four_plots.R': r, 'install.R': R_INSTALL, 'README.md': R_GUIDE, 'colors.R': colors,
               'supplied-marker-summary.csv': files[single + '示例数据与代码/marker_summary.csv']}
    py_files = {'st_scanpy.py': py, 'st_scanpy.qmd': qmd, 'environment.yml': PY_ENV, 'README.md': PY_GUIDE}
    # Browser table examples retain every source row; Visium's legacy positions file only needs a header.
    positions = files[spatial + '示例数据与代码/GSE194329_RAW/GBM1_spaceranger_out/spatial/tissue_positions_list.csv']
    write('spatial/supplied-tissue-positions.csv', positions)
    write('spatial/tissue-positions-with-header.csv',
          b'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres\n' + positions)
    for folder, entries in [('single-cell', r_files), ('spatial', py_files)]:
        for name, data in entries.items():
            write(folder + '/' + name, data)
    for source, data in files.items():
        if '/示例图/' in source and source.endswith('.png'):
            folder = 'single-cell' if source.startswith(single) else 'spatial'
            write(folder + '/figures/' + Path(source).name, data)
        if source.startswith(single + '示例数据与代码/filtered_gene_bc_matrices/'):
            r_files[source.removeprefix(single + '示例数据与代码/')] = data
        spatial_input = spatial + '示例数据与代码/GSE194329_RAW/GBM1_spaceranger_out/'
        if source.startswith(spatial_input) and (source.endswith('/filtered_feature_bc_matrix.h5') or '/spatial/' in source):
            py_files[source.removeprefix(spatial + '示例数据与代码/')] = data
    manifest['packages']['single-cell'] = write('single-cell-reproduction.zip', package(r_files))
    manifest['packages']['spatial'] = write('spatial-reproduction.zip', package(py_files))
    prepare_guides = runpy.run_path(str(ROOT / 'scripts/prepare-omics-guides.py'))['prepare_guides']
    manifest['packages']['guides'] = prepare_guides()
    write('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'web/src/data/omics-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'source_files': len(files), 'original_bytes': len(archive), 'parts': len(original['parts']), 'package_bytes': {k: v['bytes'] for k, v in manifest['packages'].items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
