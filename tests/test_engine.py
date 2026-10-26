"""Scientific-data contract tests; run: python -m unittest discover -s tests."""
from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("c5_engine", ROOT / "python" / "engine.py")
engine = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(engine)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def data(self, contents: str, name="input.csv") -> Path:
        path = self.base / name
        path.write_text(contents, encoding="utf-8")
        return path

    def read(self, contents: str, name="input.csv"):
        return engine.read_table(self.data(contents, name))

    def test_wide_and_long_preserve_identical_observations(self):
        wide = engine.prepare(engine.read_table(ROOT / "examples" / "wide.csv"), {"chart": "box", "layout": "wide", "valueColumns": ["Control", "Treatment"]})
        long = engine.prepare(engine.read_table(ROOT / "examples" / "long.csv"), {"chart": "box", "group": "group", "y": "expression"})
        self.assertEqual(wide["data"], long["data"])
        self.assertEqual(wide["groups"], {"Control": 6, "Treatment": 6})
        self.assertEqual(wide["outputRows"], 12)
        self.assertEqual(wide["droppedRows"], 0)

    def test_wide_ignores_hidden_long_mappings_and_labels_actual_axes(self):
        table = engine.read_table(ROOT / "examples" / "wide.csv")
        config = {"chart": "box", "layout": "wide", "valueColumns": ["Control", "Treatment"], "group": "sample", "y": "Control", "x": "unused_column"}
        target = self.base / "wide-labels"
        engine.render(table, config, target)
        manifest = json.loads((target / "manifest.json").read_text())
        self.assertEqual(manifest["plot"]["axisLabels"], {"x": "Group", "y": "Value"})
        self.assertEqual({key: manifest["config"][key] for key in ("x", "y", "group")}, {"x": "", "y": "", "group": ""})
        self.assertEqual(manifest["config"]["valueColumns"], ["Control", "Treatment"])
        override = {**config, "xLabel": "Experimental groups", "yLabel": "Expression (a.u.)"}
        engine.render(table, override, self.base / "explicit-labels")
        explicit = json.loads((self.base / "explicit-labels" / "manifest.json").read_text())
        self.assertEqual(explicit["plot"]["axisLabels"], {"x": "Experimental groups", "y": "Expression (a.u.)"})
        for chart in ("violin", "bar"):
            prepared = engine.prepare(table, {**config, "chart": chart})
            self.assertEqual(prepared["config"]["group"], "")
            self.assertEqual(prepared["config"]["y"], "")

    def test_missing_is_rejected_until_user_selects_drop(self):
        table = self.read("group,value\nControl,0\nControl,\nTreated,4\n")
        with self.assertRaisesRegex(engine.DataError, "缺失列：value"):
            engine.prepare(table, {"chart": "box", "group": "group", "y": "value"})
        result = engine.prepare(table, {"chart": "box", "group": "group", "y": "value", "missing": "drop"})
        self.assertEqual(result["data"], [{"group": "Control", "value": 0.0}, {"group": "Treated", "value": 4.0}])
        self.assertEqual(result["droppedRows"], 1)
        self.assertEqual(result["exclusions"][0]["sourceRow"], 3)

    def test_wide_drop_records_each_removed_observation(self):
        result = engine.prepare(self.read("A,B\n0,\n,2\n"), {"chart": "box", "layout": "wide", "valueColumns": ["A", "B"], "missing": "drop"})
        self.assertEqual(result["outputRows"], 2)
        self.assertEqual(result["droppedRows"], 2)
        self.assertEqual([row["value"] for row in result["data"]], [0.0, 2.0])
        self.assertEqual(len(result["exclusions"]), 2)

    def test_duplicate_columns_and_repeated_headers_rejected(self):
        with self.assertRaisesRegex(engine.DataError, "重复列名"):
            self.read("value,value\n1,2\n")
        with self.assertRaisesRegex(engine.DataError, "重复了表头"):
            self.read("group,value\nA,1\ngroup,value\n")

    def test_ragged_and_blank_rows_not_silently_discarded(self):
        with self.assertRaisesRegex(engine.DataError, "第 2 行有 3 列，表头有 2 列"):
            self.read("a,b\n1,2,3\n")
        with self.assertRaisesRegex(engine.DataError, "第 3 行有 0 列，表头有 2 列"):
            self.read("a,b\n1,2\n\n")

    def test_nonfinite_values_rejected_in_input(self):
        for token in ("NaN", "Infinity", "-inf", "1e999"):
            with self.subTest(token=token), self.assertRaises(engine.DataError):
                self.read(f"group,value\nA,{token}\n")

    def test_pseudo_numeric_values_never_coerced_or_dropped(self):
        for token in ("2 mg", "abc", "1,000"):
            table = self.read(f'group,value\nA,"{token}"\n')
            with self.subTest(token=token), self.assertRaisesRegex(engine.DataError, "不是有效数值"):
                engine.prepare(table, {"chart": "box", "group": "group", "y": "value", "missing": "drop"})

    def test_bom_tsv_and_zero_detection(self):
        table = self.read("\ufeffgroup\tvalue\nA\t0\nB\t1.5\n", "input.tsv")
        result = engine.inspect_table(table)
        self.assertEqual(result["columns"][1], {"name": "value", "type": "number", "missing": 0})
        self.assertEqual(result["preview"][0]["value"], "0")

    def test_original_preview_retains_numeric_looking_identifiers(self):
        table = self.read("sample,value\n001,1.20\n002,0\n")
        inspected = engine.inspect_table(table)
        self.assertEqual(inspected["preview"][0], {"sample": "001", "value": "1.20"})
        self.assertEqual(inspected["columns"][0]["type"], "number")

    def test_group_labels_not_automatically_merged(self):
        table = self.read("group,value\nA,1\n A,2\na,3\n")
        result = engine.prepare(table, {"group": "group", "y": "value"})
        self.assertEqual(result["groups"], {"A": 1, " A": 1, "a": 1})

    def test_violin_requires_multiple_nonconstant_values(self):
        for contents in ("group,value\nA,1\n", "group,value\nA,1\nA,1\n"):
            with self.assertRaisesRegex(engine.DataError, "非恒定"):
                engine.prepare(self.read(contents), {"chart": "violin", "group": "group", "y": "value"})

    def test_heatmap_keeps_raw_matrix_and_rejects_silent_truncation(self):
        table = engine.read_table(ROOT / "examples" / "expression.csv")
        result = engine.prepare(table, {"chart": "heatmap", "x": "gene", "valueColumns": ["Control_1", "Treatment_1"]})
        self.assertEqual(result["data"][0], {"row_label": "GENE_A", "Control_1": 8.1, "Treatment_1": 12.5})
        large = self.read("value\n" + "\n".join(str(number) for number in range(51)))
        with self.assertRaisesRegex(engine.DataError, "热图有 51 行，最多支持 50 行"):
            engine.prepare(large, {"chart": "heatmap", "valueColumns": ["value"]})

    def test_excel_formula_rejected_and_first_sheet_reported(self):
        from openpyxl import Workbook

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "First"
        sheet.append(["group", "value"])
        sheet.append(["A", "=1+2"])
        path = self.base / "formula.xlsx"
        workbook.save(path)
        with self.assertRaisesRegex(engine.DataError, "含公式"):
            engine.read_table(path)
        sheet["B2"] = 3
        workbook.create_sheet("Ignored").append(["do not use"])
        workbook.save(path)
        table = engine.read_table(path)
        self.assertEqual(table["values"], [{"group": "A", "value": 3}])
        self.assertIn("First", table["warnings"][0])
        self.assertIn("第一个工作表", table["warnings"][0])
        workbook.close()

    def test_formula_style_csv_text_rejected(self):
        for text in ("=1+2", "@cmd", "+cmd", "-cmd"):
            with self.subTest(text=text), self.assertRaisesRegex(engine.DataError, "公式样式"):
                self.read(f"group,value\n{text},3\n")
            with self.subTest(header=text), self.assertRaisesRegex(engine.DataError, "公式样式"):
                self.read(f"group,{text}\nA,3\n")
        self.assertEqual(self.read("group,value\nA,-3\n")["values"][0]["value"], "-3")

    def test_limits_and_empty_files(self):
        with self.assertRaisesRegex(engine.DataError, "文件为空"):
            self.read("")
        with self.assertRaisesRegex(engine.DataError, "只有表头"):
            self.read("a,b\n")
        with self.assertRaisesRegex(engine.DataError, "100 列"):
            self.read(",".join(f"x{n}" for n in range(101)) + "\n")
        path = self.base / "large.csv"
        with path.open("wb") as handle:
            handle.truncate(engine.MAX_BYTES + 1)
        with self.assertRaisesRegex(engine.DataError, "10 MiB"):
            engine.read_table(path)

    def test_approval_hash_and_metadata_boundary(self):
        table = self.read("group,value\nA,1\n")
        with self.assertRaisesRegex(engine.DataError, "已发生改变"):
            engine.prepare(table, {"group": "group", "y": "value", "sourceSha256": "different"})
        prepared = engine.prepare(table, {"group": "group", "y": "value", "sourceSha256": table["sha256"], "datasetId": "private-id", "status": "confirmed"})
        self.assertNotIn("datasetId", prepared["config"])
        self.assertNotIn("sourceSha256", prepared["config"])

    def test_render_exports_and_reproduces_without_changing_source(self):
        source = ROOT / "examples" / "long.csv"
        before = source.read_bytes()
        output = self.base / "result"
        table = engine.read_table(source)
        result = engine.render(table, {"chart": "box", "group": "group", "y": "expression", "title": "Synthetic measurements"}, output)
        self.assertEqual(result, {"rows": 12, "groups": 2, "groupCounts": {"Control": 6, "Treatment": 6}})
        for name in ("chart.png", "chart.svg", "chart.pdf", "processed.csv", "analysis.py", "manifest.json", "requirements.txt"):
            self.assertGreater((output / name).stat().st_size, 20, name)
        self.assertEqual(source.read_bytes(), before)
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["inputSha256"], hashlib.sha256(before).hexdigest())
        self.assertNotIn(str(ROOT), json.dumps(manifest))
        with (output / "processed.csv").open(newline="") as handle:
            observations = list(csv.DictReader(handle))
        self.assertEqual([float(row["value"]) for row in observations[:6]], [8.1, 9.2, 7.8, 10.1, 8.9, 9.4])
        replay = subprocess.run([sys.executable, str(output / "analysis.py")], capture_output=True, text=True, timeout=60)
        self.assertEqual(replay.returncode, 0, replay.stderr)
        self.assertEqual(json.loads(replay.stdout)["rows"], 12)
        for extension in ("png", "svg", "pdf"):
            self.assertTrue((output / "reproduced" / f"chart.{extension}").is_file())
        # Same fixed function, parameters, data and RNG produce identical pixels.
        self.assertEqual((output / "chart.png").read_bytes(), (output / "reproduced" / "chart.png").read_bytes())
        (output / "processed.csv").write_text("group,value\nchanged,99\n")
        modified = subprocess.run([sys.executable, str(output / "analysis.py"), str(output / "new")], capture_output=True, text=True, timeout=60)
        self.assertNotEqual(modified.returncode, 0)
        self.assertIn("differs", modified.stderr)

    def test_each_fixed_plot_produces_real_files(self):
        table = engine.read_table(ROOT / "examples" / "long.csv")
        cases = {
            "violin": {"chart": "violin", "group": "group", "y": "expression"},
            "bar": {"chart": "bar", "group": "group", "y": "expression"},
            "scatter": {"chart": "scatter", "x": "expression", "y": "expression", "group": "group"},
            "histogram": {"chart": "histogram", "y": "expression", "group": "group"},
            "heatmap": {"chart": "heatmap", "x": "sample", "valueColumns": ["expression"]},
        }
        for name, config in cases.items():
            with self.subTest(chart=name):
                engine.render(table, config, self.base / name)
                self.assertTrue((self.base / name / "chart.png").read_bytes().startswith(b"\x89PNG"))
                manifest = json.loads((self.base / name / "manifest.json").read_text())
                self.assertEqual(manifest["plot"]["statisticalTests"], "none")
                self.assertTrue(manifest["plot"]["allObservationsPlotted"])
        bar = json.loads((self.base / "bar" / "manifest.json").read_text())
        self.assertAlmostEqual(bar["plot"]["groupMeans"]["Control"], 8.916666666666666)

    def test_style_validation_is_bounded_and_template_specific(self):
        table = self.read("group,value\nA,1\nA,2\n")
        config = {"chart": "box", "group": "group", "y": "value"}
        invalid = [{"dpi": 0}, {"dpi": 100.5}, {"dpi": True}, {"width": 99}, {"height": 0},
                   {"fontSize": 25}, {"pointSize": 101}, {"alpha": 0}, {"alpha": float("nan")},
                   {"palette": "not-a-palette"}, {"title": "bad\ntext"}, {"xLabel": "x" * 161},
                   {"fontSize": "12"}, {"width": 16, "height": 16, "dpi": 600}]
        for patch in invalid:
            with self.subTest(patch=patch), self.assertRaises(engine.DataError):
                engine.prepare(table, {**config, **patch})
        for chart in ("histogram", "heatmap"):
            with self.subTest(chart=chart), self.assertRaisesRegex(engine.DataError, "pointSize"):
                engine.prepare(table, {"chart": chart, "y": "value", "valueColumns": ["value"], "pointSize": 10})
        with self.assertRaisesRegex(engine.DataError, "palette"):
            engine.prepare(table, {"chart": "heatmap", "valueColumns": ["value"], "palette": "colorblind"})
        normalized = engine.prepare(table, config)["config"]
        self.assertEqual(normalized["pointSize"], 19)
        self.assertEqual(normalized["dpi"], 200)
        self.assertEqual(normalized["palette"], "colorblind")
        for patch in ({"palette": "teal"}, {"palette": "tab10"}):
            with self.assertRaisesRegex(engine.DataError, "palette"):
                engine.prepare(table, {**config, **patch})

    def test_automatic_size_uses_reviewed_group_count_and_remaining_heatmap_rows(self):
        table = self.read("group,value\n" + "\n".join(f"G{i},{i}" for i in range(12)))
        prepared = engine.prepare(table, {"group":"group","y":"value"})
        self.assertAlmostEqual(prepared["config"]["width"],10.4)
        manual = engine.prepare(table,{"group":"group","y":"value","width":6})
        self.assertEqual(manual["config"]["width"],6)
        matrix = self.read("value\n" + "1\n" * 20 + '""\n' * 20)
        prepared = engine.prepare(matrix,{"chart":"heatmap","valueColumns":["value"],"missing":"drop"})
        self.assertAlmostEqual(prepared["config"]["height"],6.4)

    def test_every_style_control_changes_export_and_preserves_processed_data(self):
        table = self.read("group,value\nA,1\nA,3\nB,2\nB,5\n")
        base = {"chart": "box", "group": "group", "y": "value", "width": 4, "height": 3, "dpi": 72}
        baseline = self.base / "baseline"
        engine.render(table, base, baseline)
        pixels = (baseline / "chart.png").read_bytes()
        data = (baseline / "processed.csv").read_bytes()
        changes = {"title": "Edited measurements", "xLabel": "Experiment", "yLabel": "Response",
                   "palette": "plasma", "fontSize": 14, "pointSize": 70, "alpha": 0.25,
                   "width": 5, "height": 4, "dpi": 144}
        for key, value in changes.items():
            with self.subTest(parameter=key):
                target = self.base / key
                engine.render(table, {**base, key: value}, target)
                self.assertNotEqual((target / "chart.png").read_bytes(), pixels)
                self.assertEqual((target / "processed.csv").read_bytes(), data)
                manifest = json.loads((target / "manifest.json").read_text())
                self.assertEqual(manifest["config"][key], value)
        dimensions = struct.unpack(">II", (self.base / "dpi/chart.png").read_bytes()[16:24])
        self.assertEqual(dimensions, (576, 432))
        # The edited export reproduces the actual new pixels, without relying on
        # the source tree or loading an old run's plotting configuration.
        replay = subprocess.run([sys.executable, str(self.base / "palette/analysis.py")], capture_output=True, text=True, timeout=60)
        self.assertEqual(replay.returncode, 0, replay.stderr)
        self.assertEqual((self.base / "palette/chart.png").read_bytes(), (self.base / "palette/reproduced/chart.png").read_bytes())
        self.assertEqual((baseline / "chart.png").read_bytes(), pixels)

    def test_bar_limits_include_all_raw_extremes_and_zero(self):
        table = self.read("group,value\nA,-10\nA,100\nB,2\nB,3\n")
        engine.render(table, {"chart": "bar", "group": "group", "y": "value"}, self.base / "extremes")
        manifest = json.loads((self.base / "extremes" / "manifest.json").read_text())
        lower, upper = manifest["plot"]["axisLimits"]["y"]
        self.assertLess(lower, -10)
        self.assertGreater(upper, 100)
        self.assertLessEqual(lower, 0)
        self.assertGreaterEqual(upper, 0)

    def test_cli_json_and_error_exit_contract(self):
        path = self.data("group,value\nA,0\n")
        command = [sys.executable, str(ROOT / "python" / "engine.py")]
        inspected = subprocess.run([*command, "inspect", str(path)], capture_output=True, text=True, timeout=30)
        self.assertEqual(inspected.returncode, 0, inspected.stderr)
        self.assertEqual(json.loads(inspected.stdout)["rows"], 1)
        failed = subprocess.run([*command, "preview", str(path)], input='{"chart":"scatter"}', capture_output=True, text=True, timeout=30)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(failed.stdout, "")
        self.assertIn("必须指定", failed.stderr)

    def test_doctor_checks_real_dependencies_and_reports_missing_runtime(self):
        command = [sys.executable, str(ROOT / "python" / "engine.py"), "doctor"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ready"])
        self.assertEqual(set(payload["versions"]), {"numpy", "pandas", "matplotlib", "openpyxl"})
        self.assertEqual(payload["pythonVersion"], sys.version.split()[0])
        self.assertTrue(all(payload["versions"].values()))
        # -S removes site-packages: CSV inspection would still work, but a
        # truthful analysis-readiness probe must fail and identify the package.
        unavailable = subprocess.run([sys.executable, "-S", *command[1:]], capture_output=True, text=True, timeout=30)
        self.assertNotEqual(unavailable.returncode, 0)
        self.assertEqual(unavailable.stdout, "")
        self.assertIn("numpy", unavailable.stderr)
        self.assertIn("setup:python", unavailable.stderr)


if __name__ == "__main__":
    unittest.main()
