#!/usr/bin/env python3
"""Package the prebuilt desktop renderer and pinned Electron binaries on macOS."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGING = ROOT / 'desktop/packaging'
TOOLS = ROOT / '.local/desktop-packager'
CACHE = TOOLS / 'cache'
RELEASE = ROOT / 'release'
ELECTRON = '45.3.3'
ELECTRON_SHA256 = {
    'darwin-arm64': '25ae0ce40ee462433c1029b8fcc485949fc8a89394b62b70887d7793898edc89',
    'win32-x64': '49dd2d3875944f08de03d34595cd30093c588b9edcabb41a0ac481028a3a5a8a',
}
NSIS_SHA256 = 'e7c507dc02c50a630db44948fc68ff4dea7c2bae64592d96d134952c2624ddc1'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
BUNDLE_ID = 'org.bioinfobuddy.desktop'
IGNORE_METADATA = shutil.ignore_patterns('.DS_Store', '._*', '*.map')


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, **kwargs)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def cached_file(filename, url, expected, headers=()):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / filename
    if target.is_file() and sha256(target) == expected:
        return target
    with tempfile.TemporaryDirectory(dir=CACHE) as temporary:
        partial = Path(temporary) / filename
        run('curl', '--fail', '--location', '--show-error', '--silent', '--retry', '3',
            '--connect-timeout', '20', *headers, url, '--output', partial)
        if sha256(partial) != expected:
            raise ValueError(f'SHA-256 mismatch: {filename}')
        partial.replace(target)
    return target


def electron_archive(target):
    name = f'electron-v{ELECTRON}-{target}.zip'
    url = f'https://github.com/electron/electron/releases/download/v{ELECTRON}/{name}'
    return cached_file(name, url, ELECTRON_SHA256[target])


def nsis_tool():
    installed = shutil.which('makensis')
    if installed:
        version = subprocess.check_output([installed, '-VERSION'], text=True).strip()
        if version == 'v3.13':
            return installed, os.environ.copy()
    # The pinned Homebrew bottle requires macOS Tahoe on Apple Silicon.
    archive = cached_file('makensis-3.13-arm64_tahoe.tar.gz',
                          'https://ghcr.io/v2/homebrew/core/makensis/blobs/sha256:' + NSIS_SHA256,
                          NSIS_SHA256, ('-H', 'Authorization: Bearer QQ=='))
    folder = TOOLS / 'makensis/3.13'
    run('tar', '-xzf', archive, '-C', TOOLS)
    return folder / 'bin/makensis', {**os.environ, 'NSISDIR': str(folder / 'share/nsis')}


def stage_environment(platform, output):
    mac = platform == 'mac'
    system = 'macOS' if mac else 'Windows'
    archive = ROOT / f'web/public/resources/launcher/BioInfoBuddy-Launcher-{system}.zip'
    prefix = 'BioInfoBuddy Launcher.app/Contents/Resources/' if mac else 'BioInfoBuddy-Launcher-Windows/'
    if mac:
        actions = json.loads((ROOT / 'native/environment-launcher/catalog.json').read_text())
        files = ['catalog.sh', 'install.sh', *(f"actions/{item['id']}.command" for item in actions if item['platform'] == 'macos')]
    else:
        files = ['core.ps1', 'run.ps1', 'receive.ps1', 'catalog.json']
    with zipfile.ZipFile(archive) as bundle:
        for name in files:
            path = output / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(bundle.read(prefix + name))
            path.chmod(0o755 if mac else 0o644)


def stage_app(resources, platform):
    app = resources / 'app'
    if not (ROOT / 'dist/desktop-client/desktop.html').is_file():
        raise SystemExit('First run npm run build:desktop-web')
    (app / 'desktop').mkdir(parents=True)
    metadata = {'name': 'bioinfobuddy', 'productName': 'BioInfoBuddy', 'version': VERSION,
                'private': True, 'main': 'desktop/main.cjs'}
    (app / 'package.json').write_text(json.dumps(metadata, indent=2) + '\n')
    for module in (ROOT / 'desktop').glob('*.cjs'):
        shutil.copy2(module, app / 'desktop' / module.name)
    for name in ['config/model-providers.json', 'serverless/chat-handler.mjs', 'THIRD_PARTY_NOTICES.md']:
        path = app / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, path)
    shutil.copytree(ROOT / 'dist/desktop-client', app / 'dist/desktop-client', ignore=IGNORE_METADATA)
    for package in ['fflate', 'saxes', 'xmlchars']:
        shutil.copytree(ROOT / 'node_modules' / package, app / 'node_modules' / package, ignore=IGNORE_METADATA)
    shutil.copy2(PACKAGING / 'saxes-LICENSE', app / 'node_modules/saxes/LICENSE')
    licenses = app / 'licenses'
    licenses.mkdir()
    for package in ['lucide-react', 'react', 'react-dom', 'scheduler']:
        shutil.copy2(ROOT / 'node_modules' / package / 'LICENSE', licenses / (package + '.txt'))
    stage_environment(platform, resources / 'environment')
    (resources / 'default_app.asar').unlink(missing_ok=True)


def update_plist(bundle, values):
    path = bundle / 'Contents/Info.plist'
    data = plistlib.loads(path.read_bytes())
    data.update(values)
    path.write_bytes(plistlib.dumps(data))


def build_mac(stage):
    extracted = stage / 'electron'
    extracted.mkdir()
    run('ditto', '-x', '-k', electron_archive('darwin-arm64'), extracted)
    image = stage / 'image'
    image.mkdir()
    bundle = image / 'BioInfoBuddy.app'
    (extracted / 'Electron.app').rename(bundle)
    contents = bundle / 'Contents'
    runtime_min = plistlib.loads((contents / 'Info.plist').read_bytes()).get('LSMinimumSystemVersion', '13.0')
    if int(runtime_min.split('.')[0]) > 13:
        raise ValueError(f'Electron requires macOS {runtime_min}')
    update_plist(bundle, {
        'CFBundleName': 'BioInfoBuddy', 'CFBundleDisplayName': 'BioInfoBuddy',
        'CFBundleIdentifier': BUNDLE_ID, 'CFBundleExecutable': 'BioInfoBuddy',
        'CFBundleVersion': VERSION, 'CFBundleShortVersionString': VERSION,
        'CFBundleIconFile': 'BioInfoBuddy.icns', 'LSMinimumSystemVersion': '13.0',
        'LSApplicationCategoryType': 'public.app-category.productivity',
    })
    (contents / 'MacOS/Electron').rename(contents / 'MacOS/BioInfoBuddy')
    for helper in sorted((contents / 'Frameworks').glob('Electron Helper*.app')):
        name = helper.stem.replace('Electron', 'BioInfoBuddy', 1)
        suffix = name.removeprefix('BioInfoBuddy Helper').strip(' ()').lower()
        update_plist(helper, {'CFBundleName': name, 'CFBundleDisplayName': name, 'CFBundleExecutable': name,
                             'CFBundleIdentifier': BUNDLE_ID + '.helper' + ('.' + suffix if suffix else '')})
        (helper / 'Contents/MacOS' / helper.stem).rename(helper / 'Contents/MacOS' / name)
        renamed = helper.with_name(name + '.app')
        helper.rename(renamed)
        run('codesign', '--force', '--sign', '-', renamed)
    resources = contents / 'Resources'
    stage_app(resources, 'mac')
    shutil.copy2(PACKAGING / 'BioInfoBuddy.icns', resources / 'BioInfoBuddy.icns')
    for license_file in extracted.glob('LICENSE*'):
        shutil.copy2(license_file, resources / license_file.name)
    # Electron's distribution carries linker signatures on Mach-O binaries.
    # Seal the enclosing frameworks before sealing and verifying the app.
    for framework in sorted((contents / 'Frameworks').glob('*.framework')):
        run('codesign', '--force', '--sign', '-', framework)
    run('codesign', '--force', '--sign', '-', bundle)
    run('codesign', '--verify', '--deep', '--strict', bundle)
    (image / 'Applications').symlink_to('/Applications')
    name = f'BioInfoBuddy-{VERSION}-macOS-arm64.dmg'
    output = stage / name
    run('hdiutil', 'create', '-volname', 'BioInfoBuddy', '-fs', 'HFS+', '-srcfolder', image, '-format', 'UDZO', output)
    run('hdiutil', 'verify', output)
    output.replace(RELEASE / name)
    return RELEASE / name


def build_win(stage):
    payload = stage / 'windows'
    with zipfile.ZipFile(electron_archive('win32-x64')) as archive:
        archive.extractall(payload)
    stage_app(payload / 'resources', 'win')
    exe = payload / 'BioInfoBuddy.exe'
    run('node', PACKAGING / 'windows-brand.mjs', payload / 'electron.exe', exe, PACKAGING / 'BioInfoBuddy.ico', VERSION)
    (payload / 'electron.exe').unlink()
    size_kb = sum(path.stat().st_size for path in payload.rglob('*') if path.is_file()) // 1024
    name = f'BioInfoBuddy-{VERSION}-Windows-x64-Setup.exe'
    output = stage / name
    nsis, env = nsis_tool()
    run(nsis, '-V2', '-NOCD', f'-DVERSION={VERSION}', f'-DOUTPUT={output}', f'-DPAYLOAD={payload}',
        f'-DICON={PACKAGING / "BioInfoBuddy.ico"}', f'-DSIZE_KB={size_kb}', PACKAGING / 'windows.nsi', env=env)
    output.replace(RELEASE / name)
    return RELEASE / name


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--platform', choices=['all', 'mac', 'win'], default='all')
    cli.add_argument('--stage-environment', choices=['mac', 'win'])
    args = cli.parse_args()
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', VERSION):
        cli.error('a three-part numeric application version is required')
    if args.stage_environment:
        output = ROOT / 'dist/desktop-environment'
        if output.exists():
            shutil.rmtree(output)
        stage_environment(args.stage_environment, output)
        return
    TOOLS.mkdir(parents=True, exist_ok=True)
    RELEASE.mkdir(exist_ok=True)
    for platform, build in [('mac', build_mac), ('win', build_win)]:
        if args.platform in ('all', platform):
            with tempfile.TemporaryDirectory(prefix='build-', dir=TOOLS) as directory:
                output = build(Path(directory))
                print(f'{sha256(output)}  {output}', flush=True)


if __name__ == '__main__':
    main()
