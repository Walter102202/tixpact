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
| 2026-11-12 | The web uses a 60-line history router instead of a routing library | `2026-11-12-web-routes-without-a-router-library.md` |
| 2026-11-12 | Without a contract id the web runs on demo data, and says so on every page | `2026-11-12-web-demo-data-without-a-contract-id.md` |
| 2026-11-12 | Web test pins, the `process` replacement and the wallet-error wording | `2026-11-12-web-build-pins-and-the-process-shim.md` |
| 2026-11-12 | The ticket page: when the claim and the transfer are offered, and what counts as paid | `2026-11-12-web-ticket-page-claims-and-transfers.md` |
| 2026-11-12 | Organizer and verifier pages: checks before the wallet, a second click for irreversible decisions | `2026-11-12-web-organizer-and-verifier-pages.md` |
| 2026-11-12 | The proof page reads everything fresh, and every route fails the same visible way | `2026-11-12-web-proof-page-and-state-sweep.md` |
| 2026-11-12 | The exact millisecond of each time boundary is proven by a unit test | `2026-11-12-exact-time-boundaries-in-unit-tests.md` |
| 2026-11-12 | Token metadata is derived from the event, not stored per ticket | `2026-11-12-token-metadata-derived-from-the-event.md` |
| 2026-11-12 | Error codes and behaviour for the cases the frozen interface does not name | `2026-11-12-codes-for-cases-the-interface-does-not-name.md` |
| 2026-11-13 | After a transaction the page compares only what it changed, and an unknown result holds every action | `2026-11-13-web-review-fixes-for-w1-and-w2.md` |
| 2026-11-12 | The liquidity check runs after the reservation is written | `2026-11-12-liquidity-check-after-the-reservation.md` |
| 2026-11-13 | `nft_transfer_call` has a minimum gas (50 Tgas then, 70 Tgas since the resolver record below); `t13` holds the transfer open with a receiver that waits for `release` | `2026-11-13-transfer-call-minimum-gas-and-held-receiver.md` |
| 2026-11-12 | The agent's exposure counts money still in the contract plus purchases not yet visible; writes run one at a time | `2026-11-12-agent-exposure-and-one-write-at-a-time.md` |
| 2026-11-12 | Agent writes return one of five statuses; the chain is checked before the policy | `2026-11-12-agent-write-results-and-checks.md` |
| 2026-11-12 | The agent's configuration fails closed, and the policy also bounds gas and deposits | `2026-11-12-agent-config-fails-closed.md` |
| 2026-11-12 | The agent's signer knows the transaction hash before sending, and judges send errors itself | `2026-11-12-agent-signer-knows-the-hash-before-sending.md` |
| 2026-11-13 | A purchase the agent signed counts against its cap until a read shows it is no longer exposure | `2026-11-13-agent-purchase-counts-until-a-read-clears-it.md` |
| 2026-11-13 | The agent signs only through RPC endpoints that confirmed testnet, and checks the chain before every signature | `2026-11-13-agent-signs-only-through-endpoints-confirmed-on-testnet.md` |
| 2026-11-13 | The refund watcher backs off a failing call, gives it up after five, and stops before the next call | `2026-11-13-agent-watcher-backs-off-and-gives-up.md` |
| 2026-11-13 | The agent's output hides RPC URLs and quotes organizer text on one line | `2026-11-13-agent-output-hides-rpc-urls-and-quotes-organizer-text.md` |
| 2026-11-13 | At start the agent accepts only .testnet accounts and checks that the key is a full-access key of AGENT_ACCOUNT_ID | `2026-11-13-agent-start-checks-testnet-accounts-and-the-key.md` |
| 2026-11-13 | Storage and gas constants come from measured worst cases; static gas keeps five times the worst case | `2026-11-13-measured-storage-and-gas-constants.md` |
| 2026-11-13 | The resolver gets 40 Tgas so it can read the longest answer; `nft_transfer_call` needs 70 Tgas | `2026-11-13-resolver-gas-covers-the-longest-answer.md` |
| 2026-11-13 | An unknown result asks the chain again, and an irreversible step sends exactly what was checked | `2026-11-13-web-review-fixes-for-w3-and-w4.md` |
| 2026-11-13 | The wallet selector offers only Meteor and Intear, through an allow list on `availableWallets` | `2026-11-13-web-wallet-selector-meteor-and-intear.md` |
| 2026-11-13 | The landing states the problem and plays the refund: motion decided at mount, sticky floating header, fixed event columns | `2026-11-13-web-landing-problem-and-motion.md` |
