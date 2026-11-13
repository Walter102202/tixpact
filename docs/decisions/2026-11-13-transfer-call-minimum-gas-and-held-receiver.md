# `nft_transfer_call` needs 50 Tgas, and `t13` holds the transfer open with a receiver that waits

Date: 2026-11-13. Author: Track C. Status: accepted.

## Context

Two things Task C3 leaves open.

1. The plan fixes the resolver's static gas (20 Tgas) but not the least gas `nft_transfer_call` accepts. The standard has one (`GAS_FOR_NFT_TRANSFER_CALL`, 25 Tgas plus its 5 Tgas resolver, `near-contract-standards` 5.30.1 `core_impl.rs`). Without one, a caller can attach so little that the resolver cannot run, and the ticket stays `TransferPending` for good (R8 would then lock it forever).
2. `t13` needs the event's start to pass while a transfer is unresolved. The plan's fixture modes (`keep`, `return`, `panic`, `garbage`, `oversized`, `reenter`) all answer in the same block.

## Decision

- `GAS_TRANSFER_CALL_MIN` is 50 Tgas (`contract/src/tickets.rs`), checked after the transfer checks and before any write; below it the call fails with `ERR_INSUFFICIENT_GAS` and nothing changes. The receiver gets all the gas left after the resolver's 20 Tgas are set apart (`with_unused_gas_weight(1)` on the receiver, `0` on the resolver). The value is provisional; Task C4 replaces it with a measured one.
- The receiver fixture has a seventh mode, `hold`: it calls itself once per block until someone calls its `release` method, then answers `true`. `t13` starts the transfer before the start, advances the clock past it, checks that a claim and a transfer by the receiver fail with `ERR_TICKET_LOCKED`, releases, and checks that the resolver returned the ticket in a block after the start.

## Alternatives considered

- No minimum: a call with too little gas could leave a ticket locked forever.
- A time-based wait (`wait:<ms>`): the receiver answers on its own as real blocks pass, so a slow sandbox could answer before the lock checks ran. `release` puts the test in control.
- A yielded promise (`promise_yield_create`): it costs no gas per block, but it times out after 200 blocks and the test would have to read the data id from a log. More moving parts than `hold` needs.

## Consequences

- `transfer_call_with_low_gas_fails_whole` (`contract/tests/transfers.rs`): 49 Tgas fails with nothing changed; exactly 50 Tgas to the `keep` receiver completes and clears the lock.
- Measured in one `t13` run: each `hold` step burns 1.43 Tgas plus a 0.22 Tgas gas-refund receipt, so a held transfer lasts more than 100 blocks at 300 Tgas; that run took 21 steps. In the same run `nft_transfer_call` burned 3.62 Tgas and the resolver, returning the ticket, 2.80 Tgas.
- The client's 150 Tgas for `nft_transfer_call` (plan, gas table) is well above the minimum.

## Correction, 2026-11-13 (after the C3 review)

Two statements in the context above are wrong. The constant stays.

- `near-contract-standards` 5.30.1 has no `GAS_FOR_NFT_TRANSFER_CALL`. Its `nft_transfer_call` (`core/core_impl.rs:390-415`) sets no minimum and passes gas on by weight. Its only gas constant is `GAS_FOR_RESOLVE_TRANSFER`, 5 Tgas (`:23`). The "25 + 5 Tgas" figure comes from older versions.
- A caller cannot attach so little that the resolver does not run. The resolver's static gas is reserved when `nft_transfer_call` creates the promise; without it the whole call fails and nothing changes. With little gas the receiver gets little, fails, and the resolver returns the ticket.

So the minimum does not protect the lock: it only guarantees the receiver a fair share of the gas. The resolver's own static gas protects the lock, and it must cover reading the longest answer (`2026-11-13-resolver-gas-covers-the-longest-answer.md`). That record sets the minimum to 70 Tgas; `transfer_call_with_low_gas_fails_whole` reads it from the crate.
