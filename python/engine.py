#!/usr/bin/env python3
"""Bounded local table inspection, explicit adaptation, and fixed plotting tools.

No input file or model response is evaluated as code. The original input is only
read. The exported analysis.py contains this module's fixed plotting function.
"""
from __future__ import annotations

import csv
import hashlib
import importlib
import importlib.metadata
import inspect
import io
import json
import math
import re
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 50_000
MAX_COLUMNS = 100
MAX_HEATMAP_ROWS = 50
MAX_HEATMAP_COLUMNS = 30
MAX_GROUPS = 20
CHARTS = {"box", "violin", "bar", "scatter", "histogram", "heatmap"}
STYLE_KEYS = {"title", "xLabel", "yLabel", "palette", "fontSize", "pointSize", "alpha", "width", "height", "dpi"}
NUMERIC = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
NONFINITE = {"nan", "+nan", "-nan", "inf", "+inf", "-inf", "infinity", "+infinity", "-infinity"}


class DataError(ValueError):
    """A user-actionable input or configuration error."""


def normalize_style(config: dict[str, Any], template: str, *, width=7.2, height=4.8) -> dict[str, Any]:
    """Validate presentation separately from mappings; return explicit saved defaults."""
    has_points = template in {"box", "violin", "bar", "scatter", "embedding"}
    if "pointSize" in config and not has_points:
        raise DataError("此图例没有样本点，不支持 pointSize。")
    is_fastq = template in {"fastq-length", "fastq-quality"}
    palette = "teal" if is_fastq else "tab10" if template == "embedding" else "viridis" if template == "heatmap" else "colorblind"
    style = {"title": "", "xLabel": "", "yLabel": "", "palette": palette,
             "fontSize": 10, "alpha": 1 if template in {"heatmap", "histogram"} or is_fastq else 0.75 if template == "scatter" else 0.7,
             "width": width, "height": height, "dpi": 180 if is_fastq or template == "embedding" else 200}
    if has_points:
        style["pointSize"] = 4 if template == "embedding" else 25 if template == "scatter" else 19
    style.update({key: value for key, value in config.items() if key in STYLE_KEYS})
    for key in ("title", "xLabel", "yLabel"):
        if not isinstance(style[key], str) or len(style[key]) > 160 or any(ord(char) < 32 for char in style[key]):
            raise DataError(f"{key} 必须是最多 160 字符且不含控制字符的文本。")
    palettes = {"viridis", "plasma", "grayscale"} | (set() if template == "heatmap" else {"colorblind"})
    if is_fastq:
        palettes.add("teal")
    if template == "embedding":
        palettes.add("tab10")
    if not isinstance(style["palette"], str) or style["palette"] not in palettes:
        raise DataError("palette 不是此图例支持的配色。")
    limits = {"fontSize": (6, 24), "pointSize": (1, 100), "alpha": (0.05, 1), "width": (3, 16), "height": (3, 16), "dpi": (72, 600)}
    for key, (low, high) in limits.items():
        if key not in style:
            continue
        value = style[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise DataError(f"{key} 必须是 {low} 到 {high} 之间的有限数值。")
        if key == "dpi":
            if int(value) != value:
                raise DataError("dpi 必须是整数。")
            style[key] = int(value)
    if style["width"] * style["height"] * style["dpi"] ** 2 > 40_000_000:
        raise DataError("图幅与分辨率组合超过 4000 万像素；请降低图幅或 dpi。")
    return style


def plot_appearance(config: dict[str, Any]) -> dict[str, Any]:
    """Self-contained style resolver, embedded with the exported plotting function."""
    import matplotlib
    from matplotlib import font_manager

    fonts = {font.name for font in font_manager.fontManager.ttflist}
    preferred = ["Arial Unicode MS", "Noto Sans CJK SC", "PingFang SC", "Heiti TC", "Microsoft YaHei", "SimHei", "DejaVu Sans"]
    font = next((name for name in preferred if name in fonts), "DejaVu Sans")
    name = config.get("palette", "colorblind")
    cmap = {"colorblind": "cividis", "grayscale": "Greys", "teal": "Greens"}.get(name, name)
    if name == "colorblind":
        colors = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#8C6D00", "#3D3D3D", "#56B4E9"]
    elif name == "teal":
        colors = ["#217A72"]
    elif name == "tab10":
        colors = list(matplotlib.colormaps["tab10"].colors)
    else:
        colors = [matplotlib.colormaps[cmap](value) for value in (0.15, 0.8, 0.35, 0.95, 0.55, 0.7, 0.25)]
    size = config.get("fontSize", 10)
    return {"font": font, "colors": colors, "cmap": cmap,
            "rc": {"font.family": font, "font.size": size, "axes.titlesize": size * 1.3, "axes.labelsize": size * 1.1,
                   "legend.fontsize": size * 0.8, "axes.spines.top": False, "axes.spines.right": False,
                   "axes.unicode_minus": False, "pdf.fonttype": 42, "svg.fonttype": "path",
                   "axes.formatter.useoffset": False, "text.parse_math": False}}


def doctor() -> dict[str, Any]:
    """Check the actual analysis environment, beyond standard-library CSV IO."""
    versions = {}
    for name in ("numpy", "pandas", "matplotlib", "openpyxl"):
        try:
            module = importlib.import_module(name)
            versions[name] = str(module.__version__)
        except (ImportError, AttributeError) as exc:
            raise DataError(f"分析环境缺少或无法加载 {name}：{exc}。请运行 npm run setup:python 安装项目依赖。") from exc
    return {"ready": True, "versions": versions, "pythonVersion": sys.version.split()[0]}


def missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def numeric(value: Any, location: str = "value") -> float:
    if isinstance(value, bool):
        raise DataError(f"{location}: 布尔值不能作为连续数值绘图。")
    if isinstance(value, (int, float)):
        result = float(value)
    elif isinstance(value, str) and NUMERIC.fullmatch(value.strip()):
        result = float(value.strip())
    else:
        raise DataError(f"{location}: 不是有效数值（{str(value)[:70]!r}）；请检查单位、千分位或文本。")
    if not math.isfinite(result):
        raise DataError(f"{location}: 不允许 NaN、Infinity 或溢出的数值。")
    return result


def _validate_cell(value: Any, row_number: int, column: str) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and not math.isfinite(value):
        raise DataError(f"第 {row_number} 行、{column} 列包含非有限数值。")
    if isinstance(value, str):
        text = value.strip()
        if text.lower() in NONFINITE:
            raise DataError(f"第 {row_number} 行、{column} 列包含 {text}；非有限数值不能当作缺失值忽略。")
        if NUMERIC.fullmatch(text) and not math.isfinite(float(text)):
            raise DataError(f"第 {row_number} 行、{column} 列数值溢出。")
        if text.startswith(("=", "@")) or (text.startswith(("+", "-")) and not NUMERIC.fullmatch(text)):
            raise DataError(f"第 {row_number} 行、{column} 列包含公式样式文本；请导出为纯数据后重试。")
        if len(value) > 10_000:
            raise DataError(f"第 {row_number} 行、{column} 列文本过长（最多 10000 字符）。")
        return None if missing(value) else value
    if isinstance(value, (int, bool)):
        return value
    # Dates are represented explicitly rather than silently interpreted as numbers.
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def read_table(input_path: str | Path) -> dict[str, Any]:
    path = Path(input_path)
    if not path.is_file():
        raise DataError("输入文件不存在或不是普通文件。")
    if path.stat().st_size > MAX_BYTES:
        raise DataError("文件超过 10 MiB 限制；请先在本地选择需要的数据。")
    raw = path.read_bytes()
    if len(raw) > MAX_BYTES:
        raise DataError("文件超过 10 MiB 限制。")
    if not raw:
        raise DataError("文件为空。")
    notices: list[str] = []
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        try:
            decoded = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise DataError("请使用 UTF-8 编码的 CSV/TSV（支持 UTF-8 BOM）。") from exc
        if "\x00" in decoded:
            raise DataError("文本文件包含 NUL 字节；请检查文件格式。")
        delimiter = "\t" if suffix == ".tsv" else ","
        # A .csv containing a tab-separated first line is accepted and reported.
        if suffix == ".csv" and "\t" in decoded.splitlines()[0] and "," not in decoded.splitlines()[0]:
            delimiter = "\t"
            notices.append("文件内容使用制表符分隔，按 TSV 读取。")
        try:
            rows = []
            for index, row in enumerate(csv.reader(io.StringIO(decoded, newline=""), delimiter=delimiter, strict=True)):
                if index > MAX_ROWS:
                    raise DataError(f"数据超过 {MAX_ROWS} 行限制。")
                if len(row) > MAX_COLUMNS:
                    raise DataError(f"数据超过 {MAX_COLUMNS} 列限制。")
                rows.append(row)
        except csv.Error as exc:
            raise DataError(f"CSV/TSV 解析失败：{exc}") from exc
    elif suffix == ".xlsx":
        from openpyxl import load_workbook

        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                if len(archive.infolist()) > 2000 or sum(entry.file_size for entry in archive.infolist()) > 100 * 1024 * 1024:
                    raise DataError("Excel 解压后内容过大，拒绝读取。")
            workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
            try:
                sheet = workbook.worksheets[0]
                notices.append(f"工作表：{sheet.title}（第一个工作表）。")
                if sheet.max_row and sheet.max_row > MAX_ROWS + 1:
                    raise DataError(f"Excel 工作表超过 {MAX_ROWS} 行限制（含格式占用的行）；请导出干净数据表。")
                if sheet.max_column and sheet.max_column > MAX_COLUMNS:
                    raise DataError(f"Excel 工作表超过 {MAX_COLUMNS} 列限制。")
                rows = []
                for row_index, cells in enumerate(sheet.iter_rows(max_row=MAX_ROWS + 2, max_col=min(sheet.max_column or MAX_COLUMNS + 1, MAX_COLUMNS + 1)), start=1):
                    # read_only worksheets can yield empty rows up to max_row.
                    if sheet.max_row is not None and row_index > sheet.max_row:
                        break
                    row = []
                    for cell in cells:
                        if cell.data_type == "f":
                            raise DataError(f"Excel 单元格 {cell.coordinate} 含公式；请先复制并粘贴为值再导入。")
                        if cell.data_type == "e":
                            raise DataError(f"Excel 单元格 {cell.coordinate} 含错误值 {cell.value}。")
                        row.append(cell.value)
                    rows.append(row)
                if len(rows) > MAX_ROWS + 1:
                    raise DataError(f"数据超过 {MAX_ROWS} 行限制。")
            finally:
                workbook.close()
        except DataError:
            raise
        except Exception as exc:
            raise DataError(f"无法读取 XLSX：{exc}") from exc
    else:
        raise DataError("请选择 CSV、TSV 或 XLSX 文件。")

    if not rows or not rows[0] or all(missing(value) for value in rows[0]):
        raise DataError("缺少表头；第一行必须是非空且不重复的列名。")
    header = [str(value) if not missing(value) else "" for value in rows[0]]
    if any(not name.strip() for name in header):
        raise DataError("表头含空列名；请为每列命名。")
    if any(len(name) > 120 for name in header):
        raise DataError("列名超过 120 字符限制。")
    for name in header:
        _validate_cell(name, 1, "表头")
    repeated = [name for name, count in Counter(header).items() if count > 1]
    if repeated:
        raise DataError(f"存在重复列名：{', '.join(repeated)}。")
    values: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows[1:], start=2):
        if len(row) != len(header):
            raise DataError(f"第 {row_number} 行有 {len(row)} 列，表头有 {len(header)} 列；请统一列数。")
        if [str(value) if value is not None else "" for value in row] == header:
            raise DataError(f"第 {row_number} 行重复了表头；请确认是否拼接了多个数据表。")
        values.append({column: _validate_cell(value, row_number, column) for column, value in zip(header, row)})
    if not values:
        raise DataError("只有表头，没有数据行。")
    return {"header": header, "values": values, "warnings": notices, "sha256": hashlib.sha256(raw).hexdigest(), "format": suffix[1:]}


def inspect_table(table: dict[str, Any]) -> dict[str, Any]:
    columns = []
    notices = list(table["warnings"])
    for name in table["header"]:
        present = [row[name] for row in table["values"] if not missing(row[name])]
        is_number = True
        numeric_count = 0
        for value in present:
            try:
                numeric(value)
                numeric_count += 1
            except DataError:
                is_number = False
        kind = "number" if present and is_number else "string"
        if present and 0 < numeric_count < len(present):
            notices.append(f"{name} 包含数值和文本。")
        columns.append({"name": name, "type": kind, "missing": len(table["values"]) - len(present)})
    # Preserve source values: a numeric-looking sample identifier such as 001
    # must not become 1.0 in the original-data preview.
    preview = [dict(row) for row in table["values"][:10]]
    blank_count = sum(column["missing"] for column in columns)
    if blank_count:
        notices.append(f"{blank_count} 个空单元格。")
    return {"rows": len(table["values"]), "columns": columns, "preview": preview, "warnings": notices, "sha256": table["sha256"]}


def validate_config(config: Any, table: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise DataError("配置必须是 JSON 对象。")
    allowed = {"chart", "layout", "x", "y", "group", "valueColumns", "missing"} | STYLE_KEYS
    # The server also sends plan metadata. It never becomes plotting code or an
    # exported parameter. Bind approval metadata to the actual input bytes.
    if config.get("sourceSha256") and config["sourceSha256"] != table["sha256"]:
        raise DataError("输入文件自预览后已发生改变；请重新预览并确认分析。")
    normalized = {"chart": "box", "layout": "long", "x": "", "y": "", "group": "", "valueColumns": [], "missing": "error", "title": "", "xLabel": "", "yLabel": ""}
    normalized.update({key: value for key, value in config.items() if key in allowed})
    if not isinstance(normalized["chart"], str) or normalized["chart"] not in CHARTS:
        raise DataError("不支持的图表类型。")
    if not isinstance(normalized["layout"], str) or normalized["layout"] not in {"long", "wide"}:
        raise DataError("layout 必须是 long 或 wide。")
    if not isinstance(normalized["missing"], str) or normalized["missing"] not in {"error", "drop"}:
        raise DataError("missing 必须明确为 error 或 drop。")
    for key in ("x", "y", "group"):
        if normalized[key] is None and key in {"x", "y", "group"}:
            normalized[key] = ""
        if not isinstance(normalized[key], str) or len(normalized[key]) > 160:
            raise DataError(f"{key} 必须是最多 160 字符的文本。")
        if any(ord(char) < 32 for char in normalized[key]):
            raise DataError(f"{key} 不允许控制字符。")
    value_columns = normalized["valueColumns"]
    if not isinstance(value_columns, list) or any(not isinstance(value, str) for value in value_columns):
        raise DataError("valueColumns 必须是列名列表。")
    if len(value_columns) != len(set(value_columns)):
        raise DataError("valueColumns 中不能重复选择同一列。")
    # Wide grouped charts derive groups from valueColumns. A UI may retain
    # hidden long-layout selections; those are not active mappings and must not
    # influence validation, axis labels, or the exported configuration.
    if normalized["chart"] in {"box", "violin", "bar"} and normalized["layout"] == "wide":
        normalized.update({"x": "", "y": "", "group": ""})
    for key in ("x", "y", "group"):
        if normalized[key] and normalized[key] not in table["header"]:
            raise DataError(f"找不到 {key} 对应的列：{normalized[key]}。")
    if any(name not in table["header"] for name in value_columns):
        raise DataError("valueColumns 含不存在的列。")
    chart = normalized["chart"]
    if chart in {"box", "violin", "bar"}:
        if normalized["layout"] == "wide":
            if not value_columns:
                raise DataError("宽表至少需要选择一个 valueColumns 数值列。")
        elif not normalized["group"] or not normalized["y"]:
            raise DataError("长表分组绘图必须指定 group 和 y 列。")
    elif chart == "scatter":
        if normalized["layout"] != "long":
            raise DataError("散点图使用 long 布局，请明确选择 x 与 y 数值列。")
        if not normalized["x"] or not normalized["y"]:
            raise DataError("散点图必须指定 x 和 y 数值列。")
    elif chart == "histogram":
        if normalized["layout"] != "long" or not normalized["y"]:
            raise DataError("直方图使用 long 布局，并需要 y 数值列。")
    elif chart == "heatmap":
        if not value_columns:
            raise DataError("热图需要通过 valueColumns 指定数值矩阵列。")
        if len(value_columns) > MAX_HEATMAP_COLUMNS:
            raise DataError(f"热图最多支持 {MAX_HEATMAP_COLUMNS} 列；请减少所选列。")
        if normalized["x"] in value_columns:
            raise DataError("热图行标签列不能同时作为数值矩阵列。")
        if "row_label" in value_columns:
            raise DataError("热图数值列名 row_label 与输出保留字段冲突，请先重命名。")
    style = normalize_style(normalized, chart,
                            width=max(7.2, len(value_columns) * 0.35 + 2) if chart == "heatmap" else 7.2,
                            height=max(4.8, min(16, len(table["values"]) * 0.22 + 2)) if chart == "heatmap" else 4.8)
    normalized.update(style)
    return normalized


def prepare(table: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    automatic_width = isinstance(config, dict) and "width" not in config
    automatic_height = isinstance(config, dict) and "height" not in config
    config = validate_config(config, table)
    chart = config["chart"]
    output = []
    dropped = []
    steps = []
    notices = list(table["warnings"])
    source_rows = table["values"]

    def keep(required: list[str], row: dict[str, Any], index: int, detail: str = "") -> bool:
        absent = [name for name in required if missing(row[name])]
        if not absent:
            return True
        location = f"原表第 {index + 2} 行{detail}，缺失列：{', '.join(absent)}"
        if config["missing"] == "error":
            raise DataError(f"{location}。请补充数据，或选择排除缺失值后预览。")
        dropped.append({"sourceRow": index + 2, "columns": absent, "detail": detail})
        return False

    if chart in {"box", "violin", "bar"} and config["layout"] == "wide":
        columns = ["group", "value"]
        for name in config["valueColumns"]:
            for index, row in enumerate(source_rows):
                if keep([name], row, index, f"（展开列 {name}）"):
                    output.append({"group": name, "value": numeric(row[name], f"第 {index + 2} 行 {name}")})
        steps.append(f"将 {len(config['valueColumns'])} 个数值列展开为 group/value 长表，以列名分组。")
    elif chart in {"box", "violin", "bar"}:
        columns = ["group", "value"]
        for index, row in enumerate(source_rows):
            if keep([config["group"], config["y"]], row, index):
                output.append({"group": str(row[config["group"]]), "value": numeric(row[config["y"]], f"第 {index + 2} 行 {config['y']}")})
        steps.append(f"映射 {config['group']} → group，{config['y']} → value。")
    elif chart in {"scatter", "histogram"}:
        columns = (["x", "y"] if chart == "scatter" else ["value"]) + (["group"] if config["group"] else [])
        required = ([config["x"], config["y"]] if chart == "scatter" else [config["y"]]) + ([config["group"]] if config["group"] else [])
        for index, row in enumerate(source_rows):
            if keep(required, row, index):
                item = {"x": numeric(row[config["x"]], f"第 {index + 2} 行 {config['x']}"), "y": numeric(row[config["y"]], f"第 {index + 2} 行 {config['y']}")} if chart == "scatter" else {"value": numeric(row[config["y"]], f"第 {index + 2} 行 {config['y']}")}
                if config["group"]:
                    item["group"] = str(row[config["group"]])
                output.append(item)
        steps.append("按所选列映射数值与分组，按原顺序排列。")
    else:
        columns = ["row_label", *config["valueColumns"]]
        required = [*config["valueColumns"], *([config["x"]] if config["x"] else [])]
        for index, row in enumerate(source_rows):
            if keep(required, row, index):
                item = {"row_label": str(row[config["x"]]) if config["x"] else str(index + 1)}
                item.update({name: numeric(row[name], f"第 {index + 2} 行 {name}") for name in config["valueColumns"]})
                output.append(item)
        if len(output) > MAX_HEATMAP_ROWS:
            raise DataError(f"热图有 {len(output)} 行，最多支持 {MAX_HEATMAP_ROWS} 行；请减少数据行。")
        steps.append("使用所选数值列构成矩阵，按原行列顺序绘制。")
    if not output:
        raise DataError("处理后没有可绘图的数据；请检查字段与缺失值策略。")
    if len(output) > 100_000:
        raise DataError("展开后超过 100000 个观测；请减少所选数值列。")
    if dropped:
        unit = "展开后的观测" if config["layout"] == "wide" and chart != "heatmap" else "数据行"
        steps.append(f"排除含缺失值的 {len(dropped)} 个{unit}。")
        notices.append(f"已排除 {len(dropped)} 个{unit}。")
    else:
        steps.append(f"保留全部 {len(output)} 个观测。")
    groups = Counter(str(row["group"]) for row in output if "group" in row)
    if len(groups) > MAX_GROUPS:
        raise DataError(f"有 {len(groups)} 个分组，最多支持 {MAX_GROUPS} 组；请减少分组。")
    if any(len(name) > 80 for name in groups):
        raise DataError("分组标签超过 80 字符；请使用更短且可辨认的分组名称。")
    # Resolve automatic dimensions from the actual reviewed data, then save
    # them explicitly so reopening this run does not pick newer defaults.
    if automatic_width and chart != "heatmap":
        config["width"] = max(7.2, min(16, len(groups) * 0.7 + 2))
    if automatic_height and chart == "heatmap":
        config["height"] = max(4.8, len(output) * 0.22 + 2)
    normalize_style(config, chart)  # Apply the pixel budget after auto sizing.
    if chart == "violin":
        for name, count in groups.items():
            values = [row["value"] for row in output if row["group"] == name]
            if count < 2 or len(set(values)) < 2:
                raise DataError(f"小提琴图的 {name!r} 组至少需要 2 个非恒定数值；请改用箱线图或散点展示。")
        steps.append("小提琴密度采用 Gaussian KDE（Scott 带宽），叠加全部观测值。")
    if chart == "bar":
        steps.append("柱高为各组算术均值，叠加全部观测值，数值轴包含零。")
    if chart == "box":
        steps.append("箱体为第 25/50/75 百分位，须线为 1.5×IQR，叠加全部观测值。")
    if chart == "histogram":
        steps.append("各组使用相同的 20 个等宽区间。")
    return {"data": output, "config": config, "preview": output[:10], "outputColumns": columns, "inputRows": len(source_rows), "outputRows": len(output), "droppedRows": len(dropped), "exclusions": dropped, "steps": steps, "warnings": notices, "groups": dict(groups)}


def draw_chart(records: list[dict[str, Any]], config: dict[str, Any], output_dir: str | Path) -> dict[str, Any]:
    """Fixed plotting function; also embedded verbatim into exported analysis.py."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    chart = config["chart"]
    appearance = plot_appearance(config)
    palette = appearance["colors"]
    markers = ["o", "s", "^", "D", "v", "P", "X"]
    groups = list(dict.fromkeys(str(row["group"]) for row in records if "group" in row))
    result: dict[str, Any] = {"fontFamily": appearance["font"], "jitterSeed": 42, "allObservationsPlotted": True, "normalization": "none", "statisticalTests": "none", "pngDpi": config["dpi"], "svgText": "paths", "groupCounts": {name: sum(str(row.get("group")) == name for row in records) for name in groups}, "appearance": {key: config[key] for key in ("palette", "fontSize", "alpha", "width", "height", "dpi")}}
    if "pointSize" in config:
        result["appearance"]["pointSize"] = config["pointSize"]
    width, height = config["width"], config["height"]
    alpha = config["alpha"]
    with plt.rc_context(appearance["rc"]):
        fig, ax = plt.subplots(figsize=(width, height), layout="constrained")
        ax.set_facecolor("white")
        fig.set_facecolor("white")
        ax.set_title(config.get("title") or {"box": "Grouped observations", "violin": "Distribution by group", "bar": "Group means and observations", "scatter": "Scatter plot", "histogram": "Observed distribution", "heatmap": "Numeric matrix"}[chart], loc="left", pad=15)
        rng = np.random.default_rng(42)
        if chart in {"box", "violin", "bar"}:
            arrays = [np.asarray([float(row["value"]) for row in records if str(row["group"]) == name]) for name in groups]
            positions = np.arange(1, len(groups) + 1)
            if chart == "box":
                boxes = ax.boxplot(arrays, positions=positions, widths=0.5, patch_artist=True, showfliers=False, whis=1.5, medianprops={"color": "#222222", "linewidth": 1.5})
                for index, patch in enumerate(boxes["boxes"]):
                    patch.set(facecolor=palette[index % len(palette)], alpha=alpha * (0.18 / 0.7), edgecolor="#333333")
                result["estimator"] = "quartiles and 1.5 IQR whiskers; all raw observations overlaid"
            elif chart == "violin":
                violins = ax.violinplot(arrays, positions=positions, widths=0.75, showmeans=False, showmedians=True, showextrema=False, bw_method="scott")
                for index, body in enumerate(violins["bodies"]):
                    body.set_facecolor(palette[index % len(palette)])
                    body.set_edgecolor("#333333")
                    body.set_alpha(alpha * (0.2 / 0.7))
                violins["cmedians"].set_color("#333333")
                result["density"] = {"method": "Gaussian KDE", "bandwidth": "Scott", "evaluationPoints": 100}
            else:
                means = [float(np.mean(array)) for array in arrays]
                ax.bar(positions, means, width=0.58, color=[palette[index % len(palette)] for index in range(len(groups))], alpha=alpha * (0.22 / 0.7), edgecolor="#333333", linewidth=0.8)
                ax.axhline(0, color="#444444", linewidth=0.8)
                result["estimator"] = "arithmetic mean; no uncertainty interval or statistical test"
                result["groupMeans"] = dict(zip(groups, means))
            for index, values in enumerate(arrays):
                offsets = rng.uniform(-0.12, 0.12, len(values))
                ax.scatter(np.full(len(values), index + 1) + offsets, values, color=palette[index % len(palette)], marker=markers[index % len(markers)], s=config["pointSize"], alpha=alpha, linewidths=0.3, edgecolors="white", rasterized=len(records) > 3000)
            if chart == "bar":
                # Set limits only after adding observations; include every raw
                # extreme and the zero baseline, not merely the group means.
                minimum = min(0.0, min(float(array.min()) for array in arrays))
                maximum = max(0.0, max(float(array.max()) for array in arrays))
                padding = (maximum - minimum) * 0.08 or 1.0
                ax.set_ylim(minimum - padding if minimum < 0 else 0, maximum + padding if maximum > 0 else (0 if minimum < 0 else 1))
            ax.set_xticks(positions, [f"{name}\n(n={len(values)})" for name, values in zip(groups, arrays)], rotation=25 if any(len(name) > 14 for name in groups) or len(groups) > 8 else 0)
            ax.set_xlabel(config.get("xLabel") or config.get("group") or "Group")
            ax.set_ylabel(config.get("yLabel") or config.get("y") or "Value")
            ax.grid(axis="y", color="#E8E8E8", linewidth=0.6)
            ax.set_axisbelow(True)
        elif chart == "scatter":
            for index, name in enumerate(groups or [None]):
                subset = [row for row in records if name is None or str(row["group"]) == name]
                ax.scatter([float(row["x"]) for row in subset], [float(row["y"]) for row in subset], label=f"{name} (n={len(subset)})" if name is not None else None, color=palette[index % len(palette)], marker=markers[index % len(markers)], s=config["pointSize"], alpha=alpha, linewidths=0.3, edgecolors="white", rasterized=len(records) > 3000)
            ax.set_xlabel(config.get("xLabel") or config.get("x") or "x")
            ax.set_ylabel(config.get("yLabel") or config.get("y") or "y")
            if groups:
                ax.legend(frameon=False, bbox_to_anchor=(1.01, 1), loc="upper left")
        elif chart == "histogram":
            all_values = np.asarray([float(row["value"]) for row in records])
            edges = np.histogram_bin_edges(all_values, bins=20)
            for index, name in enumerate(groups or [None]):
                values = [float(row["value"]) for row in records if name is None or str(row["group"]) == name]
                ax.hist(values, bins=edges, histtype="step", linewidth=1.6, linestyle=["-", "--", ":", "-."][index % 4], label=f"{name} (n={len(values)})" if name is not None else None, color=palette[index % len(palette)], alpha=alpha)
            ax.set_xlabel(config.get("xLabel") or config.get("y") or "Value")
            ax.set_ylabel(config.get("yLabel") or "Count")
            ax.set_ylim(bottom=0)
            if groups:
                ax.legend(frameon=False)
            result["histogram"] = {"binEdges": edges.tolist(), "intervalConvention": "left-inclusive, right-exclusive; final interval includes right edge", "density": False}
        else:
            names = config["valueColumns"]
            matrix = np.asarray([[float(row[name]) for name in names] for row in records])
            image = ax.imshow(matrix, aspect="auto", interpolation="nearest", cmap=appearance["cmap"], alpha=alpha)
            ax.set_xticks(range(len(names)), names, rotation=45, ha="right")
            ax.set_yticks(range(len(records)), [str(row["row_label"]) for row in records])
            ax.set_xlabel(config.get("xLabel") or "Selected columns")
            ax.set_ylabel(config.get("yLabel") or config.get("x") or "Source row")
            fig.colorbar(image, ax=ax, label="Original value", shrink=0.8)
            result["colorScale"] = {"type": "linear", "minimum": float(matrix.min()), "maximum": float(matrix.max()), "palette": config["palette"]}
        result["axisLabels"] = {"x": ax.get_xlabel(), "y": ax.get_ylabel()}
        result["axisLimits"] = {"x": [float(value) for value in ax.get_xlim()], "y": [float(value) for value in ax.get_ylim()]}
        for extension in ("png", "svg", "pdf"):
            fig.savefig(output_dir / f"chart.{extension}", format=extension, dpi=config["dpi"], facecolor="white")
        plt.close(fig)
    return result


def render(table: dict[str, Any], config: dict[str, Any], output_path: str | Path) -> dict[str, Any]:
    prepared = prepare(table, config)
    output_dir = Path(output_path)
    if output_dir.exists() and any(output_dir.iterdir()):
        raise DataError("输出目录不是空目录；请为本次分析使用新的目录，以免覆盖已有结果。")
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "processed.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=prepared["outputColumns"])
        writer.writeheader()
        writer.writerows(prepared["data"])
    plot_details = draw_chart(prepared["data"], prepared["config"], output_dir)
    versions = {name: importlib.metadata.version(name) for name in ("numpy", "pandas", "matplotlib", "openpyxl")}
    manifest = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "engineVersion": "0.1.0",
        "inputSha256": table["sha256"],
        "inputFormat": table["format"],
        "inputRows": prepared["inputRows"],
        "outputRows": prepared["outputRows"],
        "droppedRows": prepared["droppedRows"],
        "outputColumns": prepared["outputColumns"],
        "config": prepared["config"],
        "groups": prepared["groups"],
        "steps": prepared["steps"],
        "warnings": prepared["warnings"],
        "exclusions": prepared["exclusions"],
        "dependencies": versions,
        "pythonVersion": sys.version.split()[0],
        "plot": plot_details,
        "processedSha256": hashlib.sha256((output_dir / "processed.csv").read_bytes()).hexdigest(),
        "reproduction": "python analysis.py [OUTPUT_DIR]; defaults to a new reproduced/ directory, using processed.csv and manifest.json in this directory. Raw-data transformations are documented in steps and exclusions; no generated model code is executed.",
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    preamble = '#!/usr/bin/env python3\n"""Reproduce this figure from processed.csv.\nInstall the pinned dependencies in requirements.txt, then run python analysis.py.\nThis is fixed, reviewed plotting logic; no model-generated code is executed.\n"""\nfrom __future__ import annotations\nimport csv\nimport json\nimport sys\nimport hashlib\nfrom pathlib import Path\nfrom typing import Any\n\n'
    entrypoint = '''\n\nif __name__ == "__main__":
    base = Path(__file__).resolve().parent
    manifest = json.loads((base / "manifest.json").read_text(encoding="utf-8"))
    data_path = base / "processed.csv"
    if hashlib.sha256(data_path.read_bytes()).hexdigest() != manifest["processedSha256"]:
        raise SystemExit("processed.csv differs from the exported manifest; create a new documented analysis for changed data.")
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else base / "reproduced"
    if target.exists() and any(target.iterdir()):
        raise SystemExit("Output directory must be empty; choose a new directory.")
    with data_path.open(encoding="utf-8", newline="") as handle:
        records = list(csv.DictReader(handle))
    details = draw_chart(records, manifest["config"], target)
    print(json.dumps({"rows": len(records), "groups": details["groupCounts"], "output": str(target)}, ensure_ascii=False))
'''
    (output_dir / "analysis.py").write_text(preamble + inspect.getsource(plot_appearance) + "\n\n" + inspect.getsource(draw_chart) + entrypoint, encoding="utf-8")
    (output_dir / "requirements.txt").write_text("\n".join(f"{name}=={version}" for name, version in versions.items()) + "\n", encoding="utf-8")
    return {"rows": prepared["outputRows"], "groups": len(prepared["groups"]), "groupCounts": prepared["groups"]}


def main() -> int:
    try:
        if len(sys.argv) < 2 or sys.argv[1] not in {"doctor", "inspect", "preview", "render"}:
            raise DataError("Usage: engine.py doctor | inspect INPUT | preview INPUT < config.json | render INPUT OUTPUT_DIR < config.json")
        command = sys.argv[1]
        required_args = 2 if command == "doctor" else (4 if command == "render" else 3)
        if len(sys.argv) != required_args:
            raise DataError("命令参数数量不正确。")
        if command == "doctor":
            print(json.dumps(doctor(), ensure_ascii=False, allow_nan=False))
            return 0
        table = read_table(sys.argv[2])
        if command == "inspect":
            result = inspect_table(table)
        else:
            raw_config = sys.stdin.read(100_001)
            if len(raw_config) > 100_000:
                raise DataError("配置过大。")
            try:
                config = json.loads(raw_config)
            except json.JSONDecodeError as exc:
                raise DataError(f"配置不是合法 JSON：{exc.msg}") from exc
            if command == "preview":
                prepared = prepare(table, config)
                result = {key: prepared[key] for key in ("preview", "outputColumns", "inputRows", "outputRows", "droppedRows", "steps", "warnings")}
            else:
                result = render(table, config, sys.argv[3])
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (DataError, OSError, ValueError, OverflowError, ImportError) as exc:
        print(f"分析失败：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
