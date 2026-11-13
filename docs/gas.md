# Gas and storage of the ticket escrow

Measured on 2026-11-13 in the local sandbox (`near-sandbox` 0.4.1), for contract v2 (events in NEAR or in a NEP-141 token). Two tests take the measurements, and each fails if a constant no longer matches them.

- Gas: `contract/tests/gas.rs`. Print the table with `bash scripts/wsl.sh cargo test -p ticket-escrow --test gas -- --nocapture` (`gas_of_every_method_in_its_worst_case` for NEAR, `gas_of_token_settlement_in_its_worst_case` for a token).
- Storage: the unit test `storage_constants_are_the_measured_worst_case_plus_twenty_percent` in `contract/src/tests.rs`.

Every case is the worst one the contract allows:

- account ids of 64 characters (the NEAR maximum);
- the longest title, venue, memo, `msg` and evidence or reason;
- tickets with a full history (16 entries);
- a capacity of 100.

## Gas per method

"Call" is the gas burnt by the escrow's own receipt. "Callback or resolver" is the receipt that confirms a payment or resolves a transfer. "Whole transaction" also counts the other receipts, such as the receiver contract, the transfer and the gas refunds.

| Case | Gas attached (Tgas) | Call (Tgas) | Callback or resolver (Tgas) | Whole transaction (Tgas) |
|---|---:|---:|---:|---:|
| `create_event` (capacity 100, longest title and venue) | 30 | 1.85 | - | 2.41 |
| `accept_verification` | 30 | 1.84 | - | 2.38 |
| `buy_ticket` (3rd ticket of the contract) | 50 | 4.05 | - | 4.58 |
| `buy_ticket` (100th ticket of the event, 102nd of the contract) | 50 | 6.10 | - | 6.63 |
| `nft_transfer` (full history, longest memo) | 30 | 3.65 | - | 4.20 |
| `nft_transfer_call` at `GAS_TRANSFER_CALL_MIN` + `nft_resolve_transfer` (returned) | 70 | 4.26 | 3.14 | 9.59 |
| `nft_transfer_call` + `nft_resolve_transfer` (receiver panics, returned) | 150 | 4.26 | 3.14 | 9.59 |
| `nft_transfer_call` + `nft_resolve_transfer` (4 MiB answer, returned) | 400 | 4.14 | 3.15 | 301.07 |
| `nft_transfer_call` + `nft_resolve_transfer` (receiver keeps) | 150 | 4.14 | 1.96 | 8.32 |
| `attest_completed` (longest evidence) | 30 | 1.84 | - | 2.38 |
| `claim_payout` + `on_payout_result` (delivered) | 100 | 2.73 | 2.07 | 6.00 |
| `claim_payout` + `on_payout_result` (transfer failed) | 100 | 2.70 | 2.04 | 8.94 |
| `expire_event` | 30 | 1.83 | - | 2.36 |
| `cancel_event` (longest reason) | 30 | 1.84 | - | 2.38 |
| `claim_refund` + `on_refund_result` (full history, delivered) | 100 | 3.20 | 2.47 | 6.88 |
| `claim_refund` + `on_refund_result` (full history, transfer failed) | 100 | 3.20 | 2.46 | 9.85 |
| `claim_refund` at `GAS_CLAIM_MIN` + `on_refund_result` (full history, delivered) | 40 | 3.20 | 2.47 | 6.88 |
| `claim_payout` at `GAS_CLAIM_MIN` + `on_payout_result` (delivered) | 40 | 2.70 | 2.05 | 5.95 |
| `claim_refund` at `GAS_CLAIM_MIN` + `on_refund_result` (expires the event first, full history, delivered) | 40 | 3.28 | 2.44 | 6.92 |

In the two "transfer failed" rows the call came from a test contract that attaches 100 Tgas.

In the "expires the event first" row the deadline passed and nobody expired the event. The claim resolves it as refundable, logs `event_resolved`, then claims, all in one call: the most work a claim does.

The "4 MiB answer" row is a hostile receiver: it answers with the longest value the protocol allows, 4,194,304 bytes. Returning it costs the receiver about 69.5 Mgas per byte, about 292 Tgas, so that transaction attaches 400 Tgas (the protocol allows 1,000 Tgas per transaction). The resolver still returns the ticket, and `t12_transfer_call_receiver_outcomes` checks the same on chain.

## Events priced in a token

Measured by `gas_of_token_settlement_in_its_worst_case` (lane T2) with the test token `fixtures/test-token` (a 64-character account id, 6 decimals), an event of the longest title and venue, and tickets with a full history. "Token" is the gas burnt by the token contract's receipts: `ft_transfer_call` and its resolver for a purchase, `ft_transfer` for a refund or a payout.

| Case | Gas attached (Tgas) | Call (Tgas) | Token (Tgas) | Callback (Tgas) | Whole transaction (Tgas) |
|---|---:|---:|---:|---:|---:|
| `ft_transfer_call` buys (call: `ft_on_transfer`) | 100 | 3.75 | 3.82 | - | 8.55 |
| `ft_transfer_call` rejected (`ERR_WRONG_DEPOSIT`; the token's resolver returns the amount) | 100 | 1.50 | 4.28 | - | 6.77 |
| `claim_payout` + `ft_transfer` + `on_payout_result` (delivered) | 100 | 2.86 | 1.72 | 2.10 | 7.66 |
| `claim_payout` + `ft_transfer` + `on_payout_result` (organizer not registered with the token) | 100 | 2.86 | 1.44 | 2.09 | 7.59 |
| `claim_refund` + `ft_transfer` + `on_refund_result` (full history, delivered) | 100 | 3.36 | 1.73 | 2.52 | 8.59 |
| `claim_refund` + `ft_transfer` + `on_refund_result` (holder not registered with the token) | 100 | 3.36 | 1.44 | 2.51 | 8.51 |
| `claim_refund` + `ft_transfer` + `on_refund_result` (expires the event first, full history, delivered) | 100 | 3.44 | 1.73 | 2.50 | 8.64 |

At exactly `GAS_TOKEN_CLAIM_MIN` (60 Tgas) a refund and a payout both deliver with the same numbers; at 59 Tgas both fail as a whole with `ERR_INSUFFICIENT_GAS` and no token moves. The rows were measured on commit `075a9a7` (C6 and the first half of C7); the two changes after it touch only the callback's reading of the token's answer and the token's share of unused gas, which a standard token does not use.

**The token's answer is bounded.** The callback reads what `ft_transfer` answered (a standard token answers nothing). The token gets exactly `GAS_FT_TRANSFER` and no share of the claimant's unused gas, and answering costs about 69.5 Mgas per byte, so the longest answer it can give is about 288 KB. Copying that into the callback costs about 1.1 Tgas at the published fee, so the callback (15 Tgas, worst case 2.52 Tgas) always reads it and settles a transfer that went through (`docs/decisions/2026-11-13-a-payment-that-went-through-settles.md`). Before this bound, a hostile token given the leftover of 100 Tgas answered 1,116,987 bytes.

## Contract constants

The contract has no upgrade method (R10), so its gas constants can never be raised after deployment. If protocol gas costs rise, a callback or resolver with too little static gas fails: a payment stays pending, or a ticket stays locked, for good. Every constant therefore keeps a wide margin over the worst case.

| Constant | Value | Rule | Check |
|---|---:|---|---|
| `GAS_FOR_CALLBACK` (static gas of `on_refund_result`, `on_payout_result`) | 15 Tgas | 5 × 2.52 Tgas (a token refund; 2.47 for NEAR) = 12.6 Tgas, rounded up to the next multiple of 5 Tgas | about 6 times the worst callback, with room for reading a token's longest answer (1.1 Tgas) |
| `GAS_FOR_RESOLVE_TRANSFER` (static gas of `nft_resolve_transfer`) | 40 Tgas (was 20) | 2 × (15.94 Tgas to read the longest answer + 3.15 Tgas of work) = 38.18 Tgas, rounded up to the next multiple of 5 Tgas | 12.7 times the worst resolver measured |
| `GAS_CLAIM_MIN` (least gas for `claim_refund`, `claim_payout`) | 40 Tgas (was 60) | 15 Tgas callback + 5 × 3.28 Tgas (the claim that expires the event) = 31.4 Tgas, rounded up to the next multiple of 10 Tgas | a full-history refund, a refund that expires the event and a payout each succeed at exactly 40 Tgas |
| `GAS_FT_TRANSFER` (gas of the `ft_transfer` that pays a token refund or payout; the token gets no more) | 20 Tgas | 5 × 1.73 Tgas (the test token's worst `ft_transfer`) = 8.65 Tgas gives 10 Tgas rounded up to 5; kept at 20 because the contract cannot be upgraded and a real token may do more work than the test token | 11.6 times the test token's worst `ft_transfer`; bounds the token's answer to about 288 KB |
| `GAS_TOKEN_CLAIM_MIN` (least gas for `claim_refund`, `claim_payout` on an event priced in a token) | 60 Tgas | 20 Tgas `ft_transfer` + 15 Tgas callback + 5 × 3.44 Tgas (the token claim that expires the event) = 52.2 Tgas, rounded up to the next multiple of 10 Tgas | a refund and a payout each succeed at exactly 60 Tgas and fail as a whole at 59 |
| `GAS_TRANSFER_CALL_MIN` (least gas for `nft_transfer_call`) | 70 Tgas (was 50) | 40 Tgas resolver + 5 × 4.26 Tgas = 61.3 Tgas, rounded up to the next multiple of 10 Tgas | at exactly 70 Tgas the receiver still runs and the resolver returns the ticket |

Below a minimum the call fails with `ERR_INSUFFICIENT_GAS` before it writes anything. The gas test fails if any constant breaks its rule.

### The resolver must be able to read the longest answer

**Rule: `GAS_FOR_RESOLVE_TRANSFER` is never lowered below what reading the longest answer costs.**

- If `nft_resolve_transfer` runs out of gas, its writes are lost. The receiver keeps the ticket with status `TransferPending`, and nobody can clear the lock (`docs/threat-model.md`, Limits 3).
- Before the resolver looks at the first 5 bytes, the host copies the receiver's whole answer into a register. The protocol's published fee for that is 3,801,564 gas per byte (`write_register_byte`). An answer can be 4,194,304 bytes long (`max_length_returned_data`). Charged in full, reading it costs 15.94 Tgas.
- In the sandbox (protocol 88) the 4 MiB answer raised the resolver only from 3.14 to 3.15 Tgas. The constant does not count on that: it covers the published fee in full, plus the resolver's own worst case, twice over.
- The gas test reads both protocol values from the sandbox. It fails when a protocol change raises them far enough to break the rule, not on every rise: today the rule leaves 1.82 Tgas (40 against 38.18), so the fee alone could rise by almost 6% and still pass.
- `GAS_TRANSFER_CALL_MIN` does not protect the lock. The resolver's gas is reserved when `nft_transfer_call` creates the promise; if it is not there, the whole call fails. The minimum only leaves the receiver about 25 Tgas.

The settlement callbacks need no such rule. For NEAR they read the result of a plain transfer, which returns no value. For a token they read what `ft_transfer` answered, and that answer is bounded by the token's gas: `GAS_FT_TRANSFER` with no share of unused gas, so at most about 288 KB and 1.1 Tgas to read. Their static gas follows the measured worst case (2.52 Tgas, a token refund) with that read on top.

## Client gas

The client values (`packages/client/src/actions.ts`, plan section "Gas") all work in the worst case. No change is needed.

- For the claims and `nft_transfer_call`, the number that binds is the contract minimum, not the gas burnt: the callback's or resolver's static gas is reserved when the call runs. The client attaches 100 against a minimum of 40 (60 for a token), and 150 against 70.
- A purchase in a token is the buyer's `ft_transfer_call` on the token (plan v2: 100 Tgas from the client); its worst whole transaction is 8.55 Tgas.
- For the other methods it is what the whole transaction burns, and the client attaches at least 7 times that.

| Method | Client (Tgas) | Contract minimum (Tgas) | Worst whole transaction (Tgas) |
|---|---:|---:|---:|
| `create_event` | 30 | - | 2.41 |
| `accept_verification` | 30 | - | 2.38 |
| `buy_ticket` | 50 | - | 6.63 |
| `cancel_event` | 30 | - | 2.38 |
| `attest_completed` | 30 | - | 2.38 |
| `expire_event` | 30 | - | 2.36 |
| `claim_refund` | 100 | 40 (60 for a token) | 9.85 |
| `claim_payout` | 100 | 40 (60 for a token) | 8.94 |
| `nft_transfer` | 30 | - | 4.20 |
| `nft_transfer_call` | 150 | 70 | 9.59, plus whatever the receiver contract spends |

## `buy_ticket` grows with the number of tickets

Every ticket of every event lives in one token tree, and a purchase adds one node to it. From the 3rd to the 102nd ticket, about five doublings, the purchase grew from 4.05 to 6.10 Tgas: about 0.4 Tgas per doubling.

A rough estimate, assuming the same cost per doubling, gives about 11 Tgas at a million tickets. It gives about 19 Tgas at the largest number of tickets the ids allow (4.3 × 10^11). Both are under the client's 50 Tgas. Transfers do not grow, because they only change the owner of an existing node.

## Storage per event and per ticket

| | Measured worst case | Constant (worst case + 20%) | What is counted |
|---|---:|---:|---|
| `storage_per_event` | 1,213 bytes | 1,456 bytes | the event record with 64-character organizer, verifier, resolver and currency, the longest title, venue and evidence, and a payout in flight |
| `storage_per_ticket` | 2,129 bytes | 2,555 bytes | the ticket record with a full history of 64-character accounts, its token entries, an owner index of its own, a pending refund, and the longest possible ticket id |

The ticket was measured with the id `10-100`. An id is stored six times, so the longest possible id (`4294967295-100`, 8 bytes longer) adds 48 bytes; the measurement includes them.

The currency (contract v2) is stored once, in the event record: `null` costs 1 byte, a 64-character token id 69 (the event constant was 1,144 and 1,373 bytes before it). Neither the ticket nor its pending operation stores it, so a ticket bought with a token stores exactly the bytes of one bought with NEAR; the same unit test asserts both facts.

`quote_event_budget(capacity)` is `storage_per_event + capacity × storage_per_ticket`, at 10^19 yoctoNEAR per byte.

On chain, `t16_storage_stays_within_budget` (`contract/tests/storage.rs`) builds two events:

- a full event of 10 tickets, each moved 20 times and left with a pending refund, with 64-character accounts;
- an event of one ticket with a pending payout.

Together they store 23,509 bytes against 31,017 bytes of prepaid budget, and they stay within the budget after every transaction.
