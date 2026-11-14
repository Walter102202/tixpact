# CI runs the contract gate in four parallel parts, and only `main` saves the Rust cache

Date: 2026-11-14. Author: Walter (recorded by the integrator). Status: accepted. Updates the timing in `2026-11-14-main-merges-only-through-a-green-pull-request.md`.

## Context

Walter asked for CI to take no more than 8 minutes. The `contract` job took 7.6 minutes with a warm cache and 12 to 14 without one, and half of the recent runs had none:

- With a warm cache, the sandbox tests took about 6.5 of the 7.6 minutes. Cargo runs their files one after another: `gas` 98 s, `storage` 96 s, `tokens` 87 s, `settlement` 45 s, `rules` 30 s, `transfers` 21 s, `smoke` and `init` 5 s each (run `43560663702`).
- Every branch and every pull request saved its own Rust cache of about 1 GB. On 2026-11-14 the repository held 10.8 GB of caches, over GitHub's 10 GB, so GitHub evicted caches and runs started cold.

## Decision

- `bash scripts/gate.sh contract-part <part>` runs one part:
  - `checks`: fmt, clippy, the wasm build, a build of every test binary, the unit and doc tests, and `init`, `smoke`, `transfers`, `rules` and `settlement`.
  - `gas`, `storage`, `tokens`: one test file each.
- `checks` fails if a file in `contract/tests` belongs to no part, so a new file cannot go unrun. `bash scripts/gate.sh contract` still runs everything in one go.
- CI runs the four parts in parallel (`contract-part`). A job named `contract (fmt, clippy, wasm build, sandbox tests)` passes only when all four pass, so the ruleset on `main` keeps requiring the same three checks.
- The parts share one Rust cache (`shared-key: contract`). Only `main`'s `checks` part saves it; branches and pull requests read it and save nothing.

## Alternatives considered

- **cargo-nextest.** It would interleave the test files on one runner. But each test process would build the wasm again, and the builds would queue on the target directory lock. A new tool on submission day, for less than four runners give.
- **Faster tests.** The long files replay the worst cases on purpose, so shortening them weakens what they prove.
- **Drop the `pull_request` trigger.** It would halve runner use, not wall time. With "up to date with `main`" required, the branch run already tests the same tree.

## Consequences

- With a warm cache, the slowest part is the sandbox file it runs plus about a minute of setup and build.
- A cold cache costs every part a full build, about 5 minutes. That happens once after a change to `Cargo.lock` or the toolchain, until `main` saves the cache again.
- A new test file needs a line in `part_tests` in `scripts/gate.sh`. A file that grows past about 2 minutes should get a part of its own.
