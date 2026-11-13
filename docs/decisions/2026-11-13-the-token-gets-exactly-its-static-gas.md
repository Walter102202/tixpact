# The token's `ft_transfer` gets exactly 20 Tgas, and a token claim needs 60 Tgas

Date: 2026-11-13. Author: lane C2. Status: replaced by `2026-11-13-the-token-gets-at-least-its-static-gas.md` (applied in commit `f64aa42`, removed by the integrator's ruling in the next commit).

## Context

C6 sent a token refund or payout as `ft_transfer` with `GAS_FT_TRANSFER` of static gas and the default share of unused gas, so the token received whatever the claimant attached beyond the callback. Lane T2 measured (`gas_of_token_settlement_in_its_worst_case`, commit `075a9a7`) that the test token's worst `ft_transfer` burns 1.73 Tgas, a token claim burns at most 3.44 Tgas, a token callback at most 2.52 Tgas, and that a hostile token handed the leftover of 100 Tgas answered 1,116,987 bytes. The callback must copy that answer before it can settle (`2026-11-13-a-payment-that-went-through-settles.md`), and a long enough answer would run it out of gas.

## Decision

- `ft_transfer` gets `GAS_FT_TRANSFER` = 20 Tgas and no share of unused gas (`with_unused_gas_weight(0)`). The longest answer a token can then pay for is about 288 KB, about 1.1 Tgas for the callback to copy, well inside its 15 Tgas.
- 20 Tgas, not the 10 Tgas that the margin rule of `docs/gas.md` gives (5 × 1.73, rounded up to 5): the contract cannot be upgraded, and a real token may do more work in `ft_transfer` than the test token. A token that needs more than 20 Tgas fails the transfer, and the callback gives the right back.
- `GAS_TOKEN_CLAIM_MIN` stays 60 Tgas: 20 + 15 + 5 × 3.44 = 52.2, rounded up to 10. T2 checked that both claims deliver at 60 and fail as a whole at 59.

## Alternatives considered

- Give the token the leftover gas: more room for an expensive token, but the length of its answer, and so whether the callback can read it, would depend on how much gas the claimant attached.
- 10 Tgas by the margin rule: enough for the test token, too tight for an unknown real one, with no way to raise it later.

## Consequences

A token whose `ft_transfer` needs more than 20 Tgas cannot be used to pay refunds or payouts; holders keep their right and the money stays in the contract. Choosing the tokens at deployment is where that is checked.
