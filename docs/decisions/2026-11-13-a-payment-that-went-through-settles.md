# A payment whose receipt succeeded settles, whatever the token answers

Date: 2026-11-13. Author: lane C2. Status: accepted. Replaces the last bullet ("A listed token is trusted", second half) of `2026-11-13-token-payments-share-the-settlement-path.md`.

## Context

The C6 callbacks took `#[callback_result] transfer: Result<(), PromiseError>`. For that type `near-sdk` 5.30.1 accepts an empty answer, deserializes anything else as JSON and panics when it is not `null` (`near-sdk-macros/src/core_impl/code_generator/attr_sig_info.rs:273-299`). A token whose `ft_transfer` succeeds but answers a value therefore made the callback fail before its body ran: the holder was paid, and the ticket stayed `RefundPending` with its amount in `refund_pending` for good. Lane T2 pinned the opposite expectation (`a_token_answer_does_not_stop_the_confirmation`): R7 says the callback confirms a transfer that succeeded, and a receipt that succeeded did run its transfer, since only a failed receipt is reverted.

The obvious alternative fix, a byte limit on the answer, is dangerous on its own: a long answer then arrives as `Err(PromiseError::TooLong)`, and the v1 test `transfer.is_ok()` would restore the right after a payment that went through, a double payment.

## Decision

- Both callbacks read the answer with `#[callback_result(max_bytes = 0)]`: an empty answer is `Ok(())`, any value is `Err(TooLong(n))`, a failed receipt is `Err(Failed)`. Nothing is deserialized.
- `delivered(&transfer)` is `!matches!(transfer, Err(PromiseError::Failed))`: only a confirmed failure restores. `TooLong` settles. Unit tests `a_payment_that_answered_a_value_still_settles` and `a_payout_that_answered_a_value_still_settles` pin it.
- NEAR transfers are unchanged: they always answer nothing.

## Alternatives considered

- Keep the C6 behaviour (the operation stays pending): never pays twice, but records a payment that happened as pending forever, which breaks R7 and leaves `refund_pending` wrong in the proof page.
- Read the raw result with `env::promise_result_checked` inside the body: the same effect with more code than the attribute's own bound.

## Consequences

The one way left for a token to leave an operation pending is an answer so long that copying it costs more than the callback's 15 Tgas (about 4 MB, which itself costs the token about 290 Tgas, so the claimant would have to attach more than 300 Tgas): the callback runs out of gas, and the operation stays pending like a v1 callback out of gas (threat model, Limits 2). It still never pays twice.
