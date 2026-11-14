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

# CI runs the contract gate in parallel parts. Each file in contract/tests belongs to one part;
# the `checks` part fails if a file belongs to none, so a new test file cannot go unrun.
# Together the parts run what `contract` runs.
PARTS="checks gas storage tokens"

part_tests() {
  case "$1" in
    checks) echo "init smoke transfers rules settlement" ;;
    gas) echo "gas" ;;
    storage) echo "storage" ;;
    tokens) echo "tokens" ;;
    *)
      echo "unknown part '$1'; the parts are: $PARTS" >&2
      return 2
      ;;
  esac
}

every_test_file_has_a_part() {
  local listed="" missing="" part file name
  for part in $PARTS; do listed="$listed $(part_tests "$part")"; done
  for file in contract/tests/*.rs; do
    name="$(basename "$file" .rs)"
    case " $listed " in
      *" $name "*) ;;
      *) missing="$missing $name" ;;
    esac
  done
  if [ -n "$missing" ]; then
    echo "these files in contract/tests belong to no part in scripts/gate.sh:$missing" >&2
    return 1
  fi
}

contract_part_steps() {
  local part="$1" tests args="" name
  tests="$(part_tests "$part")"
  for name in $tests; do args="$args --test $name"; done
  echo "== Rust workspace, part '$part': $tests =="
  if [ "$part" = checks ]; then
    every_test_file_has_a_part
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets --locked -- -D warnings
    (cd contract && cargo near build non-reproducible-wasm --locked)
    # Builds every test binary, so the cache this part saves serves the other parts too.
    cargo test --workspace --locked --no-run
    cargo test --workspace --locked --lib --bins
    cargo test --workspace --locked --doc
  fi
  # shellcheck disable=SC2086
  cargo test -p ticket-escrow --locked $args
}

contract_part() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) bash scripts/wsl.sh bash scripts/gate.sh contract-part-steps "$1" ;;
    *) contract_part_steps "$1" ;;
  esac
}

case "${1:-all}" in
  web) web ;;
  contract) contract ;;
  contract-part)
    part_tests "${2:-}" >/dev/null
    contract_part "$2"
    ;;
  # Internal: the contract steps without the closing line, for the WSL hop above.
  contract-steps)
    contract_steps
    exit 0
    ;;
  contract-part-steps)
    contract_part_steps "$2"
    exit 0
    ;;
  all)
    web
    contract
    ;;
  *)
    echo "usage: bash scripts/gate.sh [web|contract|contract-part <$(echo $PARTS | tr ' ' '|')>]" >&2
    exit 2
    ;;
esac

echo "== gate passed: ${1:-all}${2:+ $2} =="
