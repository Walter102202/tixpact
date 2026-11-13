#!/usr/bin/env bash
# One command that proves the repository works. Run it from anywhere inside the repository.
#
#   bash scripts/gate.sh        every part below, in order
#   bash scripts/gate.sh web    TypeScript workspace: frozen install, lint, typecheck, tests, build
#
# It stops at the first failure and exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/.."

web() {
  echo "== TypeScript workspace: install, lint, typecheck, tests, build =="
  pnpm install --frozen-lockfile
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
}

case "${1:-all}" in
  web) web ;;
  all) web ;;
  *)
    echo "usage: bash scripts/gate.sh [web]" >&2
    exit 2
    ;;
esac

echo "== gate passed: ${1:-all} =="
