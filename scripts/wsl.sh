#!/usr/bin/env bash
# Windows only: run a command inside WSL, in the same folder, with the Rust toolchain on PATH and
# the cargo target directory on the Linux filesystem. Use it from Git Bash for everything Rust:
#
#   bash scripts/wsl.sh bash scripts/gate.sh contract
#   bash scripts/wsl.sh cargo test -p ticket-escrow
#
# Keep the arguments plain words. Anything with `$`, quotes or `&&` belongs in a script file,
# because an outer shell inside WSL expands it before the command runs.
# On Linux or macOS you do not need this file: run the command directly.
set -euo pipefail
cd "$(dirname "$0")/.."
here_win="$(pwd -W 2>/dev/null || pwd)"
# Git Bash rewrites arguments that look like POSIX paths (/mnt/c/...) before a Windows program
# sees them. These two variables switch that off (Git for Windows and MSYS2 respectively).
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
exec wsl.exe -d "${WSL_DISTRO:-Ubuntu-24.04}" --cd "$here_win" -- bash scripts/in-wsl.sh "$@"
