# The token tests read interface v2 strictly where money moves, and make one check fail at a time

Date: 2026-11-13. Author: lane T2. Status: accepted.

## Context

Lane T2 writes the sandbox tests of contract v2 (`t25`…`t33`, plan `2026-11-13-pass-group-verifier-dollars.md`) from the frozen interface, not from the contract. Several points the tests must decide are open in the text:

1. Two checks can fail at once (a token sent to a NEAR event usually also has the wrong amount), and the interface does not order the checks of `ft_on_transfer`.
2. R7 says the callback "confirms on success and restores on a confirmed failure". A NEP-141 `ft_transfer` may succeed and still return bytes. near-sdk 5.30.1 deserializes a non-empty result of `#[callback_result] r: Result<(), PromiseError>` as `()`, which panics (`near-sdk-macros-5.30.1/src/core_impl/code_generator/attr_sig_info.rs:273-299`); with a `max_bytes` limit, a long answer becomes `Err(PromiseError::TooLong)` instead.
3. "`Ticket {serial} of {capacity} for {title} at {venue}.` followed by one sentence" does not say what separates the two.
4. The image must be "at most 2 KB before encoding" but the title is free text up to 120 bytes.

## Decision

- **One check fails at a time.** Every rejection case is built so that only the check under test can fail: an accepted event on sale, a well-formed `msg`, and an amount equal to the price's number. A token sent to a NEAR event priced 1.5 NEAR sends 1.5 × 10^24 of `tEUR` (24 decimals); NEAR sent to a `tUSD` event priced 10,000,000 sends 10,000,000 yoctoNEAR. These are also the most dangerous cases: a contract that compared only numbers would sell a NEAR ticket for 1.5 tEUR and refund 1.5 NEAR.
- **Test tokens.** Every escrow under test lists `tUSD` (test token, 6 decimals), `tEUR` (test token, 24 decimals, so its amounts are as large as NEAR's) and `HOST` (hostile token, 18 decimals). Token contracts are deployed only by the tests that use them. `unlisted.sandbox` is a hostile token no escrow lists.
- **Never restored after paying (hard rule).** `a_token_that_pays_but_answers_oddly_never_pays_twice` accepts `Refunded` or `RefundPending` after a token paid and answered garbage or a long value, and fails on `Active`, on a restored right or on a second payment.
- **R7 read strictly (separate test).** `a_token_answer_does_not_stop_the_confirmation` expects such a refund to settle (`Refunded`): the token's receipt succeeded, so the transfer succeeded. It is a separate test so that, if the integrator rules the stricter reading out, it can be dropped without touching the money-safety test.
- **Description.** The fixed sentence and the claim sentence are joined by one space.
- **Image.** The 2 KB limit is checked on a 120-byte title made only of characters that need escaping (`<&>"'` and a space), and the raw `<&>` must not appear. The claim word on the image is the web's (`Claimable`, `Sending`, …), as lane C2 decided in `2026-11-13-the-ticket-draws-its-state.md`.
- **Purchase outcome.** A rejected purchase is: exactly one failed escrow receipt whose panic starts with the code, `ft_transfer_call` returning `"0"`, no `nft_mint` and no `ticket_purchased`; the buyer's balance is then checked to be whole. An accepted one returns the whole price as used and logs one `ticket_purchased`.
- **Existing tests.** The harness initializes every escrow with `new(tokens)`; the smoke test expects version `2.0.0` and the listed tokens; `t22` expects `media`, `media_hash` and `extra` to be set (lane C2 tightened it further). No v1 assertion was removed.

## Alternatives considered

- Ordering the checks in the tests (for example "currency before amount"): it would pin an order the interface never fixed and fail a correct contract.
- Folding the strict R7 reading into `t31`: a frozen test name would then fail on a reading the interface does not spell out.
- Accepting any `ERR_` code for a bad token list: lane C2 recorded `ERR_LIMIT` and `ERR_INVALID_TERMS` (`2026-11-13-token-list-checks-at-new.md`), so the test pins those.

## Consequences

A contract that settles token transfers by deserializing the callback result fails `a_token_answer_does_not_stop_the_confirmation` but passes every frozen test. A contract that treats a long answer as a failed transfer fails both `a_token_that_pays…` and `t31`'s spirit; that one is a double payment and must be fixed before v2 ships.
