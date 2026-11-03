# 差异表达与功能富集分析

先明确比较单位与对照方向，再选择统计方法和富集背景。

适用范围：教学与外部环境复现；本站不运行原始组学分析。

## 先区分 marker 搜索与条件比较

cluster 对其他细胞的 marker 搜索，主要回答哪些基因帮助描述当前分群。病例与对照的差异分析则需要明确实验单位、供者或样本重复、配对、批次及混杂因素。不能把同一供者的细胞全部当作独立生物重复。

PBMC 案例只有单一样本，没有病例/对照信息。空间脚本按 clusters 使用 t-test 排名 marker，这是探索性群间比较，不是具有独立样本重复的条件差异研究。网页提供方法指导与结果表绘图，不在线执行差异或富集分析。

## 检验方法取决于问题和模型假设

| 方法 | 用途与注意事项 |
| --- | --- |
| Wilcoxon / Presto | 基于秩的比较；不应普遍解释成仅检验中位数。Presto 提供快速 Wilcoxon / auROC 实现。 |
| ROC | 评估基因区分分群的能力；Seurat 此模式不提供通常的差异检验 P 值。 |
| t-test | 比较均值；检查独立性、分布与方差处理，不能仅凭细胞多就忽略样本依赖。 |
| negbinom / poisson | 基于计数分布；需核对数据层、适用数据和离散假设。 |
| LR / MAST / bimod | 各有不同模型结构与适用假设；Seurat LR 为以分群为响应的 logistic 回归比较，不能与所有似然比方法混为一谈。 |
| 样本层面 pseudobulk / 混合模型 | 条件差异分析可考虑按样本与细胞类型聚合计数，或显式处理样本内依赖；仍需足够重复和合适设计。 |

## 记录参数，不为了凑结果调整阈值

不要只因为差异基因太多或太少就事后寻找“理想”阈值。可以做预先说明的敏感性分析，但要保留所有参数和筛选规则。

- min.pct：Seurat 按至少一个比较群达到最低检出比例进行候选过滤，不是任一群低于阈值就丢弃。
- logfc.threshold：预筛效应大小的参数；具体数值、对数底数和过滤行为随函数、数据层及选项而定，以所用版本为准。
- p_val 与 p_val_adj：记录检验和多重校正方法。Seurat FindMarkers 的 p_val_adj 使用 Bonferroni；不能直接叫作 BH-FDR。
- max.cells.per.ident / 抽样：记录是否启用、每群上限和随机种子。抽样用于算力或特定设计，不会自动解决伪重复。
- 比较方向：明确 ident.1 与 ident.2，检查正负 logFC 的含义；同时报告效应大小、检出比例、样本数和不确定性。

## ORA 与 GSEA 的输入不同

ORA 背景应对应实际有机会进入目标集合的基因，不能无条件用全基因组替代。GSEA 通常不先按显著性筛掉基因；选择能反映比较方向与证据的排序指标，并报告其定义。

GO、KEGG、Reactome、MSigDB 的基因集覆盖、标识体系与许可不同；按物种核实可用性。本站“参考基因组”目录不是富集数据库，也不代表内置了这些基因集。

| 方法 | 输入 | 必须记录 |
| --- | --- | --- |
| ORA / enricher | 目标基因集合、可被检验的背景基因、基因集映射 | 物种、ID 类型、背景 universe、数据库版本和筛选规则 |
| GSEA | 覆盖待检验基因的有名称、无重复且排序好的数值向量 | 排序统计量及方向、数据库版本、基因集大小与算法参数 |

## 富集参数与结果解读

pvalueCutoff、pAdjustMethod、qvalueCutoff、minGSSize、maxGSSize 各有独立含义。q value 与校正后的 P 值相关但不是同一个字段；根据所用函数的实际过滤规则报告结果。

富集 DotPlot 的位置、大小和颜色要以实际图例为准：可能是 GeneRatio、Count、p.adjust 等。GSEA 应一起查看 NES、校正显著性和 leading-edge 基因；富集并不自动证明通路被激活或存在因果作用。

火山图需要说明 y 轴使用原始还是校正 P 值。热图需注明数值层与是否按行标准化，小提琴图需注明单位和样本依赖。当前网站没有火山图、GSEA 曲线或自动富集重算按钮。

## 把外部结果接回网页

在外部环境完成分析并保存代码、版本和结果。若只需普通热图或柱状图，可把符合格式与大小限制的结果表导入“数据与绘图 → 表格绘图”，核对字段后预览并确认。网站绘图不会补做统计检验。

在技能库添加“差异表达与富集方案指导”，让 AI 协助检查比较设计、字段、校正方法和报告措辞；没有实际结果时不能生成虚构 P 值或通路结论。

## 官方参考

- [Seurat FindMarkers](https://satijalab.org/seurat/reference/findmarkers)
- [OSCA 多样本比较](https://bioconductor.org/books/release/OSCA.multisample/multi-sample-comparisons.html)
- [clusterProfiler 官方手册](https://yulab-smu.top/biomedical-knowledge-mining-book/)
- [Presto 官方项目](https://github.com/immunogenomics/presto)
