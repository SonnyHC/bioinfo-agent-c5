import base64
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.analysis import analyze, MAX_FILE, DataError


class CloudAnalysisTests(unittest.TestCase):
    def request(self, content=b'sample,Control,Treatment\ns1,1,3\ns2,2,5\ns3,3,7\n', **extra):
        return {"name": "../../source.csv", "file": base64.b64encode(content).decode(), **extra}

    def test_isolated_workspace_cleaned_after_success_and_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            real = tempfile.TemporaryDirectory
            def workspace(**kwargs):
                return real(dir=folder, **kwargs)
            with patch('api.analysis.tempfile.TemporaryDirectory', side_effect=workspace):
                _, data = analyze(self.request(action='inspect'))
                self.assertEqual(json.loads(data)['rows'], 3)
                self.assertEqual(list(Path(folder).iterdir()), [])
                with self.assertRaises(DataError):
                    analyze(self.request(b'a,a\n1,2\n', action='inspect'))
                self.assertEqual(list(Path(folder).iterdir()), [])

    def test_preview_and_render_zip_contain_reproducible_actual_outputs(self):
        config = {"chart": "box", "layout": "wide", "valueColumns": ["Control", "Treatment"], "missing": "error"}
        _, preview = analyze(self.request(action='preview', config=config))
        self.assertEqual(json.loads(preview)['outputRows'], 6)
        kind, content = analyze(self.request(action='render', config=config))
        self.assertEqual(kind, 'application/zip')
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            self.assertTrue({'chart.svg', 'chart.png', 'chart.pdf', 'manifest.json', 'analysis.py', 'processed.csv', 'summary.json'} <= set(archive.namelist()))
            self.assertEqual(json.loads(archive.read('summary.json'))['rows'], 6)
            self.assertTrue(archive.read('chart.png').startswith(b'\x89PNG'))
            self.assertEqual(json.loads(archive.read('manifest.json'))['config']['valueColumns'], ['Control', 'Treatment'])

    def test_boundaries_reject_invalid_files_configs_and_actions(self):
        for body in [[], self.request(action='shell'), {"action": "inspect", "name": "data.csv", "file": "***"},
                     self.request(b'x' * (MAX_FILE + 1), action='inspect'), self.request(action='preview', config=[]),
                     {**self.request(action='inspect'), 'name': 'file.py'}]:
            with self.subTest(body=str(body)[:80]), self.assertRaises(DataError):
                analyze(body)

    def test_request_cannot_reuse_another_request_data(self):
        _, first = analyze(self.request(action='inspect'))
        _, second = analyze(self.request(b'name,value\nother,99\n', action='inspect'))
        self.assertNotEqual(json.loads(first)['sha256'], json.loads(second)['sha256'])
        with self.assertRaises(DataError):
            analyze({"action": "render", "name": "source.csv", "file": "", "config": {}})

    def test_source_hash_checked_before_cloud_render(self):
        with self.assertRaisesRegex(DataError, '发生改变'):
            analyze(self.request(action='render', config={"sourceSha256": "incorrect"}))


if __name__ == '__main__':
    unittest.main()
