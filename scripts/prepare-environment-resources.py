#!/usr/bin/env python3
"""Package the four supplied environments without changing their file contents.

Usage: python3 scripts/prepare-environment-resources.py /path/to/V1.0.zip
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'web/public/resources/v1/environments'
CATALOG = ROOT / 'web/src/data/environment-resources.json'
ENVIRONMENTS = [
    {
        'id': 'single-cell-windows',
        'title': '单细胞 R 环境',
        'runtime': 'R',
        'platform': 'Windows x86-64',
        'sources': [
            'V1.0/单细胞/r环境/win/environment.yml',
            'V1.0/单细胞/r环境/win/environment-win-64.lock.txt',
        ],
    },
    {
        'id': 'single-cell-macos',
        'title': '单细胞 R 环境',
        'runtime': 'R',
        'platform': 'macOS · Apple Silicon',
        'sources': ['V1.0/单细胞/r环境/mac/sc-conda-packages.txt'],
    },
    {
        'id': 'spatial-windows',
        'title': '空间转录组 Python 环境',
        'runtime': 'Python',
        'platform': 'Windows x86-64',
        'sources': [
            'V1.0/空间转录组/python环境/win/environment.yml',
            'V1.0/空间转录组/python环境/win/st_miniconda.txt',
        ],
    },
    {
        'id': 'spatial-macos',
        'title': '空间转录组 Python 环境',
        'runtime': 'Python',
        'platform': 'macOS · Apple Silicon',
        'sources': ['V1.0/空间转录组/python环境/mac/st_miniconda.txt'],
    },
]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def package(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 4, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Path to the supplied V1.0.zip')
    args = parser.parse_args()
    catalog = []
    packages = []
    with zipfile.ZipFile(args.source) as source:
        for environment in ENVIRONMENTS:
            files = []
            contents = {}
            for source_path in environment['sources']:
                name = PurePosixPath(source_path).name
                data = source.read(source_path)
                contents[name] = data
                files.append({
                    'name': name,
                    'source': source_path,
                    'bytes': len(data),
                    'sha256': sha256(data),
                })
            data = package(contents)
            filename = environment['id'] + '.zip'
            packages.append((filename, data))
            catalog.append({
                key: value for key, value in environment.items() if key != 'sources'
            } | {
                'url': '/resources/v1/environments/' + filename,
                'bytes': len(data),
                'sha256': sha256(data),
                'files': files,
            })
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, data in packages:
        (OUTPUT / filename).write_bytes(data)
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Packaged {len(packages)} environments into {OUTPUT}')


if __name__ == '__main__':
    main()
