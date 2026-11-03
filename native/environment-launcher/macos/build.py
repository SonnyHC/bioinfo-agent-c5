#!/usr/bin/env python3
"""Build the macOS launcher on macOS: python3 native/environment-launcher/macos/build.py"""
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import subprocess
import tempfile
import zipfile

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[2]
CATALOG = SOURCE.parent / 'catalog.json'
OUTPUT = ROOT / 'web/public/resources/launcher/BioInfoBuddy-Launcher-macOS.zip'


def build():
    actions = [item for item in json.loads(CATALOG.read_text()) if item['platform'] == 'macos']
    ids = {item['id'] for item in actions}
    expected = {'single-cell-macos', 'spatial-macos', 'case-single-cell-macos', 'case-spatial-macos'}
    if ids != expected or len(actions) != len(expected):
        raise ValueError('Unexpected macOS installation IDs')
    for action in actions:
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', action['envName']):
            raise ValueError('Invalid environment name')
        if not action['condaPackages'] or any(not re.fullmatch(r'[a-z0-9_.-]+(?:=[a-zA-Z0-9_.-]+)?', p) for p in action['condaPackages']):
            raise ValueError('Invalid Conda package')
        if any(not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9.]*', p) for p in action.get('rPackages', [])):
            raise ValueError('Invalid R package')
    with tempfile.TemporaryDirectory(prefix='bioinfobuddy-macos-') as temporary:
        stage = Path(temporary)
        app = stage / 'BioInfoBuddy Launcher.app'
        macos = app / 'Contents/MacOS'
        resources = app / 'Contents/Resources'
        macos.mkdir(parents=True)
        (resources / 'actions').mkdir(parents=True)
        plist = {
            'CFBundleExecutable': 'BioInfoBuddyLauncher',
            'CFBundleIdentifier': 'org.bioinfobuddy.environment-launcher',
            'CFBundleName': 'BioInfoBuddy Launcher',
            'CFBundleDisplayName': 'BioInfoBuddy Launcher',
            'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': '1.0.0',
            'CFBundleVersion': '1',
            'LSMinimumSystemVersion': '13.0',
            'LSUIElement': True,
            'CFBundleURLTypes': [{'CFBundleURLName': 'BioInfoBuddy environment installer', 'CFBundleURLSchemes': ['bioinfobuddy'], 'CFBundleTypeRole': 'Viewer'}],
        }
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(plist))
        main = stage / 'main.swift'
        main.write_text(SOURCE.joinpath('Launcher.swift').read_text())
        allowed = stage / 'AllowedIDs.swift'
        allowed.write_text('let allowedInstallationIDs = ' + json.dumps(sorted(ids)) + '\n')
        module_cache = ROOT / '.local/macos-launcher-module-cache'
        module_cache.mkdir(parents=True, exist_ok=True)
        subprocess.run(['xcrun', 'swiftc', '-O', '-target', 'arm64-apple-macosx13.0', '-module-cache-path', str(module_cache), str(main), str(allowed), '-o', str(macos / 'BioInfoBuddyLauncher')], check=True)
        shutil.copyfile(SOURCE / 'install.sh', resources / 'install.sh')
        (resources / 'install.sh').chmod(0o755)
        cases = ['# Generated from catalog.json; do not edit.', 'load_action() {', '  case "$1" in']
        for action in actions:
            r_program = ''
            if action.get('rPackages'):
                packages = ','.join(json.dumps(p) for p in action['rPackages'])
                r_program = f'packages <- c({packages}); managed_library <- Sys.getenv("R_LIBS_USER"); dir.create(managed_library, recursive=TRUE, showWarnings=FALSE); .libPaths(managed_library); missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly=TRUE)]; if(length(missing)) install.packages(missing, lib=managed_library, repos="https://cloud.r-project.org"); stopifnot(all(vapply(packages, requireNamespace, logical(1), quietly=TRUE)))'
            cases += [f"    {action['id']})", f"      action_title={shlex.quote(action['title'])}", f"      env_name={shlex.quote(action['envName'])}", f"      conda_packages=({' '.join(shlex.quote(p) for p in action['condaPackages'])})", f"      r_program={shlex.quote(r_program)}", '      ;;']
            command = resources / 'actions' / (action['id'] + '.command')
            command.write_text('#!/bin/bash\nscript_dir="$(cd "$(dirname "$0")" && pwd)"\nexec /bin/bash "$script_dir/../install.sh" ' + shlex.quote(action['id']) + '\n')
            command.chmod(0o755)
        cases += ['    *) return 2;;', '  esac', '}']
        (resources / 'catalog.sh').write_text('\n'.join(cases) + '\n')
        subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        binary = macos / 'BioInfoBuddyLauncher'
        for installation in actions:
            uri = 'bioinfobuddy://install/' + installation['id']
            result = subprocess.run([str(binary), '--validate-url', uri], check=True, capture_output=True, text=True)
            assert result.stdout.strip() == installation['id']
            plan = json.loads(subprocess.check_output([str(binary), '--plan', uri]))
            assert plan['arguments'] == ['-b', 'com.apple.Terminal', str(resources / 'actions' / (installation['id'] + '.command'))]
            subprocess.run(['/bin/bash', str(resources / 'install.sh'), installation['id'], '--dry-run'], check=True, stdout=subprocess.DEVNULL)
        invalid = ['bioinfobuddy://install/single-cell-windows', 'bioinfobuddy://install/single-cell-macos?x=1', 'bioinfobuddy://install/single-cell-macos#x', 'bioinfobuddy://install:80/single-cell-macos', 'bioinfobuddy://user@install/single-cell-macos', 'bioinfobuddy://install/%73ingle-cell-macos', 'bioinfobuddy://install/single-cell-macos/', 'bioinfobuddy://install/../single-cell-macos', 'bioinfobuddy://install/single-cell-macos;id', 'bioinfobuddy://install/single-cell-macos\n', 'https://install/single-cell-macos']
        for uri in invalid:
            assert subprocess.run([str(binary), '--validate-url', uri], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 2, uri
        (stage / '安装说明.txt').write_text('1. 解压后打开 BioInfoBuddy Launcher。\n2. 看到“启动器已就绪”后，回到网页点击“在终端安装”。\n\n首次打开如遇开发者验证提示：在“系统设置 → 隐私与安全性”选择“仍要打开”。\n适用：macOS 13 及以上，Apple Silicon。\n启动器保存在 ~/Applications；环境保存在 ~/.local/share/bioinfobuddy。\n', encoding='utf-8')
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(OUTPUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(app.rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(stage))
            archive.write(stage / '安装说明.txt', '安装说明.txt')
    data = OUTPUT.read_bytes()
    print(json.dumps({'path': str(OUTPUT), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'validatedActions': len(actions), 'rejectedURLs': len(invalid)}, ensure_ascii=False))


if __name__ == '__main__':
    build()
