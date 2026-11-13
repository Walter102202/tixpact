# Token payments go through the same reserve-first path as NEAR, and a listed token is trusted

Date: 2026-11-13. Author: lane C2. Status: accepted; the second half of its last bullet (a token that answers a value leaves the operation pending) is replaced by `2026-11-13-a-payment-that-went-through-settles.md`.

## Context

Interface v2 (`docs/plans/2026-11-13-pass-group-verifier-dollars.md`, "Currencies") adds purchases paid in a NEP-141 token (`ft_on_transfer`) and refunds and payouts sent with `ft_transfer`. It fixes the codes and the shape but leaves open the order of the checks in `ft_on_transfer`, the code for an oversized `msg`, what a token claim must prepay, whether the NEAR liquidity check runs for a token claim, and what happens when a token answers in a way a standard token never does.

## Decision

- **One path.** `buy_ticket` and `ft_on_transfer` check the currency, then call the same `sell_ticket` (rule R4, the price, the mint, the ledger). `claim_refund` and `claim_payout` keep their v1 order (checks, reserve, record the operation, lock, log, then the payment with its private callback); only the payment differs: a native transfer for NEAR, `ft_transfer { receiver_id, amount, memo: null }` on the token with the caller's 1 yoctoNEAR and `GAS_FT_TRANSFER` of static gas for a token. The callbacks are the v1 callbacks; the only change in them is that restoring a token event does not add to the NEAR total.
- **Order in `ft_on_transfer`.** Anyone can call it, so the first check is that the caller is a token listed at `new` (`ERR_WRONG_CURRENCY`), before the message is read. Then `msg` at most `max_msg_bytes` (`ERR_LIMIT`, as for `nft_transfer_call`), then `msg` is exactly `{"event_id":<u32>}` (`ERR_BAD_MESSAGE`; unknown fields are rejected), then the event exists, then the caller is that event's currency (`ERR_WRONG_CURRENCY`), then R4 and `amount == price` (`ERR_WRONG_DEPOSIT`). Every rejection panics, so the token's resolver returns the whole amount to the buyer; on success it returns `"0"`.
- **`total_held` counts NEAR events only**, so the NEAR liquidity check is unchanged for NEAR events and does not run for a token claim: a token claim moves no NEAR held for others (the 1 yoctoNEAR it forwards came with the call), and the contract cannot read a token balance in the same call. A standard token moves a balance in one receipt or not at all, so a failed `ft_transfer` leaves nothing in flight, and the callback restores the right.
- **A token claim needs more gas.** It reserves `GAS_FT_TRANSFER` for the token and `GAS_FOR_CALLBACK` for the callback, so it requires `GAS_TOKEN_CLAIM_MIN` (60 Tgas) instead of `GAS_CLAIM_MIN` (40 Tgas), checked before anything is written (`ERR_INSUFFICIENT_GAS`). Both values are re-measured in C7.
- **A listed token is trusted.** The deployer chooses the list once and nobody can change it. A listed token that calls `ft_on_transfer` without moving the money mints a ticket backed by nothing: that is the trust limit of choosing a token, like choosing a verifier. A token whose `ft_transfer` succeeds but answers with a value that is not empty or `null` makes the callback fail before its body runs (`near-sdk` 5.30.1 deserializes a `Result<(), _>` callback argument and panics on anything else, `near-sdk-macros/src/core_impl/code_generator/attr_sig_info.rs:273-299`): the operation stays pending and the ticket locked, exactly like a callback out of gas (Limits 2 in the threat model). It never pays twice, because only a confirmed failure restores the right.

## Alternatives considered

- Run the NEAR liquidity check for the forwarded 1 yoctoNEAR too: it would block token refunds whenever a NEAR refund is on its way back, for no protection.
- Read the token's balance before paying (`ft_balance_of`, then pay in a second callback): a second asynchronous step, a window between the read and the payment, and more code on the money path, to catch something a standard token cannot do.
- Treat any answer of the token as delivered by reading the raw result instead of `#[callback_result]`: it would turn a hostile token's stuck operation into a settled one, which is right only if the token did move the money; leaving it pending is the conservative choice.

## Consequences

The contract account must be registered with each token before sales (deployment step I5); until then the token rejects purchases and buyers keep their money. A holder who is not registered with the token gets the right back when a refund fails and can claim again after registering (`t28`). The threat model should name the token as a trust assumption (integrator, I6).
