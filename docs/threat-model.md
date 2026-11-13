# Threat model

Written before any contract code. It answers one question: who could keep or take money that is not theirs, and what stops them. Every line names the rule that stops it (R1–R11 in the plan's "Frozen interface") and the test that proves it (the plan's "Acceptance tests"). A line without a test is listed under "Limits", not here.

## What is protected

| Asset | Where it lives | Who may move it |
|---|---|---|
| The principal `P` of each ticket (the price paid) | The contract's balance, tracked per event | To the current holder if the event is `Refundable`; to the organizer if it is `Completed`. Nobody else, never both. |
| The right to that principal | The ticket token (NEP-171); the token's owner is the only record of who holds it | The holder, by transferring the ticket under R6 |
| The event outcome | Contract state, written once | The accepted verifier (complete), the organizer or the verifier (cancel), anyone after the deadline (expire) |
| Each event's operating budget (prepaid storage) | Contract balance, tracked per event | Nobody. It pays for storage only. |

## Who can attack

A previous holder, the current holder, a buyer, the organizer, the verifier, a contract that receives a ticket, any account calling any method, and whoever holds a key of the contract account.

## Threats and what stops them

### A previous or current holder

| # | Attack | What stops it | Rule | Test |
|---|---|---|---|---|
| H1 | Sell the ticket, then claim its refund | The right has no copy: `claim_refund` pays the token's current owner and rejects everyone else | R1 | `t07_refund_follows_the_holder` |
| H2 | Claim the refund twice | The right is debited and a pending operation recorded before the transfer is scheduled; a second claim fails while pending and after settlement | R7, R8 | `t08_no_double_refund` |
| H3 | Claim the refund, then sell the ticket while the payment is in flight | A ticket with a pending refund cannot be transferred | R8 | `t08_no_double_refund`, `t11_failed_callback_keeps_pending`, unit test `transfer_call_follows_every_transfer_rule` |
| H4 | Sell a ticket once the event has started or has an outcome, when its fate is already known to the seller | Transfers are allowed only while the event is `Unresolved` and before `starts_at_ms` | R6 | `t15_deadline_boundaries` |
| H5 | Hold the ticket from a contract that deletes itself while claiming, to make the payment fail and the state lie | A failed transfer restores the right exactly once and the ticket returns to `Active` | R7 | `t10_failed_transfer_restores_claim_once` |
| H6 | Claim with too little gas, so the money leaves but the confirmation cannot run | The call is rejected as a whole unless the prepaid gas covers the callback | R7 | `claim_with_low_gas_fails_whole` |

### A buyer

| # | Attack | What stops it | Rule | Test |
|---|---|---|---|---|
| B1 | Pay less than the price, or get change back from the mint | The deposit must equal the price exactly, and the mint returns nothing | R1, R4 | `t01_purchase_reserves_exact_price`, `t17_mint_keeps_the_deposit` |
| B2 | Buy before the verifier accepted, after the start, or beyond capacity | Sales need the acceptance, `now < starts_at_ms` and `sold < capacity` | R4 | `t02_purchase_needs_acceptance_and_capacity`, `t15_deadline_boundaries` |

### The organizer

| # | Attack | What stops it | Rule | Test |
|---|---|---|---|---|
| O1 | Withdraw the ticket money before the event, or without confirmation | `claim_payout` works only on a `Completed` event | R3 | `t03_organizer_cannot_withdraw_unresolved` |
| O2 | Disappear: never hold the event, never cancel | After the deadline anyone can switch the event to refunds; a holder's claim does it by itself | R2 | `t05_anyone_expires_after_deadline` |
| O3 | Change the date, the price, the verifier or the deadline after selling | Terms cannot change; the verifier accepted a hash of the exact terms | R5 | `create_event_rejects_bad_terms`, `t02_purchase_needs_acceptance_and_capacity` |
| O4 | Name themselves as verifier | Rejected at creation | R4 | `create_event_rejects_bad_terms` |
| O5 | Cancel or re-resolve an event after its outcome, to flip who gets paid | The outcome is written once | R2 | `t06_cancel_only_by_roles`, `t04_attestation_completes_event` |
| O6 | Collect a payout twice, or while one is in flight | The whole available amount is debited before the transfer; a second call finds nothing or a pending payout | R7 | `t18_payout_failure_paths` |
| O7 | Use a completed event's payout to drain the principal of another event | Per-event ledger plus a liquidity check over everything still owed, before any transfer | R9 | `t19_events_do_not_share_money` |
| O8 | Underpay storage so that ticket money ends up paying for it | The event prepays storage for its full capacity at creation | R9 | `t02_purchase_needs_acceptance_and_capacity`, `t16_storage_stays_within_budget` |

### The verifier

| # | Attack | What stops it | Rule | Test |
|---|---|---|---|---|
| V1 | Confirm the event before it ended, or after the deadline | Attestation is valid only with `ends_at_ms <= now < resolution_deadline_ms` | R2 | `t04_attestation_completes_event`, `t15_deadline_boundaries` |
| V2 | Never answer | The deadline: refunds open without the verifier | R2 | `t05_anyone_expires_after_deadline` |
| V3 | Someone else attests in the verifier's name | Only the accepted `verifier_id` can attest | R2 | `t04_attestation_completes_event` |

### A contract that receives a ticket

| # | Attack | What stops it | Rule | Test |
|---|---|---|---|---|
| C1 | Panic, return garbage or an oversized value from `nft_on_transfer` to leave the ticket in limbo | Anything that is not a clean "keep" returns the ticket; the lock is cleared on every path | R8 | `t12_transfer_call_receiver_outcomes` |
| C2 | Re-enter during the transfer: claim the refund or move the ticket before the transfer resolves | The ticket is locked before the transfer and until its resolver runs | R8 | `t12_transfer_call_receiver_outcomes` (`reenter`) |
| C3 | Stretch the transfer across the start time to end up with a ticket moved late | The resolver finishes the transfer it started and clears the lock regardless of time | R6, R8 | `t13_resolver_ignores_time_window` |

### Any account

| # | Attack | What stops it | Rule | Test |
|---|---|---|---|---|
| A1 | Call a callback directly to fake a result: mark a refund as paid, or restore a right that was already paid | Callbacks and the transfer resolver accept only the contract itself | R7 | `t14_callbacks_are_private` |
| A2 | Expire an event early to force refunds | Expiry fails before the deadline | R2 | `t15_deadline_boundaries` |
| A3 | Cancel an event without a role | Only the organizer or the verifier can cancel | R2 | `t06_cancel_only_by_roles` |
| A4 | Fill the contract's storage at someone else's cost | Each event pays for its own storage; text, page and history sizes are bounded | R9 | `t16_storage_stays_within_budget` |
| A5 | Move a ticket through an approval the holder gave earlier | Approvals are disabled | R6 | `t22_standard_token_surface` |

### Whoever holds a key of the contract account

| # | Attack | What stops it | Rule | Test |
|---|---|---|---|---|
| K1 | Replace the code, or delete the account and keep its balance | The final deployment has no access keys, and the code has no owner, admin or upgrade method | R10 | `scripts/verify-deployment.mjs` (T23) |

## Entry pass

A pass moves no money, so it is outside the rules above; this section says what it proves and what it does not. A pass is a NEP-413 message signed by the holder's wallet: `Entry pass`, the contract, the ticket and the time it was signed, with the contract as the NEP-413 recipient and the time again in the first 8 bytes of the nonce. Nothing is sent to the chain or to a server. The door page (`/door`) and `node scripts/pass.mjs verify` run the same five checks (`checkPass`, `packages/client/src/pass.ts`), reading the chain at `final` at the moment of the scan.

**What an admitted pass proves:** within the last five minutes, someone who controls a full-access key of the account named in the pass signed this message for this contract and this ticket; and right now that account holds the ticket, which is active and not refunded. It does not prove who is standing at the door.

| # | Attack | What stops it | Check | Test (`packages/client/src/pass.test.ts`) |
|---|---|---|---|---|
| E1 | Change the ticket, the time or the nonce of a pass | The signature is verified over the message rebuilt from the pass, and the nonce must start with the time | `signature` | "fails the signature when the ticket in the message changes", "… the time of issue changes", "… the nonce changes", "… the signature changes" |
| E2 | Show a pass made for a look-alike contract | The door rebuilds the message with its own contract as the recipient; a pass naming another contract fails | `signature` | "fails the signature when the recipient changes", "… names another contract than the door checks" |
| E3 | Put another account's name on someone's pass | NEP-413 does not sign the account; the signing key must be a full-access key of the account named, read on chain | `key` | "fails the key, not the signature, when the account changes" |
| E4 | Sell or give the ticket away, then still use a pass signed before | The holder is read at the scan, not at signing | `holder` | "holder: the ticket was transferred after the pass was signed" |
| E5 | Use a ticket that was refunded or is being refunded | The ticket must be `Active` and its claim not `Refunded` | `ticket` | "ticket: the ticket was refunded", "ticket: a refund or a transfer to a contract is in flight" |
| E6 | Sign with a key that was deleted, for example after a phone was lost | The access key is read at the scan; a deleted key fails | `key` | "key: the key was deleted after signing" |
| E7 | Sign with a function-call key, which apps the holder signed into may hold | Only a full-access key speaks for the account (as NEP-413 says) | `key` | "key: a function-call key signed it" |
| E8 | Replay an old pass | A pass admits for five minutes after signing, and one dated more than a minute ahead of the checking device is refused | `fresh` | "fresh: a pass six minutes old", "fresh: a pass dated two minutes ahead of this device", "fresh: the edges are inclusive" |
| E9 | Scan while the RPC is down or answers garbage | A read that fails fails the checks that need it; the verdict is "Do not admit" | all | "a chain that cannot be read fails the checks it answers, and still returns all five" |

The signature step accepts the known-answer vector signed by near-cli-rs 0.31.1, not by this code ("admits the pass when the chain agrees"), and the hash matches what near-api-js signs ("is the hash near-api-js signs for a NEP-413 message").

What a pass does not stop:

1. **A screenshot or link shared within five minutes.** Whoever shows it is admitted, on any device that has not seen it. On the device that admitted it first, the second scan reads "Already admitted on this device at …". Five minutes is the window.
2. **No record of admissions shared between devices.** "Already admitted" lives in that browser's storage only. Two entrances with two devices could each admit the same ticket within the window, and clearing the browser's data forgets it. A shared record needs a server or a transaction at the door, which this design does not have.
3. **The attendant's clock.** Freshness is judged by the checking device's clock. A clock far ahead turns valid passes into "expired"; a clock far behind accepts passes older than five minutes. The sentence a failed `fresh` check shows tells the attendant to check the clock.
4. **A key deleted after the scan.** The checks hold at the moment of the scan, not after it.
5. **A hostile copy of the door page, or a lying RPC endpoint.** Either can say "Admit" for anything. The attendant must use the real site; `scripts/pass.mjs verify` with an RPC of one's choice is an independent check (Limit 7 below).

## Limits

What this design does not solve. The README repeats these in plain words.

1. **A verifier who lies.** If the accepted verifier confirms an event that did not happen, the contract pays the organizer. The contract enforces who decides and when, not whether they are right. Buyers see the verifier before buying. `t21_false_attestation_is_a_trust_limit` documents the behaviour.
2. **A hostile verifier can cancel a real event.** Holders are refunded, so buyers lose nothing; the organizer bears that risk when choosing the verifier.
3. **A callback that fails.** Callbacks are not retried and there is no admin to repair state. If a refund transfer succeeds and its callback fails, the ticket stays `RefundPending`: the holder was paid, nothing is paid twice, but the record never says "Refunded". If both the transfer and the callback fail, that ticket's principal stays in the contract with no way to claim it. The design makes this unlikely (gas is reserved up front and the callback does no work that can fail) and tests the first case (`t11_failed_callback_keeps_pending`), but it is not impossible.

   The transfer resolver has the same limit. If `nft_resolve_transfer` fails, the receiver contract holds the ticket and its status stays `TransferPending` for good: nobody can claim its refund or move it, and if the event becomes refundable its principal stays in the contract. Its static gas covers twice the published fee for reading the longest answer a receiver can send (4 MiB) plus its own measured work (`docs/gas.md`), and `t12_transfer_call_receiver_outcomes` returns a ticket after a 4 MiB answer. Only a protocol change that raised those costs past that margin could cause it.
4. **A lost key.** Whoever loses access to the account that holds a ticket loses the refund. Nobody can reassign it.
5. **A refund is the same amount of NEAR, not the same value.** The price of NEAR can move between purchase and refund.
6. **Until the keys are deleted.** Before the final deployment the deployer's key can change the code. The proof page and `scripts/verify-deployment.mjs` show the key list so anyone can check it is empty.
7. **The web is not the contract.** A hostile copy of the site could show false states. Every claim can be checked without the site: `scripts/direct-calls.sh` runs the whole flow from the command line, and each screen links to the explorer.
8. **Not audited, testnet only.** The storage and gas constants are measured, not proven, and protocol parameters can change.
9. **Out of scope.** Proof that a holder attended, resale price limits and identity checks. Entry control is only the five-minute pass above ("Entry pass"), with its own limits.
