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
| 2026-11-12 | The agent's exposure counts money still in the contract plus purchases not yet visible; writes run one at a time | `2026-11-12-agent-exposure-and-one-write-at-a-time.md` |
| 2026-11-12 | Agent writes return one of five statuses; the chain is checked before the policy | `2026-11-12-agent-write-results-and-checks.md` |
| 2026-11-12 | The agent's configuration fails closed, and the policy also bounds gas and deposits | `2026-11-12-agent-config-fails-closed.md` |
| 2026-11-12 | The agent's signer knows the transaction hash before sending, and judges send errors itself | `2026-11-12-agent-signer-knows-the-hash-before-sending.md` |
| 2026-11-13 | A purchase the agent signed counts against its cap until a read shows it is no longer exposure | `2026-11-13-agent-purchase-counts-until-a-read-clears-it.md` |
| 2026-11-13 | The agent signs only through RPC endpoints that confirmed testnet, and checks the chain before every signature | `2026-11-13-agent-signs-only-through-endpoints-confirmed-on-testnet.md` |
| 2026-11-13 | The refund watcher backs off a failing call, gives it up after five, and stops before the next call | `2026-11-13-agent-watcher-backs-off-and-gives-up.md` |
| 2026-11-13 | The agent's output hides RPC URLs and quotes organizer text on one line | `2026-11-13-agent-output-hides-rpc-urls-and-quotes-organizer-text.md` |
| 2026-11-13 | At start the agent accepts only .testnet accounts and checks that the key is a full-access key of AGENT_ACCOUNT_ID | `2026-11-13-agent-start-checks-testnet-accounts-and-the-key.md` |
