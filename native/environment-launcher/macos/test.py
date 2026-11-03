#!/usr/bin/env python3
"""Exercise the bundled installer with a temporary Conda stub; installs nothing."""
import fcntl
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[3]
ARCHIVE = ROOT / 'web/public/resources/launcher/BioInfoBuddy-Launcher-macOS.zip'


def main():
    with tempfile.TemporaryDirectory(prefix='bioinfobuddy mac test ') as temporary:
        stage = Path(temporary)
        with zipfile.ZipFile(ARCHIVE) as archive:
            archive.extractall(stage)
            for info in archive.infolist():
                if info.external_attr >> 16:
                    (stage / info.filename).chmod((info.external_attr >> 16) & 0o777)
        bundle = stage / 'BioInfoBuddy Launcher.app'
        resources = bundle / 'Contents/Resources'
        binary = bundle / 'Contents/MacOS/BioInfoBuddyLauncher'
        plan = json.loads(subprocess.check_output([str(binary), '--plan', 'bioinfobuddy://install/single-cell-macos']))
        assert plan['arguments'][-1] == str(resources / 'actions/single-cell-macos.command')
        stub = stage / 'conda'
        events = stage / 'events.jsonl'
        stub.write_text('#!' + os.sys.executable + '\n' + '''import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['BIOINFO_TEST_EVENTS'], 'a') as stream: stream.write(json.dumps(args) + '\\n')
if args == ['--version']: print('conda test'); sys.exit(0)
if args == ['info', '--base']: print(os.environ['BIOINFO_TEST_CONDA_BASE']); sys.exit(0)
if args and args[0] in ['create', 'install']: sys.exit(int(os.environ.get('BIOINFO_TEST_FAIL', '0')))
if args and args[0] == 'run':
 if 'Rscript' in args:
  assert os.environ.get('R_LIBS') == '' and os.environ.get('R_LIBS_SITE') == ''
  assert os.environ['R_LIBS_USER'] == str(Path(args[args.index('--prefix') + 1]) / 'lib/R/library')
 if 'python' in args: assert args[args.index('python') + 1] == '-I'
 sys.exit(0)
sys.exit(99)
''')
        stub.chmod(0o755)
        state = stage / 'state with spaces'
        runner = resources / 'test-install.sh'
        original = (resources / 'install.sh').read_text()
        assert original.count('state_root="$HOME/.local/share/bioinfobuddy"') == 1
        runner.write_text(original.replace('state_root="$HOME/.local/share/bioinfobuddy"', 'state_root=' + shlex.quote(str(state))))
        env = {**os.environ, 'PATH': '/usr/bin:/bin', 'CONDA_EXE': str(stub), 'BIOINFO_TEST_EVENTS': str(events), 'BIOINFO_TEST_CONDA_BASE': str(stage / 'conda base'), 'R_LIBS': '/unrelated/library', 'R_LIBS_SITE': '/unrelated/site', 'R_LIBS_USER': '/unrelated/user', 'PYTHONPATH': '/unrelated/python'}

        def run(action, **overrides):
            return subprocess.run(['/bin/bash', str(runner), action], env={**env, **overrides}, stdin=subprocess.DEVNULL, capture_output=True, text=True)

        result = run('single-cell-macos')
        assert result.returncode == 0, result.stdout + result.stderr
        assert '安装完成' in result.stdout
        assert 'conda activate' in result.stdout and 'source ' in result.stdout
        commands = [json.loads(line) for line in events.read_text().splitlines()]
        create = next(args for args in commands if args[0] == 'create')
        assert create[:4] == ['create', '--yes', '--prefix', str(state / 'environments/sc_r_mac')]
        assert '--override-channels' in create and 'conda-forge' in create

        (state / 'environments/sc_r_mac/conda-meta').mkdir(parents=True)
        events.write_text('')
        result = run('case-single-cell-macos')
        assert result.returncode == 0, result.stdout + result.stderr
        commands = [json.loads(line) for line in events.read_text().splitlines()]
        assert any(args[0] == 'install' for args in commands)
        assert any('Rscript' in args and '--vanilla' in args and any('install.packages(missing, lib=managed_library' in value for value in args) for args in commands)

        result = run('spatial-macos', BIOINFO_TEST_FAIL='7')
        assert result.returncode == 7 and '安装完成' not in result.stdout
        assert '安装未完成' in result.stdout

        with (state / 'install.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = run('spatial-macos')
            assert result.returncode == 3 and '另一个环境正在安装' in result.stdout
        result = run('spatial-macos')
        assert result.returncode == 0, result.stdout + result.stderr
        result = run('single-cell-macos;touch /tmp/invalid')
        assert result.returncode == 2
        print('macOS launcher: spaced paths, create/update, R dependencies, failure propagation, concurrent lock and invalid action passed (stub Conda).')


if __name__ == '__main__':
    main()
