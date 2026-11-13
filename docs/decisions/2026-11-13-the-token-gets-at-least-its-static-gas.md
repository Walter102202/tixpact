# A token's `ft_transfer` and the settlement callbacks share the gas the claimant adds

Date: 2026-11-13. Author: lane C2, on the integrator's rulings. Status: accepted. Replaces `2026-11-13-the-token-gets-exactly-its-static-gas.md`.

## Context

Commit `f64aa42` gave the token's `ft_transfer` exactly `GAS_FT_TRANSFER` (unused gas weight 0), to bound how long an answer the callback might have to read. Lane T2 then measured, with the callback reading the answer at 0 bytes (`2026-11-13-a-payment-that-went-through-settles.md`), that a hostile token given a 300 Tgas claim answered 3,974,130 bytes and `on_refund_result` still settled it for 2.33 Tgas (`a_token_answer_settles_at_the_most_gas_a_claim_can_attach`, track/t2 `7a06884`). T2 withdrew the finding, and the integrator ruled against weight 0.

The final review asked whether the callback would still cover the answer if the host charged its copy into a register at the published per-byte fee (3,801,564 gas per byte, `write_register_byte`): 15.94 Tgas for 4 MiB. The runtime does not charge that fee for a promise result: in `near-vm-runner` 0.38.1, `promise_result` (`src/logic/host.rs:4636`) hands the data to the register with `set_rc_data`, which pays `write_register_base` only ("the data is shared, not copied", `src/logic/vmstate.rs:82-113`). That is why 3.97 MB cost the whole callback 2.33 Tgas, and why the resolver's 4 MiB answer cost it almost nothing (`docs/gas.md`). Lane T2 found the lines, and C2 checked them in the crate this build is tested with. Had the fee applied, the v1 callbacks (unused gas weight 0, exactly 15 Tgas) would have covered claims of up to about 250 Tgas only. The contract will have no keys, so the integrator ruled that the callback's safety must follow from arithmetic, not from today's fee schedule.

## Decision

- `ft_transfer` gets `GAS_FT_TRANSFER` (20 Tgas) of static gas and the default share of the claimant's unused gas. `GAS_FT_TRANSFER` is the floor, not the ceiling.
- `on_refund_result` and `on_payout_result` get `GAS_FOR_CALLBACK` (15 Tgas) and the same default share (`CALLBACK_GAS_WEIGHT`, `contract/src/settlement.rs`). On a token claim with unused gas U, the token has at least 20 + U/2 and the callback at least 15 + U/2. On a NEAR claim the callback is the only function call and gets all of U. What it does not burn is refunded.
- The `fault-injection` test build keeps the callback at weight 0, so its 100 Ggas callback still runs out of gas after its transfer (`t11`, `t18`).
- Unit tests pin the static gas and the share of the token's transfer and of both callbacks: `a_token_refund_is_an_ft_transfer_of_the_principal_with_one_yocto`, `a_token_payout_goes_to_the_organizer_and_its_failure_restores_it`, `a_near_refund_callback_gets_its_static_gas_and_the_unused_gas`.
- Static gas is unchanged, so every minimum stays: `GAS_TOKEN_CLAIM_MIN` 60 Tgas (20 + 15 + 5 × 3.44 = 52.2, rounded up to the next multiple of 10), `GAS_CLAIM_MIN` 40 Tgas.

## Why

- Liveness. The contract can never be upgraded. If a real token's `ft_transfer` ever needs more than 20 Tgas, weight 0 would make every refund and payout in that token fail for good. With a share, the claimant attaches more gas and the token gets it.
- The callback covers the answer under any fee schedule that charges the copy at no more than the published per-byte fee. A token buys a longer answer only with its own gas: about 14 KB per Tgas in T2's runs (1,116,987 bytes for 79.42 Tgas, 3,974,130 bytes for 278.05 Tgas). Even at the published fee, copying it would cost the callback about 0.054 Tgas per Tgas the token had. The callback would need at most 2.52 + 0.054 × (20 + U/2) Tgas and has 15 + U/2, which is more for every U.
- Observed today: the copy pays a fixed base only, and the whole callback burnt 2.33 Tgas at 3.97 MB, near the protocol's 4 MiB cap on an answer.

## Alternatives considered

- Weight 0 on the token (`f64aa42`): bounds the answer to about 288 KB whatever the claimant attaches, but a token that needs more than 20 Tgas could never pay a refund.
- A higher `GAS_FT_TRANSFER` or `GAS_FOR_CALLBACK` with weight 0: a fixed ceiling chosen today for tokens nobody has seen, and a higher minimum for every claim.
- Keep the v1 callbacks at weight 0 and rely on the runtime not charging the copy per byte: safe today, but if a later protocol charged it, claims above about 250 Tgas against a hostile listed token could strand their own operation.

## Consequences

No answer a listed token can give runs the callback out of gas, whatever gas the claimant attaches, so a transfer that went through always settles. A claim with more gas than it needs costs nothing extra: unused gas is refunded.
