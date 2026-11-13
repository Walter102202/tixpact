#!/usr/bin/env bash
# Runs inside WSL, started by scripts/wsl.sh from the repository (or worktree) root.
# Building on the Windows filesystem is slow and breaks file locks, so each checkout gets its own
# cargo target directory under the Linux home.
set -euo pipefail
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi
cache="$HOME/.cache/ticket-escrow"
checkout="$(pwd | tr -c 'A-Za-z0-9\n' '_')"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$cache/$checkout/target}"
mkdir -p "$CARGO_TARGET_DIR"
# Optional: the tests download the sandbox node (about 94 MB) once per target directory. A copy at
# this path is used instead. The version is the one `near-sandbox` in Cargo.lock asks for.
if [ -z "${NEAR_SANDBOX_BIN_PATH:-}" ] && [ -x "$cache/near-sandbox-2.14.1" ]; then
  export NEAR_SANDBOX_BIN_PATH="$cache/near-sandbox-2.14.1"
fi
exec "$@"
