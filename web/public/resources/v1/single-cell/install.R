# Run in R / RStudio. Installs only the declared packages and required dependencies.
packages <- c("Seurat", "ggplot2", "Matrix", "patchwork", "ggdendro", "viridisLite")
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly=TRUE)]
if (length(missing)) install.packages(missing, repos="https://cloud.r-project.org")
stopifnot(all(vapply(packages, requireNamespace, logical(1), quietly=TRUE)))
sessionInfo()
