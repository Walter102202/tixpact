# `main` changes only through a pull request whose CI is green

Date: 2026-11-14. Author: Walter (recorded by the integrator). Status: accepted.

## Context

`.github/workflows/ci.yml` says every job must pass before a merge, but nothing enforced it: the integrator merged locally and pushed to `main`.

## Decision

GitHub ruleset "main: pull request with a green CI" (id 27250653) on the default branch:

- A pull request is the only way into `main`. No approval is required (one person owns the repository).
- The three CI jobs must pass: `contract (fmt, clippy, wasm build, sandbox tests)`, `web (lint, typecheck, test, build)` and `hygiene (secrets, tracked files)`.
- The branch must be up to date with `main` before it merges.
- `main` cannot be deleted or force-pushed.
- Nobody can bypass it, administrators included.

It follows the ruleset of `Walter102202/colaborasi`, without that repository's administrator bypass.

## Alternatives considered

- **Keep merging locally.** Faster, but a red commit can reach `main`.
- **Allow the administrator to bypass.** It would let a red pull request merge, which is what this rule exists to prevent.

## Consequences

A merge waits for the slowest job: `contract` took 12 minutes on `d07679f`. A track branch behind `main` merges `main` first and runs CI again. A job renamed in `ci.yml` must be renamed in the ruleset too, or no pull request can merge. Hosting is unchanged: `main` does not deploy (`2026-11-14-the-web-is-hosted-on-vercel.md`).
