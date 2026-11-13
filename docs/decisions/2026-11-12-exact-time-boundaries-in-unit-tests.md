# The exact millisecond of each time boundary is proven by a unit test

Date: 2026-11-12. Author: Track C. Status: accepted.

## Context

`t15_deadline_boundaries` asks for calls "at exactly" a boundary: buy and transfer at `now == starts_at_ms`, attest at `now == resolution_deadline_ms` (plan, "Acceptance tests" and Review Focus 2). A sandbox transaction runs in whatever block includes it; its block time is only known afterwards, so no test can place a call on a chosen millisecond. `fast_forward` moves the clock by about 0.3 s per block (`docs/toolchain.md`).

## Decision

- `t15_deadline_boundaries` (sandbox, `contract/tests/rules.rs`) shows every window from both sides and asserts, from the block each call ran in, which side it was on: buy and transfer succeed before the start and fail with `ERR_TOO_LATE` from the start on; expire fails with `ERR_TOO_EARLY` a few seconds before the deadline; attest fails with `ERR_TOO_LATE` and expire succeeds from the deadline on.
- The unit test `deadline_boundaries_are_exact` (`contract/src/tests.rs`) sets the block time to the exact millisecond: buy at `starts_at_ms - 1` works and at `starts_at_ms` fails, the same for transfer; attest fails at `ends_at_ms - 1` and at `resolution_deadline_ms`; cancel fails at the deadline; expire fails at `deadline - 1` and works at the deadline. `attestation_is_open_from_the_exact_end` and `cancel_is_open_until_one_millisecond_before_the_deadline` pin the open side.

## Alternatives considered

- Patch the event's times with `patch_state` to equal a block time: the block that will include the next transaction is still unknown, so equality would hold only by luck.
- A test-only method that sets the clock: test code inside the released contract, and a second meaning of "now".

## Consequences

The README can map Review Focus 2 to both test names. If the guards ever move out of the methods into helpers with their own clock, the unit test still covers them because it calls the public methods.
