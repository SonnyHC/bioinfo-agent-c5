#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
action="${1:-}"
mode="${2:-}"
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || { [ -n "$mode" ] && [ "$mode" != '--dry-run' ] && [ "$mode" != '--locked' ]; }; then
  printf '%s\n' '安装参数无效。' >&2
  exit 2
fi
# Generated only from the bundled, validated catalog during packaging.
source "$script_dir/catalog.sh"
load_action "$action" || { printf '%s\n' '安装项目无效。' >&2; exit 2; }

state_root="$HOME/.local/share/bioinfobuddy"
environment_prefix="$state_root/environments/$env_name"
if [ "$mode" = '--dry-run' ]; then
  printf 'action=%s\nenvironment=%s\n' "$action" "$environment_prefix"
  printf 'conda-package=%s\n' "${conda_packages[@]}"
  if [ -n "$r_program" ]; then printf 'Rscript=%s\n' "$r_program"; fi
  exit 0
fi

installer_tmp=''
finish() {
  result=$?
  trap - EXIT INT TERM
  if [ -n "$installer_tmp" ]; then /bin/rm -f "$installer_tmp"; fi
  if [ "$result" != 0 ]; then printf '\n安装未完成（退出码 %s），详细信息见上方输出。\n' "$result"; fi
  exit "$result"
}
if [ "$(/usr/bin/uname -m)" != 'arm64' ]; then
  printf '%s\n' '此安装项目适用于 Apple Silicon Mac。'
  exit 2
fi
/bin/mkdir -p "$state_root"
if [ "$mode" != '--locked' ]; then
  # File-and-command mode is supported by the macOS 13 lockf utility.
  # -k preserves one lock inode across callers; the OS releases it on exit.
  result=0
  /usr/bin/lockf -s -k -t 0 "$state_root/install.lock" /bin/bash "$0" "$action" --locked || result=$?
  if [ "$result" = 75 ]; then printf '%s\n' '另一个环境正在安装，请等待完成。'; result=3; fi
  if [ -t 0 ]; then read -r -p '按回车关闭此窗口…' ignored || true; fi
  exit "$result"
fi
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '\nBioInfoBuddy · %s\n\n' "$action_title"

conda_bin=''
path_conda="$(command -v conda || true)"
for candidate in "$path_conda" "${CONDA_EXE:-}" "$HOME/miniconda3/bin/conda" "$HOME/miniforge3/bin/conda" "$HOME/anaconda3/bin/conda" '/opt/homebrew/Caskroom/miniforge/base/bin/conda' '/opt/miniconda3/bin/conda' '/opt/anaconda3/bin/conda' "$state_root/miniconda3/bin/conda"; do
  if [ -n "$candidate" ] && [ -f "$candidate" ] && [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
    conda_bin="$candidate"
    break
  fi
done

if [ -z "$conda_bin" ]; then
  miniconda_prefix="$state_root/miniconda3"
  if [ -e "$miniconda_prefix" ]; then
    printf 'Miniconda 目录已有未完成的安装：%s\n请将该目录移走后重试。\n' "$miniconda_prefix"
    exit 4
  fi
  printf '%s\n' '正在准备 Miniconda…'
  installer_tmp="$(/usr/bin/mktemp "$state_root/miniconda-installer.XXXXXX")"
  /usr/bin/curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --output "$installer_tmp" 'https://repo.anaconda.com/miniconda/Miniconda3-py312_26.9.4-0-MacOSX-arm64.sh'
  expected='baead652fef2193f2b4ae22523261921f45996c8bce922dc388cfdc08ed0d06c'
  actual="$(/usr/bin/shasum -a 256 "$installer_tmp" | /usr/bin/awk '{print $1}')"
  if [ "$actual" != "$expected" ]; then printf '%s\n' 'Miniconda 文件校验失败，请重试。'; exit 5; fi
  /bin/bash "$installer_tmp" -b -p "$miniconda_prefix"
  conda_bin="$miniconda_prefix/bin/conda"
  /bin/rm -f "$installer_tmp"
  installer_tmp=''
fi

printf 'Conda: %s\n环境目录: %s\n\n' "$conda_bin" "$environment_prefix"
export CONDA_SUBDIR=osx-arm64
if [ -d "$environment_prefix/conda-meta" ]; then
  "$conda_bin" install --yes --prefix "$environment_prefix" --override-channels --channel conda-forge "${conda_packages[@]}"
else
  "$conda_bin" create --yes --prefix "$environment_prefix" --override-channels --channel conda-forge "${conda_packages[@]}"
fi
if [ -n "$r_program" ]; then
  R_LIBS='' R_LIBS_SITE='' R_LIBS_USER="$environment_prefix/lib/R/library" "$conda_bin" run --no-capture-output --prefix "$environment_prefix" Rscript --vanilla -e "$r_program"
fi
case "$env_name" in
  sc_r_mac) R_LIBS='' R_LIBS_SITE='' R_LIBS_USER="$environment_prefix/lib/R/library" "$conda_bin" run --no-capture-output --prefix "$environment_prefix" Rscript --vanilla -e 'stopifnot(getRversion() >= "4.4"); sessionInfo()';;
  *) "$conda_bin" run --no-capture-output --prefix "$environment_prefix" python -I -c 'import scanpy, anndata; print("Scanpy", scanpy.__version__)';;
esac
printf '\n安装完成。使用以下命令进入环境：\n'
conda_base="$("$conda_bin" info --base)"
printf 'source %q\n' "$conda_base/etc/profile.d/conda.sh"
printf 'conda activate %q\n\n' "$environment_prefix"
