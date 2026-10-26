# bioinfobuddy R 模板。input_file 为选择的数据文件；output_dir 为本次独立输出目录。
# 文件应输出到 output_dir；不要修改 input_file。
if (is.null(input_file)) stop("请选择一个 CSV 数据文件")
data <- read.csv(input_file, check.names = FALSE)
numeric_columns <- names(data)[vapply(data, is.numeric, logical(1))]
if (length(numeric_columns) < 2) stop("需要至少两个数值列")
draw <- function() plot(data[[numeric_columns[1]]], data[[numeric_columns[2]]],
                       xlab = numeric_columns[1], ylab = numeric_columns[2],
                       pch = 19, col = "#217A72")
png(file.path(output_dir, "chart.png"), width = 1200, height = 900, res = 150); draw(); dev.off()
pdf(file.path(output_dir, "chart.pdf"), width = 8, height = 6); draw(); dev.off()
if (isTRUE(capabilities("cairo"))) {
  svg(file.path(output_dir, "chart.svg"), width = 8, height = 6); draw(); dev.off()
} else {
  message("当前 R 未提供 Cairo SVG 设备；已输出 PNG 和 PDF。")
}
