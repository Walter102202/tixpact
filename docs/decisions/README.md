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
| 2026-11-13 | The release goes to a clean account, `ticket-escrow.testnet`, with the same wasm; its key is deleted only with Walter present | `2026-11-13-the-release-goes-to-a-clean-account.md` |
| 2026-11-13 | Client v2: token calls name their receiver, terms default to NEAR, token reads are `Reader` methods, views require `currency` | `2026-11-13-client-v2-interface-additions.md` |
| 2026-11-13 | A purchase is judged by the `ticket_purchased` event of a receipt that succeeded, from the contract when its id is given | `2026-11-13-client-v2-purchase-verdict-from-logged-events.md` |
| 2026-11-13 | `FIXTURES` stays the NEAR chain; `FIXTURES_WITH_TOKENS` adds three tUSD events, one per outcome | `2026-11-13-client-v2-fixtures-keep-near-set-and-add-a-token-set.md` |
| 2026-11-13 | The agent buys only in NEAR (its caps are in NEAR) and reads, claims and checks every currency | `2026-11-13-agent-buys-in-near-and-reads-every-currency.md` |
| 2026-11-13 | The web writes every amount in its event's currency, judges a token purchase from its receipts and checks token registration before money moves | `2026-11-13-web-prices-in-a-token.md` |
| 2026-11-13 | The organizer picks a currency, a payout in a token checks registration, and the proof compares each currency on its own | `2026-11-13-web-organizer-and-proof-per-currency.md` |
| 2026-11-13 | After a token transaction, the web says what happened to whom: a refused refund or payout in plain words, one result per account, test money named as such, the price on the create button | `2026-11-13-web-token-results-after-review.md` |
| 2026-11-13 | The token list given to `new` is checked strictly (`ERR_LIMIT` over 4, `ERR_INVALID_TERMS` otherwise); the currency is stored once, in the event | `2026-11-13-token-list-checks-at-new.md` |
| 2026-11-13 | The ticket's metadata is derived when read: the web's claim words, a title cut at 26 characters, escaped text, an image under 2 KB | `2026-11-13-the-ticket-draws-its-state.md` |
| 2026-11-13 | The token tests read interface v2 strictly where money moves, make one check fail at a time, and never accept a right restored after a payment | `2026-11-13-token-tests-read-the-interface-this-way.md` |
| 2026-11-13 | Token payments go through the v1 reserve-first path with `ft_transfer`; `ft_on_transfer` checks its caller first; a token claim needs 60 Tgas; a listed token is trusted | `2026-11-13-token-payments-share-the-settlement-path.md` |
| 2026-11-13 | A changed account in an entry pass fails the `key` check, not `signature`: NEP-413 does not sign the account | `2026-11-13-entry-pass-account-bound-by-the-key-check.md` |
| 2026-11-13 | The entry pass hash uses `@noble/hashes` 2.4.0, declared by the client package (already in the lockfile through near-api-js) | `2026-11-13-entry-pass-sha256-from-noble-hashes.md` |
| 2026-11-13 | The agent's `show_entry_pass` refuses tickets the door would refuse, and is read-only; `scripts/pass.mjs request` builds the CLI command | `2026-11-13-agent-entry-pass-tool.md` |
| 2026-11-13 | The web's entry pass: one click to sign, the pass in the URL fragment, the door's verdict ("Admit", "Do not admit", "Already admitted") per device; QR by `uqr` 0.1.3 | `2026-11-13-web-entry-pass-pages.md` |
| 2026-11-13 | A verifier is shown as a group when its Sputnik DAO policy says one group decides function calls; `needed` counts the quorum as the contract does | `2026-11-13-group-verifier-reads-the-dao-policy.md` |
| 2026-11-13 | Entry pass signatures are verified under RFC 8032's strict rules (`@noble/curves` 2.4.0, `zip215: false`): ZIP-215 accepts a forgery for small-order keys | `2026-11-13-entry-pass-strict-ed25519.md` |
| 2026-11-13 | The door page is one the attendant opens from their own bookmark; it names its site, and demo verdicts read "Demo: would admit" | `2026-11-13-door-opened-by-the-attendant.md` |
| 2026-11-13 | The door records an admission with its "Admit" verdict (with an "Undo"), per mode; a ticket admitted here reads "Do not admit" | `2026-11-13-door-records-admission-with-the-verdict.md` |
| 2026-11-13 | A role of any other kind that can approve calls, `Everyone` included, makes the verifier read as a plain account | `2026-11-13-group-verifier-any-other-approver-gives-null.md` |
| 2026-11-13 | The door page scans QR codes itself with `BarcodeDetector` where the browser has it; no new dependency; not tried on a physical phone | `2026-11-13-door-scanner-in-the-page.md` |
| 2026-11-13 | The group verifier counts every label that can change who decides calls (`policy…`, members, upgrades, config); `needed` is the minimum; the line says "its rules now" | `2026-11-13-group-verifier-counts-every-rule-changing-label.md` |
| 2026-11-13 | The entry pass and the prices in dollars share one demo reader; the countdown test waits for its interval | `2026-11-13-web-pass-and-prices-share-one-demo-reader.md` |
| 2026-11-13 | The door checks every new fragment and dates every verdict; Undo works after "Check again" and says whether it removed the admission | `2026-11-13-door-checks-every-arrival-and-undo-says-so.md` |
| 2026-11-13 | The group verifier also counts `factory_info_update` (Sputnik v3: replaces the factory, which can then replace the DAO's code) | `2026-11-13-group-verifier-counts-factory-info-update.md` |
| 2026-11-13 | The door looks the signing key up in the account's key list (`view_access_key_list`), so a missing key is an answer, not a failover error | `2026-11-13-pass-key-read-from-the-key-list.md` |
| 2026-11-13 | The ticket page shows the ticket as wallets show it: the contract's picture in an `<img>`, checked against its hash, and its sentence | `2026-11-13-web-ticket-as-wallets-show-it.md` |
| 2026-11-13 | A payment whose receipt succeeded settles whatever the token answers: callbacks read the answer bounded at 0 bytes and restore only on a confirmed failure | `2026-11-13-a-payment-that-went-through-settles.md` |
| 2026-11-13 | A token's longest answer must still settle: measured at 300 Tgas, the long-answer tests stay strict | `2026-11-13-long-token-answers-must-settle.md` |
| 2026-11-13 | Replaced by the next line: a token's `ft_transfer` gets exactly 20 Tgas (no share of unused gas, which bounds its answer) | `2026-11-13-the-token-gets-exactly-its-static-gas.md` |
| 2026-11-13 | A token's `ft_transfer` (at least 20 Tgas) and the settlement callbacks (at least 15 Tgas) share the claimant's unused gas, so a costly token can still be paid and no answer outruns the callback; a token claim needs 60 Tgas | `2026-11-13-the-token-gets-at-least-its-static-gas.md` |
| 2026-11-13 | Only the contract account can call `new(tokens)` (`#[private]`); deploy and init go in one transaction | `2026-11-13-only-the-contract-account-calls-new.md` |
| 2026-11-13 | Version 2 goes to its own account, `ticket-escrow-v2.testnet`, with the test token `tUSD` as its only listed token; every proof is played again there | `2026-11-13-version-2-goes-to-its-own-account.md` |
