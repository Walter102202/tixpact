# Decision records

One file per decision, named `YYYY-MM-DD-slug.md`. Records are append-only: a decision that changes gets a new file that names the one it replaces.

Write one whenever you settle something the plan leaves open, or deviate from the plan. Keep it short enough to read in a minute.

## Format

```markdown
# <Decision in one line>

Date: YYYY-MM-DD. Author: <track or integrator>. Status: accepted | replaced by <file>.

## Context

What was unclear or forced the choice. Evidence with `file:line`, a command and its output, or a link.

## Decision

What we do, stated so that someone can check the code against it.

## Alternatives considered

Each with the reason it lost.

## Consequences

What this costs, what it rules out, and what would make us revisit it.
```

## Index

Add one line per record at the end of the table (the file merges by union, so two branches never conflict here).

| Date | Decision | File |
|---|---|---|
| 2026-11-12 | A transaction is judged on its final status, and any failed receipt makes it a failure | `2026-11-12-tx-tracking-judged-at-final.md` |
| 2026-11-12 | View schemas drop unknown fields; what we send is strict | `2026-11-12-view-schemas-tolerate-extra-fields.md` |
| 2026-11-12 | Amounts round toward zero; times use a 24-hour clock with the zone name | `2026-11-12-amount-and-time-display.md` |
| 2026-11-12 | Each RPC endpoint gets a time limit and a short retry before the next one is tried | `2026-11-12-rpc-retries-before-failover.md` |
| 2026-11-12 | The promise sentence and the phase and claim words live in the client package | `2026-11-12-shared-words-live-in-client.md` |
| 2026-11-12 | The Rust and NEAR tools were installed from verified archives | `2026-11-12-rust-toolchain-installed-from-verified-archives.md` |
| 2026-11-12 | One cargo workspace; sandbox tests use `near-sandbox` with `near-api` | `2026-11-12-one-cargo-workspace-and-the-template-harness.md` |
| 2026-11-12 | A cancellation's reason is stored in `evidence_ref` | `2026-11-12-cancel-reason-shares-evidence-ref.md` |
| 2026-11-12 | Times are shown in the viewer's time zone, with the offset written out | `2026-11-12-times-shown-in-the-viewers-zone.md` |
| 2026-11-12 | The web offers the refund claim as soon as the deadline has passed | `2026-11-12-claim-shown-when-event-is-expirable.md` |
| 2026-11-12 | The exact millisecond of each time boundary is proven by a unit test | `2026-11-12-exact-time-boundaries-in-unit-tests.md` |
| 2026-11-12 | Token metadata is derived from the event, not stored per ticket | `2026-11-12-token-metadata-derived-from-the-event.md` |
| 2026-11-12 | Error codes and behaviour for the cases the frozen interface does not name | `2026-11-12-codes-for-cases-the-interface-does-not-name.md` |
| 2026-11-12 | The liquidity check runs after the reservation is written | `2026-11-12-liquidity-check-after-the-reservation.md` |
