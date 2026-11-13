# The resolver's static gas covers reading the longest answer: 40 Tgas, and `nft_transfer_call` needs 70 Tgas

Date: 2026-11-13. Author: Track C. Status: accepted. Replaces the gas numbers of `nft_resolve_transfer` and `nft_transfer_call` in `2026-11-13-transfer-call-minimum-gas-and-held-receiver.md` and `2026-11-13-measured-storage-and-gas-constants.md`.

## Context

The C3 review found that a receiver can answer `nft_on_transfer` with up to 4,194,304 bytes (`max_length_returned_data`). Before the resolver reads its first 5 bytes, the host copies the whole answer into a register, at a published fee of 3,801,564 gas per byte (`write_register_byte`): 15.94 Tgas. If the resolver runs out of gas, the ticket stays `TransferPending` with the receiver, and nothing can clear the lock. The C4 rule of "5 × the measured worst case" measured only short answers, so it could have set the resolver below what a hostile answer costs.

## Decision

- The receiver fixture has a mode `huge` that answers with the longest value it can afford, which is exactly 4 MiB when the transaction attaches 400 Tgas. `t12` asserts that the ticket comes back to the sender, `Active`, and the gas test measures the resolver on it.
- Measured on protocol 88 (sandbox): the resolver burns 3.12 Tgas on the 4 MiB answer against 3.11 on a short one. The host does not charge the published fee on this read today.
- `GAS_FOR_RESOLVE_TRANSFER` = 2 × (15.94 Tgas, the published fee on the longest answer + 3.12 Tgas, the worst work) = 38.12, rounded up to 40 Tgas. The gas test reads both protocol values from the sandbox and asserts the rule.
- `GAS_TRANSFER_CALL_MIN` = 40 Tgas + 5 × 4.23 Tgas (the call's worst burn) = 61.15, rounded up to 70 Tgas.
- The client keeps 150 Tgas for `nft_transfer_call`.

## Alternatives considered

- 5 × the measured worst case (20 Tgas): it would rely on the host not charging the published fee, which a protocol change can undo, and the lock would then become permanent.
- 5 × (fee + work), about 95 Tgas: every transfer to a contract would need over 120 Tgas, and the published fee charged in full is already the worst case, not an estimate. Doubling it is margin enough.

## Consequences

- `docs/gas.md` states the rule: this constant is never lowered below what reading the longest answer costs.
- A caller cannot starve the resolver: its gas is reserved when `nft_transfer_call` creates the promise, or the call fails as a whole. The minimum only leaves the receiver about 25 Tgas.
- The settlement callbacks keep 15 Tgas. They read the result of a plain transfer, which returns no value.
- The plan's gas line (resolver 20 Tgas, minimum 60) is out of date; `docs/gas.md` has the values.
