// Keep stored records and exported methods intact; shorten known legacy UI copy.
export function formatAnalysisText(text: string): string {
  const fixed: Record<string, string> = {
    '使用所选数值列构成矩阵；保留行列顺序，不执行归一化、聚类或统计检验。': '使用所选数值列的原始值构成矩阵，按原行列顺序展示。',
    '未删除、填补或归一化任何观测。': '使用原始观测值。',
    '小提琴密度采用 Matplotlib Gaussian KDE（Scott 带宽）；显示全部原始观测，不进行显著性检验。': '采用 Matplotlib Gaussian KDE（Scott 带宽），显示全部样本点。',
    '柱高为各组算术均值；叠加全部原始观测，不附加误差线或显著性标记，数值轴包含零。': '柱高为各组算术均值，显示全部样本点；数值轴包含零。',
    '箱体为第 25/50/75 百分位，须线采用 1.5×IQR；叠加全部原始观测，不进行显著性检验。': '箱体为第 25/50/75 百分位，须线为 1.5×IQR；显示全部样本点。',
    '所有分组使用相同的 20 个等宽区间；区间边界写入 manifest.json。': '所有分组使用相同的 20 个等宽区间。',
    '首版只接受 .csv、.tsv 和 .xlsx；FASTQ、H5AD、XLS 与 R 脚本需专用分析流程。': '请选择 CSV、TSV 或 XLSX 文件。',
    '首版支持 CSV、TSV 和 XLSX；FASTQ、H5AD 和 R 脚本尚未支持。': '请选择 CSV、TSV 或 XLSX 文件。',
    '展开后超过 100000 个观测；请减少选取的数值列，不会自动抽样。': '展开后超过 100000 个观测，请减少数值列。',
  };
  if (Object.hasOwn(fixed, text)) return fixed[text];

  // Whole-template matches preserve numbers, field names, and unknown messages.
  const patterns: [RegExp, string][] = [
    [/^Excel 仅读取第一个工作表：(.+)；其余工作表不参与分析。$/, '读取第一个工作表：$1。'],
    [/^(.+) 同时包含数值和文本；用于数值绘图前需明确整理。$/, '$1 含数值和文本，请整理为数值。'],
    [/^发现 (\d+) 个空单元格；绘图前需要明确缺失值策略。$/, '发现 $1 个缺失单元格，请选择处理方式。'],
    [/^选择 (\d+) 个数值列，按列顺序将宽表展开为 group\/value 长表；分组名称来自原列名。$/, '按列顺序展开 $1 个数值列，生成 group/value 长表；列名作为分组。'],
    [/^用户选择 missing=drop，排除 (\d+) 个(展开后的观测|数据行)；逐项来源记录在 manifest\.json 的 exclusions。$/, '排除 $1 个$2。'],
    [/^已按明确选择排除 (\d+) 个(展开后的观测|数据行)，原始文件保持不变。$/, '已排除 $1 个$2。'],
    [/^第 (\d+) 行有 (\d+) 列，表头有 (\d+) 列；不自动补齐或截断。$/, '第 $1 行有 $2 列，表头有 $3 列，请统一列数。'],
    [/^热图最多支持 (\d+) 列；请先选择更小矩阵，不会自动截断。$/, '热图最多支持 $1 列，请减少所选列。'],
    [/^热图有 (\d+) 行，首版最多支持 (\d+) 行；请先选择目标行，不会自动抽样。$/, '热图有 $1 行，最多支持 $2 行，请选择目标行。'],
    [/^有 (\d+) 个分组，首版绘图最多支持 (\d+) 组；请先选择需要的分组。$/, '有 $1 个分组，最多支持 $2 组，请选择需要的分组。'],
    [/^(原表第 .+，缺失列：.+)。请补充数据，或明确选择 drop 后预览删除影响。$/, '$1。请补全数据或选择排除缺失值。'],
  ];
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  return text;
}
