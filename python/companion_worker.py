"""Local-only workflow worker. Model output is parameters, never executable code."""
from __future__ import annotations
import csv
import gzip
import hashlib
import importlib.metadata
import inspect
import json
import math
import os
from pathlib import Path
import sys
from datetime import datetime, timezone

os.environ.setdefault('MPLBACKEND', 'Agg')
from engine import DataError, inspect_table, read_table, prepare, render


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def kind(path):
    name = str(path).lower()
    if name.endswith(('.fastq', '.fq', '.fastq.gz', '.fq.gz')): return 'fastq'
    if name.endswith('.h5ad'): return 'single-cell'
    if name.endswith('.r'): return 'r-script'
    return 'tables'


def fastq_rows(path, limit):
    rows = []
    decoded_bytes = 0
    opener = gzip.open if str(path).lower().endswith('.gz') else open
    with opener(path, 'rt', encoding='ascii') as handle:
        for index in range(limit):
            header = handle.readline(1_000_002)
            if not header: break
            sequence, separator, quality = [handle.readline(1_000_002).rstrip('\r\n') for _ in range(3)]
            decoded_bytes += len(header) + len(sequence) + len(separator) + len(quality) + 3
            if decoded_bytes > 512 * 1024 * 1024:
                raise DataError('本次 FASTQ 前缀样本解压后超过 512 MiB；请减少 maxReads。')
            if max(len(header),len(sequence),len(separator),len(quality)) > 1_000_000 or not header.startswith('@') or not separator.startswith('+') or not sequence or len(sequence) != len(quality) or any(c.isspace() for c in sequence):
                raise DataError(f'第 {index + 1} 条 FASTQ 记录不完整或不符合四行格式。')
            scores = [ord(c) - 33 for c in quality]
            if any(q < 0 or q > 93 for q in scores): raise DataError('质量值不是 Phred+33 编码。')
            rows.append({'read': index + 1, 'length': len(sequence), 'mean_quality': sum(scores) / len(scores)})
        truncated = bool(handle.readline(1))
    if not rows: raise DataError('FASTQ 中没有读取到记录。')
    return rows, truncated


def open_h5ad(path):
    import anndata
    return anndata.read_h5ad(path, backed='r')


def profile(path):
    family = kind(path)
    if family == 'tables': return {**inspect_table(read_table(path)), 'kind': family}
    if family == 'fastq':
        rows, truncated = fastq_rows(path, 10)
        return {'kind': family, 'preview': rows, 'sampledReads': len(rows), 'hasMore': truncated,
                'columns': ['length', 'mean_quality'], 'note': '仅检查前 10 条，不代表全文件通过校验。生成时按参数读取并校验。'}
    if family == 'r-script':
        if Path(path).stat().st_size > 1024 * 1024: raise DataError('R 脚本上限为 1 MiB。')
        return {'kind': family, 'code': Path(path).read_text(encoding='utf-8'), 'note': 'R 文件是可执行脚本，不是数据表；执行前请阅读代码。'}
    data = open_h5ad(path)
    try:
        return {'kind': family, 'cells': data.n_obs, 'genes': data.n_vars,
                'embeddings': [key for key in data.obsm.keys() if len(data.obsm[key].shape) == 2 and data.obsm[key].shape[1] >= 2],
                'annotations': list(data.obs.columns), 'note': '使用已有嵌入的前两维，不重新计算 UMAP 或改变表达矩阵。'}
    finally: data.file.close()


def checked_int(value, default, low, high):
    if value is None or value == '': return default
    if isinstance(value, bool): raise DataError('数量参数必须是整数。')
    try: result = int(value)
    except (TypeError, ValueError): raise DataError('数量参数必须是整数。')
    if str(result) != str(value) or not low <= result <= high: raise DataError(f'数量必须介于 {low} 与 {high}。')
    return result


def convert(path, template, params):
    family = kind(path)
    if not isinstance(params, dict): raise DataError('参数必须是对象。')
    if family == 'tables':
        if template not in {'box','violin','scatter','histogram','bar','heatmap'}: raise DataError('图例与表格不匹配。')
        prepared = prepare(read_table(path), {**params, 'chart': template})
        return prepared['data'], prepared['config'], {key: prepared[key] for key in ('preview','outputColumns','inputRows','outputRows','droppedRows','steps','warnings')}
    if family == 'fastq':
        if template not in {'fastq-length','fastq-quality'}: raise DataError('请选择 FASTQ 质量图例。')
        if set(params) - {'maxReads','metric'}: raise DataError('FASTQ 图例仅支持 maxReads 参数。')
        count = checked_int(params.get('maxReads'), 10000, 1, 1000000)
        rows, truncated = fastq_rows(path, count)
        metric = 'length' if template == 'fastq-length' else 'mean_quality'
        return rows, {'maxReads': count, 'metric': metric}, {'preview':rows[:10], 'outputRows':len(rows), 'steps':[f'依文件顺序读取前 {count} 条记录并验证四行格式；Phred+33 编码。', f'提取 {metric}，输出新的绘图表。'], 'warnings':['这是文件前缀样本，不是随机抽样，也不是全文件统计。'] if truncated else [], 'truncated':truncated}
    if family != 'single-cell' or template != 'embedding': raise DataError('图例与文件不匹配。')
    if set(params) - {'embedding','color','maxCells'}: raise DataError('单细胞图例仅支持 embedding、color 与 maxCells 参数。')
    data = open_h5ad(path)
    try:
        embedding = params.get('embedding', 'X_umap')
        color = params.get('color', '')
        count = checked_int(params.get('maxCells'), 50000, 1, 200000)
        if embedding not in data.obsm: raise DataError('数据中没有所选嵌入；请先完成相应分析后导入。')
        coordinates = data.obsm[embedding][:count]
        if len(coordinates.shape) != 2 or coordinates.shape[1] < 2: raise DataError('嵌入至少需要两维。')
        if color and color not in data.obs.columns: raise DataError('着色字段不在细胞注释中。')
        annotations = data.obs[color].iloc[:count].astype(str).tolist() if color else ['All cells'] * len(coordinates)
        if len(set(annotations)) > 30: raise DataError('分类着色最多支持 30 类；请更换注释列。')
        rows = [{'cell':str(data.obs_names[i]), 'x':float(point[0]), 'y':float(point[1]), 'group':annotations[i]} for i,point in enumerate(coordinates)]
        if not rows or any(not math.isfinite(r['x']) or not math.isfinite(r['y']) for r in rows): raise DataError('嵌入为空或含非有限坐标。')
        return rows, {'embedding':embedding, 'color':color, 'maxCells':count}, {'preview':rows[:10], 'outputRows':len(rows), 'inputRows':data.n_obs, 'steps':[f'提取 {embedding} 前两维与注释 {color or "无"}，不读取完整表达矩阵。'], 'warnings':['只绘制前 N 个细胞，非随机抽样。'] if data.n_obs > count else []}
    finally: data.file.close()


def draw_local(rows, template, normalized, output):
    """Fixed plotting logic, also embedded verbatim in the exported analysis.py."""
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(8,6), layout='constrained')
    if template == 'embedding':
        for label in dict.fromkeys(row['group'] for row in rows):
            subset = [r for r in rows if r['group'] == label]
            ax.scatter([float(r['x']) for r in subset], [float(r['y']) for r in subset], s=4, alpha=.7, label=label, rasterized=True)
        ax.set(xlabel=f'{normalized["embedding"]} 1', ylabel=f'{normalized["embedding"]} 2'); ax.legend(frameon=False, markerscale=3, fontsize=7)
    else:
        metric = normalized['metric']; ax.hist([float(r[metric]) for r in rows], bins=40, color='#217A72')
        ax.set(xlabel='Read length (nt)' if metric == 'length' else 'Mean read quality (Phred+33)', ylabel='Read count')
    for extension in ('png','svg','pdf'): fig.savefig(output / f'chart.{extension}', dpi=180)
    plt.close(fig)


def execute(path, template, params, output):
    if kind(path) == 'tables':
        return render(read_table(path), {**params, 'chart':template}, output)
    rows, normalized, preview = convert(path, template, params)
    output = Path(output)
    if output.exists() and any(output.iterdir()): raise DataError('输出目录必须为空。')
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'processed.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    draw_local(rows, template, normalized, output)
    versions = {name:importlib.metadata.version(name) for name in ('numpy','matplotlib')}
    manifest = {'schemaVersion':1, 'createdAt':datetime.now(timezone.utc).isoformat(), 'inputSha256':digest(path), 'template':template, 'parameters':normalized, 'preview':preview, 'rows':len(rows), 'processedSha256':digest(output/'processed.csv'), 'dependencies':versions, 'pythonVersion':sys.version.split()[0], 'reproduction':'python analysis.py [OUTPUT_DIR] reproduces the figure from processed.csv, without modifying source FASTQ/H5AD.'}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    preamble = '#!/usr/bin/env python3\n"""Reproduce the exported figure from the reviewed processed.csv."""\nimport csv\nimport hashlib\nimport json\nimport os\nimport sys\nfrom pathlib import Path\nos.environ.setdefault("MPLBACKEND", "Agg")\n\n'
    entrypoint = '''
if __name__ == '__main__':
    base = Path(__file__).resolve().parent
    manifest = json.loads((base / 'manifest.json').read_text(encoding='utf-8'))
    data = base / 'processed.csv'
    if hashlib.sha256(data.read_bytes()).hexdigest() != manifest['processedSha256']:
        raise SystemExit('processed.csv changed; create a new analysis for modified data.')
    target = Path(sys.argv[1]) if len(sys.argv)>1 else base / 'reproduced'
    if target.exists() and any(target.iterdir()): raise SystemExit('Output directory must be empty.')
    with data.open(encoding='utf-8', newline='') as handle: rows = list(csv.DictReader(handle))
    draw_local(rows, manifest['template'], manifest['parameters'], target)
    print(json.dumps({'rows':len(rows), 'output':str(target)}))
'''
    (output/'analysis.py').write_text(preamble+inspect.getsource(draw_local)+entrypoint, encoding='utf-8')
    (output/'requirements.txt').write_text(''.join(f'{name}=={version}\n' for name,version in versions.items()), encoding='utf-8')
    return {'rows':len(rows), 'warnings':preview['warnings']}


def main():
    request = json.load(sys.stdin)
    action = request['action']
    if action == 'legacy':
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from api.analysis import analyze
        import base64
        mime, content = analyze(request['body'])
        return {'mime':mime, 'content':base64.b64encode(content).decode()}
    path = request['path']
    if action == 'inspect': return profile(path)
    if request.get('sha256') != digest(path): raise DataError('源文件已改变，请重新导入和确认。')
    if action == 'preview':
        _, normalized, preview = convert(path, request['template'], request['params'])
        return {'params':normalized, **preview}
    if action == 'render': return execute(path, request['template'], request['params'], request['output'])
    raise DataError('未知操作。')


if __name__ == '__main__':
    try: print(json.dumps(main(), ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(str(error), file=sys.stderr); sys.exit(1)
