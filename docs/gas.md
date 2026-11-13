# Gas and storage of the ticket escrow

Measured on 2026-11-13 in the local sandbox (`near-sandbox` 0.4.1). Two tests take the measurements, and each fails if a constant no longer matches them.

- Gas: `contract/tests/gas.rs`. Print the table with `bash scripts/wsl.sh cargo test -p ticket-escrow --test gas -- --nocapture`.
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
| `create_event` (capacity 100, longest title and venue) | 30 | 1.81 | - | 2.37 |
| `accept_verification` | 30 | 1.81 | - | 2.35 |
| `buy_ticket` (3rd ticket of the contract) | 50 | 4.01 | - | 4.54 |
| `buy_ticket` (100th ticket of the event, 102nd of the contract) | 50 | 6.06 | - | 6.59 |
| `nft_transfer` (full history, longest memo) | 30 | 3.62 | - | 4.17 |
| `nft_transfer_call` at `GAS_TRANSFER_CALL_MIN` + `nft_resolve_transfer` (returned) | 50 | 4.23 | 3.11 | 9.52 |
| `nft_transfer_call` + `nft_resolve_transfer` (receiver panics, returned) | 150 | 4.23 | 3.11 | 9.52 |
| `nft_transfer_call` + `nft_resolve_transfer` (receiver keeps) | 150 | 4.11 | 1.93 | 8.24 |
| `attest_completed` (longest evidence) | 30 | 1.81 | - | 2.35 |
| `claim_payout` + `on_payout_result` (delivered) | 100 | 2.69 | 2.03 | 5.92 |
| `claim_payout` + `on_payout_result` (transfer failed) | 100 | 2.66 | 2.00 | 8.86 |
| `expire_event` | 30 | 1.79 | - | 2.33 |
| `cancel_event` (longest reason) | 30 | 1.81 | - | 2.35 |
| `claim_refund` + `on_refund_result` (full history, delivered) | 100 | 3.17 | 2.43 | 6.80 |
| `claim_refund` + `on_refund_result` (full history, transfer failed) | 100 | 3.17 | 2.42 | 9.77 |
| `claim_refund` at `GAS_CLAIM_MIN` + `on_refund_result` (full history, delivered) | 40 | 3.17 | 2.43 | 6.80 |

In the two "transfer failed" rows the call came from a test contract that attaches 100 Tgas.

## Contract constants

The contract has no upgrade method (R10), so its gas constants can never be raised after deployment. If protocol gas costs rise, a callback with too little static gas fails and leaves its payment pending for good. Every constant therefore keeps at least five times the measured worst case.

| Constant | Value | Rule | Check |
|---|---:|---|---|
| `GAS_FOR_CALLBACK` (static gas of `on_refund_result`, `on_payout_result`) | 15 Tgas | 5 × 2.43 Tgas, rounded up to 5 Tgas | 6.2 times the worst callback |
| `GAS_FOR_RESOLVE_TRANSFER` (static gas of `nft_resolve_transfer`) | 20 Tgas | 5 × 3.11 Tgas, rounded up to 5 Tgas | 6.4 times the worst resolver |
| `GAS_CLAIM_MIN` (least gas for `claim_refund`, `claim_payout`) | 40 Tgas (was 60) | 15 Tgas callback + 5 × 3.17 Tgas, rounded up to 10 Tgas | a full-history claim at exactly 40 Tgas succeeds |
| `GAS_TRANSFER_CALL_MIN` (least gas for `nft_transfer_call`) | 50 Tgas | 20 Tgas resolver + 5 × 4.23 Tgas, rounded up to 10 Tgas | at exactly 50 Tgas the receiver still runs and the resolver returns the ticket |

Below a minimum the call fails with `ERR_INSUFFICIENT_GAS` before it writes anything.

## Client gas

The client values (`packages/client/src/actions.ts`, plan section "Gas") all work in the worst case, with at least 7 times what the whole transaction burns. No change is needed.

| Method | Client (Tgas) | Worst whole transaction (Tgas) |
|---|---:|---:|
| `create_event` | 30 | 2.37 |
| `accept_verification` | 30 | 2.35 |
| `buy_ticket` | 50 | 6.59 |
| `cancel_event` | 30 | 2.35 |
| `attest_completed` | 30 | 2.35 |
| `expire_event` | 30 | 2.33 |
| `claim_refund` | 100 | 9.77 |
| `claim_payout` | 100 | 8.86 |
| `nft_transfer` | 30 | 4.17 |
| `nft_transfer_call` | 150 | 9.52, plus whatever the receiver contract spends |

## `buy_ticket` grows with the number of tickets

Every ticket of every event lives in one token tree, and a purchase adds one node to it. From the 3rd to the 102nd ticket, about five doublings, the purchase grew from 4.01 to 6.06 Tgas: about 0.4 Tgas per doubling.

A rough estimate, assuming the same cost per doubling, gives about 11 Tgas at a million tickets. It gives about 19 Tgas at the largest number of tickets the ids allow (4.3 × 10^11). Both are under the client's 50 Tgas. Transfers do not grow, because they only change the owner of an existing node.

## Storage per event and per ticket

| | Measured worst case | Constant (worst case + 20%) | What is counted |
|---|---:|---:|---|
| `storage_per_event` | 1,144 bytes | 1,373 bytes | the event record with 64-character organizer, verifier and resolver, the longest title, venue and evidence, and a payout in flight |
| `storage_per_ticket` | 2,129 bytes | 2,555 bytes | the ticket record with a full history of 64-character accounts, its token entries, an owner index of its own, a pending refund, and the longest possible ticket id |

The ticket was measured with the id `10-100`. An id is stored six times, so the longest possible id (`4294967295-100`, 8 bytes longer) adds 48 bytes; the measurement includes them.

`quote_event_budget(capacity)` is `storage_per_event + capacity × storage_per_ticket`, at 10^19 yoctoNEAR per byte.

On chain, `t16_storage_stays_within_budget` (`contract/tests/storage.rs`) builds two events:

- a full event of 10 tickets, each moved 20 times and left with a pending refund, with 64-character accounts;
- an event of one ticket with a pending payout.

Together they store 23,507 bytes against 30,851 bytes of prepaid budget, and they stay within the budget after every transaction.
