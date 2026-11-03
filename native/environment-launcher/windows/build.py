#!/usr/bin/env python3
"""Build the Windows launcher ZIP without running or installing it."""
import json
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CATALOG = HERE.parent / 'catalog.json'
OUTPUT = ROOT / 'web/public/resources/launcher/BioInfoBuddy-Launcher-Windows.zip'
FILES = ['install.cmd', 'install.ps1', 'receive.ps1', 'run.ps1', 'core.ps1', 'uninstall.cmd', 'uninstall.ps1', 'README.txt']


def main():
    entries = [item for item in json.loads(CATALOG.read_text()) if item['platform'] == 'windows']
    expected = {'single-cell-windows', 'spatial-windows', 'case-single-cell-windows', 'case-spatial-windows'}
    if {item['id'] for item in entries} != expected or len(entries) != len(expected):
        raise ValueError('Windows catalog IDs do not match the protocol allowlist')
    payload = {name: (HERE / name).read_text(encoding='utf-8-sig') for name in FILES}
    payload['catalog.json'] = json.dumps(entries, ensure_ascii=False, indent=2) + '\n'
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, 'w') as archive:
        for name, value in sorted(payload.items()):
            encoding = 'utf-8-sig' if name.endswith('.ps1') else 'utf-8'
            data = value.replace('\r\n', '\n').replace('\n', '\r\n').encode(encoding)
            info = zipfile.ZipInfo('BioInfoBuddy-Launcher-Windows/' + name, date_time=(2026, 11, 4, 0, 0, 0))
            info.create_system = 0
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    print(OUTPUT)


if __name__ == '__main__':
    main()
