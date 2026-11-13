# A payment whose receipt succeeded settles, whatever the token answers

Date: 2026-11-13. Author: lane C2. Status: accepted. Replaces the last bullet ("A listed token is trusted", second half) of `2026-11-13-token-payments-share-the-settlement-path.md`. Consequences corrected the same day with lane T2's measurement: the first version put the limit at about 4 MB and 300 Tgas, against the published fee only.

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

The callback never deserializes the answer, but the host still copies it into a register before the length check (`near-sdk` 5.30.1 `env::promise_result_checked`). How much that costs:

- Measured in the sandbox (protocol 88), almost nothing: a hostile token given a 300 Tgas claim answered 3,974,130 bytes, and `on_refund_result` settled it for 2.33 Tgas in all (lane T2, `a_token_answer_settles_at_the_most_gas_a_claim_can_attach`). The resolver showed the same thing with a 4 MiB answer (`docs/gas.md`).
- At the protocol's published fee (3,801,564 gas per byte, `write_register_byte`), the callback's 15 Tgas covers its worst work (2.52 Tgas) plus an answer of about 3.28 MB. A token needs about 230 Tgas to answer that much, so only a claim that attaches about 250 Tgas or more, against a hostile listed token, can go past it. The client attaches 100 Tgas, which buys at most 1,116,987 bytes (4.25 Tgas to copy).

Past that bound the callback runs out of gas, and that one operation stays pending like a v1 callback out of gas (threat model, Limits 2). It still never pays twice.
