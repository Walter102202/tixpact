# The liquidity check runs after the reservation is written

Date: 2026-11-12. Author: Track C. Status: accepted.

## Context

Task C2 lists the steps inside a claim as "checks, liquidity check, debit the ledger, record the operation, set the ticket status, emit `*_requested`, then the transfer". The frozen interface defines the check as `account_balance - X >= storage_usage * storage_byte_cost + total_held`, with `total_held` taken "after this operation is reserved". Recording the operation and a history entry adds storage (about 250 bytes), so a check that runs before them reads a `storage_usage` smaller than the one the call ends with. `near_sdk::store` collections also write only on flush, so `env::storage_usage()` read mid-call misses pending writes (plan, "Known traps").

## Decision

In `claim_refund` and `claim_payout` the order is: checks; debit the ledger and `total_held`; record the operation; lock the ticket and add its history entry; save; flush every `store` collection; the liquidity check; emit `*_requested`; schedule the transfer and its callback. `ensure_liquidity` (`contract/src/settlement.rs`) flushes before it reads `env::storage_usage()`. A failed check panics, so every earlier write of the call is reverted and "changes nothing" still holds.

## Alternatives considered

- The plan's literal order (check before the writes): the check would count less storage than the call leaves behind, so in a zero-slack state ticket money could pay for those bytes, against R9.
- Check before the writes and add an estimate of the bytes they add: one more constant to keep right.

## Consequences

Tests `t19_events_do_not_share_money` and `t24_restored_claim_waits_for_liquidity` build the shortfall with `patch_state` and see `ERR_INSUFFICIENT_LIQUIDITY` with nothing changed. A mutation that removes the check from `claim_refund` makes both fail.
