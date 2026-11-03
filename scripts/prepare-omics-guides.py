#!/usr/bin/env python3
"""Arrange the supplied Markdown tutorials without rewriting their contents.

Run independently after editing the checked-in source Markdown or import
``prepare_guides`` from the full V1.0 asset build. Source spans are 1-based and
inclusive. Every nonempty source line must appear in at least one tutorial.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'docs/tutorial-sources'
OUT = ROOT / 'web/public/resources/v1'
QC = '01_过滤、整合与聚类.md'
REVIEW = '02_细胞注释.md'
DIFFERENTIAL = '03_差异表达与功能富集分析.md'
ANNOTATION = '04_细胞注释.md'

# Shared headings, the original summary and closing advice appear in both
# split tutorials. Q5's individual list items follow their respective topics.
GUIDES = [
    {
        'id': 'qc-integration', 'title': '过滤、整合与聚类',
        'summary': '过滤指标与策略、整合方法、聚类调参与排错。',
        'spans': [(QC, 1, 54)],
    },
    {
        'id': 'cell-annotation', 'title': '细胞注释',
        'summary': '从理论基础、注释策略与实操，到注意事项和结果解读。',
        'spans': [(ANNOTATION, 1, 90), (REVIEW, 1, 21)],
    },
    {
        'id': 'differential-analysis', 'title': '差异分析',
        'summary': '分析方法与参数、差异表达结果解读及常见问题。',
        'spans': [(DIFFERENTIAL, start, end) for start, end in [
            (1, 28), (59, 93), (131, 156), (163, 165),
            (167, 174), (179, 184),
        ]],
    },
    {
        'id': 'enrichment-analysis', 'title': '富集分析',
        'summary': 'ORA 与 GSEA、数据库与参数、富集结果解读及常见问题。',
        'spans': [(DIFFERENTIAL, start, end) for start, end in [
            (29, 60), (94, 136), (157, 164), (166, 166),
            (175, 182), (185, 185),
        ]],
    },
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def document(title, lines):
    # Only heading depth and document whitespace change; all words, list
    # numbering, inline markup, table cells and link destinations stay intact.
    body = '\n'.join(re.sub(r'^(#{1,5})(?= )', r'#\1', line) for line in lines)
    return '# ' + title + '\n\n' + body.strip('\n') + '\n'


def assemble_guides():
    originals = {name: (SOURCES / name).read_bytes()
                 for name in [QC, REVIEW, DIFFERENTIAL, ANNOTATION]}
    lines = {name: data.decode('utf-8').splitlines() for name, data in originals.items()}
    coverage = {name: set() for name in originals}
    guides, mappings = [], []
    for definition in GUIDES:
        selected, source_names, spans = [], [], []
        for name, start, end in definition['spans']:
            if not 1 <= start <= end <= len(lines[name]):
                raise ValueError(f'Invalid source range: {name}:{start}-{end}')
            if selected and selected[-1] != '':
                selected.append('')
            selected.extend(lines[name][start - 1:end])
            coverage[name].update(range(start, end + 1))
            if name not in source_names:
                source_names.append(name)
            spans.append({'source': name, 'startLine': start, 'endLine': end})
        markdown = document(definition['title'], selected)
        guides.append({key: definition[key] for key in ['id', 'title', 'summary']} | {
            'source': ' → '.join(source_names), 'markdown': markdown,
        })
        mappings.append({'id': definition['id'], 'spans': spans,
                         'markdownSha256': sha(markdown.encode('utf-8'))})
    source_records = []
    for name, source_lines in lines.items():
        required = {number for number, line in enumerate(source_lines, 1) if line.strip()}
        missing = sorted(required - coverage[name])
        if missing:
            raise ValueError(f'Unmapped source lines in {name}: {missing}')
        source_records.append({
            'file': name, 'bytes': len(originals[name]), 'sha256': sha(originals[name]),
            'lineCount': len(source_lines), 'nonemptyLines': len(required),
            'coveredNonemptyLines': len(required & coverage[name]),
        })
    mapping = {
        'sourceDirectory': 'docs/tutorial-sources',
        'transformation': 'Original wording retained; source headings shifted down one level. Shared summary, headings and closing advice are retained in both split tutorials.',
        'sources': source_records, 'guides': mappings,
    }
    return guides, originals, mapping


def archive_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 3, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return stream.getvalue()


def prepare_guides():
    guides, originals, mapping = assemble_guides()
    (ROOT / 'web/src/data/omics-guides.json').write_text(json_text(guides), encoding='utf-8')
    (ROOT / 'docs/tutorial-source-map.json').write_text(json_text(mapping), encoding='utf-8')
    folder = OUT / 'guides'
    folder.mkdir(parents=True, exist_ok=True)
    files = {}
    for guide in guides:
        name = guide['id'] + '.md'
        files[name] = guide['markdown'].encode('utf-8')
        (folder / name).write_bytes(files[name])
    # These superseded downloads have no remaining links after the four-topic
    # reorganization. Raw original files remain available inside the archive.
    for obsolete in ['annotation-practice.md', 'annotation-review.md', 'differential-enrichment.md']:
        (folder / obsolete).unlink(missing_ok=True)
    files.update({'originals/' + name: data for name, data in originals.items()})
    archive = archive_bytes(files)
    (OUT / 'guides-reproduction.zip').write_bytes(archive)
    return {'url': '/resources/v1/guides-reproduction.zip', 'bytes': len(archive), 'sha256': sha(archive)}


def main():
    resource = prepare_guides()
    for path in [OUT / 'manifest.json', ROOT / 'web/src/data/omics-manifest.json']:
        manifest = json.loads(path.read_text(encoding='utf-8'))
        manifest['packages']['guides'] = resource
        path.write_text(json_text(manifest), encoding='utf-8')
    mapping = json.loads((ROOT / 'docs/tutorial-source-map.json').read_text(encoding='utf-8'))
    print(json_text({'guides': len(mapping['guides']),
                     'coveredSourceLines': sum(source['coveredNonemptyLines'] for source in mapping['sources']),
                     'package': resource}), end='')


if __name__ == '__main__':
    main()
