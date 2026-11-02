# 空间转录组复现指南 · BioInfoBuddy V1.0 资料适配版

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
