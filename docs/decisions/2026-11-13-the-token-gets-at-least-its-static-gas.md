# A token's `ft_transfer` gets at least 20 Tgas and a share of the gas the claimant adds

Date: 2026-11-13. Author: lane C2, on the integrator's ruling. Status: accepted. Replaces `2026-11-13-the-token-gets-exactly-its-static-gas.md`.

## Context

Commit `f64aa42` gave the token's `ft_transfer` exactly `GAS_FT_TRANSFER` (unused gas weight 0), to bound how long an answer the callback might have to read. Lane T2 then measured, with the callback reading the answer at 0 bytes (`2026-11-13-a-payment-that-went-through-settles.md`), that a hostile token given a 300 Tgas claim answered 3,974,130 bytes and `on_refund_result` still settled it for 2.33 Tgas (`a_token_answer_settles_at_the_most_gas_a_claim_can_attach`, track/t2 `7a06884`). T2 withdrew the finding, and the integrator ruled against weight 0.

## Decision

- `ft_transfer` gets `GAS_FT_TRANSFER` (20 Tgas) of static gas and the default share of the claimant's unused gas, on purpose. `GAS_FT_TRANSFER` is the floor, not the ceiling. A unit test pins both (`a_token_refund_is_an_ft_transfer_of_the_principal_with_one_yocto`).
- Why: the contract can never be upgraded. If a real token's `ft_transfer` ever needs more than 20 Tgas, weight 0 would make every refund and payout in that token fail for good. With the default share, the claimant attaches more gas and the token gets it. That is the only remedy an immutable contract has.
- `GAS_TOKEN_CLAIM_MIN` stays 60 Tgas: 20 + 15 + 5 × 3.44 = 52.2, rounded up to the next multiple of 10. T2 measured with the default share and checked that both claims deliver at 60 and fail as a whole at 59.

## Alternatives considered

- Weight 0 (`f64aa42`): bounds the answer to about 288 KB whatever the claimant attaches, but a token that needs more than 20 Tgas could never pay a refund.
- A higher `GAS_FT_TRANSFER` with weight 0: still a fixed ceiling, chosen today for tokens nobody has seen.

## Consequences

More gas buys a hostile token a longer answer, and the host copies it into a register before the callback checks its length. In the sandbox that copy costs almost nothing (2.33 Tgas at 3.97 MB). At the protocol's published fee (3,801,564 gas per byte) the callback's 15 Tgas covers its worst work plus about 3.28 MB, which only a claim attaching about 250 Tgas or more can buy. Past that, the one operation of that claim stays pending like a v1 callback out of gas (threat model, Limits 2), and it never pays twice. The client attaches 100 Tgas, which buys at most 1,116,987 bytes (4.25 Tgas to copy at the published fee). Weight 0 would close this case at the cost above; this record chooses liveness.
