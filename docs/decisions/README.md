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

Newest first. Add one line per record.

| Date | Decision | File |
|---|---|---|
| 2026-11-12 | The promise sentence and the phase and claim words live in the client package | [2026-11-12-shared-words-live-in-client.md](2026-11-12-shared-words-live-in-client.md) |
| 2026-11-12 | Each RPC endpoint gets three attempts before the next one is tried | [2026-11-12-rpc-retries-before-failover.md](2026-11-12-rpc-retries-before-failover.md) |
| 2026-11-12 | Amounts round toward zero; times use a 24-hour clock with the zone name | [2026-11-12-amount-and-time-display.md](2026-11-12-amount-and-time-display.md) |
| 2026-11-12 | View schemas drop unknown fields; what we send is strict | [2026-11-12-view-schemas-tolerate-extra-fields.md](2026-11-12-view-schemas-tolerate-extra-fields.md) |
| 2026-11-12 | A transaction is judged on its final status, and any failed receipt makes it a failure | [2026-11-12-tx-tracking-judged-at-final.md](2026-11-12-tx-tracking-judged-at-final.md) |
