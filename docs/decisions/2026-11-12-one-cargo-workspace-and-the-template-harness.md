# One cargo workspace; sandbox tests use `near-sandbox` with `near-api`

Date: 2026-11-12. Author: integrator. Status: accepted.

## Context

Spike S1 (plan, "Spikes") had to choose the test harness and the crate layout. `cargo near new` 0.23.0 generates a single crate whose integration test uses `near-sandbox` 0.4.0 with `near-api` 0.8 and builds the wasm with `cargo-near-build` 0.11.0. On this machine that template built in 21 s and its sandbox test (deploy, payable calls with deposits, failed calls, `fast_forward`, balances) passed in 18 s.

## Decision

- Harness: `near-sandbox` + `near-api`, as generated. `near-workspaces` is not used.
- Layout: one cargo workspace at the repository root with the members `contract` and `fixtures/*`, one `Cargo.lock`, one release profile and shared dependency versions (`[workspace.dependencies]`). The crate `contract/` was written by hand from the template instead of generated in place, so it carries no example code.
- Every cargo command runs with `--locked`.

## Alternatives considered

- `near-workspaces` 0.24.0: a second way to do what the template already does, and not what `cargo near new` teaches today.
- Separate crates with their own lockfiles: the fixtures could drift to another `near-sdk` version than the contract they test.

## Consequences

`cargo near build` is run from `contract/` (that is what the gate does and what was verified); the tests build the wasm themselves through `cargo_near_build`. Account creation in tests goes through one helper that waits for finality, because the generated test signs with new accounts too early and fails about one run in ten (`docs/toolchain.md`, "Sandbox tests").
