# A token's longest answer must still settle: the long-answer tests stay strict

Date: 2026-11-13. Author: lane T2. Status: accepted.

## Context

The integrator ruled that a token receipt that succeeded settles the payment whatever it answered (strict R7), with one caveat: an answer so large that copying it exhausts the callback's 15 Tgas would leave the operation pending, the known callback-failure limit. The ruling allowed `Refunded` or `RefundPending` for a long answer and kept "must be `Refunded`" for answers of ordinary size.

Measured with the hostile token in `long` mode and `claim_refund` at 300 Tgas, the most one transaction can attach (`gas_of_token_settlement_in_its_worst_case`, `a_token_answer_settles_at_the_most_gas_a_claim_can_attach`, sandbox 2.14.1):

| Contract | Token burns (Tgas) | Answer (bytes) | Callback (Tgas) | Outcome |
|---|---:|---:|---:|---|
| d48705e: callbacks read the answer bounded at 0 bytes; the token gets the unused gas | 278.05 | 3,974,130 | 2.33 | Refunded |
| f64aa42: also, the token gets exactly `GAS_FT_TRANSFER` (20 Tgas) | 18.87 | 246,097 | 2.33 | Refunded |

Even the 3.97 MB answer, close to the 4 MiB maximum, cost the callback 2.33 Tgas. With f64aa42 the answer cannot grow past about 250 KB whatever the claimant attaches.

## Decision

- `a_token_answer_does_not_stop_the_confirmation` keeps expecting `Refunded` for both the 5-byte answer and the long one.
- `a_token_answer_settles_at_the_most_gas_a_claim_can_attach` expects `Refunded` at 300 Tgas.
- `a_token_that_pays_but_answers_oddly_never_pays_twice` stays the hard rule: `Refunded` or `RefundPending`, never a restored right, never a second payment.

## Alternatives considered

- Relax the long-answer cases to `Refunded` or `RefundPending`, as the ruling allowed: it guards against a limit that no claim can reach, by both measurements above, and it would no longer catch a callback that leaves long answers pending for some other reason.

## Consequences

If a protocol or sandbox upgrade ever makes copying the answer cost more than the callback's static gas, the two strict long-answer tests turn red. Then relax only their long case to the hard rule, as the ruling describes; the 5-byte case and the hard-rule test stay as they are.

## Update, same day

Lane C2's cce6572 reverts f64aa42 (`2026-11-13-the-token-gets-at-least-its-static-gas.md`), so the first row holds again: measured on track/t2 71e4b6d, 278.05 Tgas, 3,974,126 bytes, callback 2.33 Tgas, Refunded. Why the copy costs almost nothing: in the runtime, `promise_result` puts the answer in the register with `set_rc_data` (near-vm-runner 0.38.1, `src/logic/host.rs:4636`), which pays `write_register_base` but no `write_register_byte` ("the data is shared, not copied", `src/logic/vmstate.rs:82-113`). The per-byte fee of 3,801,564 gas that C2's record applies is charged for other register writes, not for promise results.

Lane C2's 479ef78 gives the callbacks the same share of unused gas as the token (`CALLBACK_GAS_WEIGHT`). Measured on track/t2 21a802a at 300 Tgas: the token burns 148.46 Tgas and answers 2,110,112 bytes; the callback burns 2.33 Tgas and the refund ends `Refunded`. The tests' expectations did not change.
