"""Local bioinformatics formats and reproducible-output contracts."""
from __future__ import annotations
import gzip
import importlib.util
import json
import struct
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
import companion_worker as worker


class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def fastq(self, name='sample.fastq'):
        content = '@read1\nACGT\n+\nIIII\n@read2\nAA\n+\n!!\n'
        target = self.base / name
        if name.endswith('.gz'):
            with gzip.open(target, 'wt', encoding='ascii') as handle: handle.write(content)
        else: target.write_text(content)
        return target

    def test_fastq_quality_length_and_prefix_sampling(self):
        path = self.fastq('sample.fastq.gz')
        rows, config, result = worker.convert(path, 'fastq-quality', {'maxReads':1})
        self.assertEqual(rows[0], {'read':1, 'length':4, 'mean_quality':40.0})
        self.assertEqual(config['metric'], 'mean_quality')
        self.assertTrue(result['truncated'])
        self.assertIn('不是随机抽样', result['warnings'][0])
        rows, _, result = worker.convert(path, 'fastq-length', {'maxReads':10})
        self.assertEqual([row['length'] for row in rows], [4,2])
        self.assertFalse(result['truncated'])

    def test_malformed_fastq_and_unapproved_parameters_are_rejected(self):
        path = self.base / 'broken.fastq'
        for content in ['@a\nACG\n+\nII\n', 'not-header\nAC\n+\nII\n', '@a\nA C\n+\nIII\n']:
            path.write_text(content)
            with self.assertRaises(worker.DataError): worker.fastq_rows(path, 10)
        path = self.fastq()
        for value in [0, 1000001, 1.5, True, '1.5']:
            with self.assertRaises(worker.DataError): worker.convert(path, 'fastq-length', {'maxReads':value})
        with self.assertRaises(worker.DataError): worker.convert(path, 'fastq-length', {'code':'anything'})

    def test_fastq_exports_reproducible_script_and_detects_modified_processed_data(self):
        path = self.fastq()
        before = path.read_bytes()
        output = self.base / 'result'
        summary = worker.execute(path, 'fastq-quality', {'maxReads':10}, output)
        self.assertEqual(summary['rows'], 2)
        for name in ['chart.png','chart.svg','chart.pdf','manifest.json','processed.csv','analysis.py','requirements.txt']:
            self.assertGreater((output/name).stat().st_size, 0)
        replay = subprocess.run([sys.executable,str(output/'analysis.py')],capture_output=True,text=True)
        self.assertEqual(replay.returncode,0,replay.stderr)
        self.assertTrue((output/'reproduced/chart.png').is_file())
        self.assertEqual(path.read_bytes(),before)
        with (output/'processed.csv').open('a') as handle: handle.write('3,1,2\n')
        changed = subprocess.run([sys.executable,str(output/'analysis.py'),str(output/'changed')],capture_output=True,text=True)
        self.assertNotEqual(changed.returncode,0)
        self.assertIn('processed.csv changed',changed.stderr)

    def test_worker_rejects_source_changed_since_review(self):
        path = self.fastq()
        request = {'action':'preview','path':str(path),'sha256':'0'*64,'template':'fastq-length','params':{}}
        result = subprocess.run([sys.executable,str(ROOT/'python/companion_worker.py')],input=json.dumps(request),capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('源文件已改变',result.stderr)

    def test_fastq_style_defaults_validation_and_edited_export(self):
        path = self.fastq()
        _, defaults, _ = worker.convert(path, 'fastq-length', {})
        self.assertEqual(defaults['width'],8)
        self.assertEqual(defaults['palette'],'teal')
        self.assertEqual(defaults['dpi'],180)
        self.assertEqual(defaults['alpha'],1)
        self.assertNotIn('pointSize',defaults)
        for patch in ({'pointSize':4},{'dpi':100.5},{'palette':'bad'},{'palette':'tab10'},{'alpha':0}):
            with self.subTest(params=patch), self.assertRaises(worker.DataError):
                worker.convert(path,'fastq-length',patch)
        original = self.base/'original'
        edited = self.base/'edited'
        worker.execute(path,'fastq-length',{},original)
        changes = {'title':'Read size audit','xLabel':'Nucleotides','yLabel':'Observed reads','palette':'plasma','fontSize':14,'alpha':0.5,'width':4,'height':3,'dpi':100}
        worker.execute(path,'fastq-length',changes,edited)
        self.assertNotEqual((original/'chart.png').read_bytes(),(edited/'chart.png').read_bytes())
        self.assertEqual((original/'processed.csv').read_bytes(),(edited/'processed.csv').read_bytes())
        self.assertEqual(struct.unpack('>II',(edited/'chart.png').read_bytes()[16:24]),(400,300))
        manifest = json.loads((edited/'manifest.json').read_text())
        self.assertEqual({key:manifest['parameters'][key] for key in changes},changes)
        self.assertEqual(manifest['plot']['axisLabels'],{'x':'Nucleotides','y':'Observed reads'})
        replay=subprocess.run([sys.executable,str(edited/'analysis.py')],capture_output=True,text=True)
        self.assertEqual(replay.returncode,0,replay.stderr)
        self.assertEqual((edited/'chart.png').read_bytes(),(edited/'reproduced/chart.png').read_bytes())

    def test_table_worker_rejects_unknown_parameters(self):
        path=self.base/'table.csv'
        path.write_text('group,value\nA,1\nA,2\n')
        with self.assertRaisesRegex(worker.DataError,'不支持的参数'):
            worker.convert(path,'box',{'group':'group','y':'value','code':'ignored-code'})

    def test_embedding_presentation_uses_point_palette_and_size_controls(self):
        rows=[{'cell':'a','x':0,'y':1,'group':'A'},{'cell':'b','x':1,'y':0,'group':'B'}]
        before=json.dumps(rows)
        base={'embedding':'X_umap','color':'celltype',**worker.normalize_style({'width':4,'height':3,'dpi':100},'embedding')}
        original=self.base/'embedding-original'
        worker.draw_local(rows,'embedding',base,original)
        for key,value in {'pointSize':80,'alpha':0.2,'palette':'plasma','fontSize':16,'title':'Cell atlas'}.items():
            with self.subTest(parameter=key):
                target=self.base/f'embedding-{key}'
                worker.draw_local(rows,'embedding',{**base,key:value},target)
                self.assertNotEqual((original/'chart.png').read_bytes(),(target/'chart.png').read_bytes())
        self.assertEqual(before,json.dumps(rows))
        self.assertEqual(struct.unpack('>II',(original/'chart.png').read_bytes()[16:24]),(400,300))

    @unittest.skipUnless(importlib.util.find_spec('anndata'), 'Install single-cell skill requirements for real H5AD validation')
    def test_h5ad_uses_existing_embedding_and_preserves_source(self):
        import anndata
        import numpy as np
        import pandas as pd
        data = anndata.AnnData(X=np.array([[1,2],[3,4],[5,6]]),obs=pd.DataFrame({'celltype':['A','B','A']},index=['c1','c2','c3']))
        data.obsm['X_umap'] = np.array([[0.1,1.1],[2.1,3.1],[4.1,5.1]])
        path = self.base/'cells.h5ad';data.write_h5ad(path)
        before = worker.digest(path)
        profile = worker.profile(path)
        self.assertEqual(profile['cells'],3);self.assertIn('X_umap',profile['embeddings'])
        rows, params, preview = worker.convert(path,'embedding',{'embedding':'X_umap','color':'celltype','maxCells':2})
        self.assertEqual([r['cell'] for r in rows],['c1','c2'])
        self.assertEqual(rows[0]['x'],0.1);self.assertTrue(preview['warnings'])
        self.assertEqual(params['palette'],'tab10')
        self.assertEqual(params['dpi'],180)
        with self.assertRaises(worker.DataError): worker.convert(path,'embedding',{'embedding':'not_present'})
        changes={'title':'Cell annotations','palette':'plasma','pointSize':30,'fontSize':12,'alpha':0.4,'width':4,'height':3,'dpi':100,'xLabel':'UMAP one','yLabel':'UMAP two'}
        output=self.base/'h5ad-result';worker.execute(path,'embedding',{**params,**changes},output)
        self.assertEqual(worker.digest(path),before)
        replay=subprocess.run([sys.executable,str(output/'analysis.py')],capture_output=True,text=True)
        self.assertEqual(replay.returncode,0,replay.stderr)
        self.assertTrue((output/'reproduced/chart.pdf').is_file())
        self.assertEqual((output/'chart.png').read_bytes(),(output/'reproduced/chart.png').read_bytes())
        self.assertEqual(struct.unpack('>II',(output/'chart.png').read_bytes()[16:24]),(400,300))
        manifest=json.loads((output/'manifest.json').read_text())
        self.assertEqual(manifest['parameters']['color'],'celltype')
        self.assertEqual(manifest['parameters']['palette'],'plasma')
        self.assertEqual(manifest['plot']['axisLabels'],{'x':'UMAP one','y':'UMAP two'})


if __name__ == '__main__': unittest.main()
