#!/usr/bin/env bash
# One command that proves the repository works. Run it from anywhere inside the repository.
#
#   bash scripts/gate.sh             every part below, in order
#   bash scripts/gate.sh web         TypeScript workspace: frozen install, lint, typecheck, tests, build
#   bash scripts/gate.sh contract    Rust workspace: format, lint, wasm build, unit and sandbox tests
#
# It stops at the first failure and exits non-zero.
# On Windows the contract part runs inside WSL (docs/toolchain.md); the command is the same.
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

contract_steps() {
  echo "== Rust workspace: format, lint, wasm build, unit and sandbox tests =="
  cargo fmt --all -- --check
  cargo clippy --workspace --all-targets --locked -- -D warnings
  (cd contract && cargo near build non-reproducible-wasm --locked)
  cargo test --workspace --locked
}

contract() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) bash scripts/wsl.sh bash scripts/gate.sh contract-steps ;;
    *) contract_steps ;;
  esac
}

case "${1:-all}" in
  web) web ;;
  contract) contract ;;
  # Internal: the contract steps without the closing line, for the WSL hop above.
  contract-steps)
    contract_steps
    exit 0
    ;;
  all)
    web
    contract
    ;;
  *)
    echo "usage: bash scripts/gate.sh [web|contract]" >&2
    exit 2
    ;;
esac

echo "== gate passed: ${1:-all} =="
