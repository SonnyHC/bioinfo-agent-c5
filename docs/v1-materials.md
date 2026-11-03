# V1.0 教学资料接入

> 教程已于 2026-11-03 按四份用户 Markdown 原文重新整理，当前布局、合并拆分、下载包和生成方式以 [四篇组学教程](tutorial-reading.md) 为准。下文保留 V1.0 接入时的过程记录。

本轮按用户确认的范围，将附件资料接入现有 BioInfoBuddy 网页：教程、示例结果、代码、环境指南和全部原始数据下载。没有新增在线原始组学计算后端，也没有恢复本机助手。

## 对应位置

| 附件内容 | 网页入口 | 实现 / 资源位置 |
| --- | --- | --- |
| 四篇教程 | 使用教程 → 四篇组学专题；案例与图表 → 专题教程 | `web/src/data/omics-guides.json`、`OmicsGuides.tsx`、`web/public/resources/v1/guides/` |
| 教程截图备注 | 每篇相关步骤的真实页面截图；全部教程截图 ZIP | `web/public/resources/v1/guides/screenshots/`、`guides-reproduction.zip` |
| PBMC 四图与说明 | 案例与图表 → 单细胞 | `omics-content.ts`、`resources/v1/single-cell/figures/` |
| Visium 九图 | 案例与图表 → 空间转录组 | `resources/v1/spatial/figures/` |
| R / Python / QMD | 各案例下载区，单独文件和复现 ZIP | `resources/v1/single-cell/`、`resources/v1/spatial/` |
| Mac / Windows 环境材料 | 案例环境步骤与包内 README；原件保留在完整原始包 | `install.R`、`environment.yml`、两个 README.md |
| marker_summary.csv | 单细胞 → 附件 marker 汇总 | `supplied-marker-summary.csv` |
| colors.R | 单细胞 → 附带配色，20 / 38 色预览与下载 | `single-cell/colors.R`、`omics-palettes.json` |
| 全部原始矩阵 / H5 / 图片 / 配置 | 完整原始资料 → 自动合并或分别下载 | `resources/v1/original/` |
| AI 方法指导 | 数据分析技能 → 单细胞指导 / 空间组学指导 | `skill-catalog.ts`，新增 5 项，共 10 项 |

## 样例与绘图入口更新

侧边栏“案例与图表”直接显示附件案例与图表，已移除手动“表格绘图”模块。主页面样例按钮让用户选择 V1.0 中的真实表格并载入 AI 对话，或直接查看完整案例；不再自动载入合成分组实验。已有运行记录只读保留，可查看和下载旧结果。

- PBMC marker 汇总来自附件 `marker_summary.csv`，没有病例／对照标签，也没有统计检验 P 值。
- GBM1 空间点位来自附件 `tissue_positions_list.csv`；导入版仅补充标准字段名，点位坐标不是表达矩阵或细胞类型标签。
- 案例展示使用附件原图；不将附件图片或加载表格称为新生成的绘图结果。新增绘图与计算需在外部环境运行。
- 浏览案例和载入表格都不执行 Seurat／Scanpy。原始矩阵、已有图片和外部复现代码仍按原用途提供。

教程页面已移除合成表格截图，保留的历史界面截图明确标注版本。更新教程与截图后，需同步教程 ZIP 和 manifest 中的包大小、SHA-256。

## 原始资料与修订版

原 ZIP 字节完整保留，大小 279,982,925 bytes，SHA-256：

```text
4937a8d4d8fe86212753fbc2c74210e8b534368cf54ae51b3700c423b104fc83
```

七个分包每个不超过 40,000,000 bytes，不存在超过 100 MB 的单个仓库文件。网页按顺序读取并逐份校验，成功后生成 ZIP 下载。下载中可取消；错误、截断、超长或校验不符的分包不会生成下载文件。手动合并脚本还会复核整体 SHA-256，并拒绝覆盖已有输出。

`manifest.json` 记录 44 个源文件的路径、字节数和 SHA-256，以及复现包的哈希。13 张示例图逐字节保持原样。案例输入矩阵也保持原字节。原作者的环境清单和路径仅随原始包保留，网页优先提供适配版。

修订版做了这些适配：

- R 脚本以自身位置定位数据，输出到独立 results；添加实际依赖和输入检查、无小群时的空数据保护、sessionInfo.txt。
- 补齐 Seurat、ggplot2、Matrix、patchwork、ggdendro、viridisLite 安装说明；采用 CRAN R 路线，旧 Conda 清单不称完整锁环境。
- Python 保留原过滤与分析流程；增加输入、cluster 2 / marker 存在性检查，以及实际版本和参数记录。
- QMD 改为调用同目录适配 Python 脚本，再嵌入九图，不再依赖原作者电脑的绝对路径；Quarto / Jupyter 为可选额外依赖。
- Python 环境用单独的 conda-forge / nodefaults YAML，固定 Python 3.12 和 Scanpy 1.12.1，不改全局 `.condarc`。它是环境定义，并非全部依赖锁文件。
- 配色原名 colors_36 实际有 38 色；适配版命名 colors_38，保留原兼容别名。
- 四篇教程删除其他平台按钮和已实现能力的误述，修正注释、统计检验、伪重复及富集解释的边界，保留官方参考链接。

## 维护与部署

从完整的原附件重新生成：

```sh
python3 scripts/prepare-v1-resources.py "/path/to/V1.0.zip"
npm run typecheck
npm run test:cloud
npm run build
```

原附件不需要写入仓库；生成的静态分包与复现 ZIP 需要一同部署。`.gitignore` 专门允许 `web/public/resources/v1/*-reproduction.zip`，避免下载包在提交时丢失。网站静态资源总增量约 345 MB，包括原包、两个必需输入复现包、图片与教程截图；访问首页不会自动下载这些大包。

页面截图必须来自本版实际 UI，保存在 `guides/screenshots/`；更新截图后重新执行资源脚本，才能同步教程 ZIP 和 manifest。图文包中的 Markdown 使用包内相对截图路径。

以上原始资料接入的验证记录不代表当前版本已经发布。现有 Vercel 配置复制这些静态资源；正式部署的传输限额、配额及远端下载状态需要在发布时核实。此项不作为已验证的生产发布。

## 原始资料接入验证记录

- TypeScript 类型检查与生产构建。
- 28 项前端/工具测试，包括原功能回归、下载流成功/取消/失败、截断、超长、哈希错误、路径限制和资源契约。
- 44 个源文件、13 张示例图与源 ZIP 逐项比对；七分包整体哈希一致；三个下载 ZIP CRC 校验。
- R 文件 parse 与 Python AST 静态检查；未安装新的分析环境、未执行 Seurat / Scanpy 全流程。
- 浏览器真实验证技能添加与对话草稿、案例/教程切换、桌面和 390 px 窄屏；实际下载约 280 MB 原包，落盘后的字节数和整体哈希均与源 ZIP 相同；取消下载路径亦验证。
- 没有调用真实模型 API；没有执行条件差异、自动注释或空间重分析。

## 环境资料来源

- [Seurat 官方安装](https://satijalab.org/seurat/articles/install_v5.html)
- [Scanpy 官方安装](https://scanpy.readthedocs.io/en/stable/installation.html)
- [Scanpy 1.12.1 发布](https://pypi.org/project/scanpy/1.12.1/) 与 [conda-forge 发布文件](https://anaconda.org/conda-forge/scanpy/files)
- [Conda 独立环境](https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html)
- [Quarto Python 执行](https://quarto.org/docs/computations/python.html)

原矩阵来源标识依附件 PBMC2700 / GSE194329 / GBM1 保留；未与发布方原始文件做哈希比对，GEO 样本元数据未独立确认。教程内的科学解释参考单列在各篇末尾。
