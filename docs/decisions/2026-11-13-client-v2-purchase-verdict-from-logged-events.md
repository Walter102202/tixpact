# A purchase is judged by the `ticket_purchased` event of a receipt that succeeded

Date: 2026-11-13. Author: lane K2 (task K1). Status: accepted; revised the same day after the integrator's review (see "Revision").

## Context

A purchase in a token is the buyer's `ft_transfer_call` on the token. When the contract rejects it, `ft_on_transfer` panics and the token's `ft_resolve_transfer` returns the amount to the buyer; the transaction itself still ends in `SuccessValue("0")`. The plan asks `purchaseResult(outcome)` to decide from the receipts, covering the v1 `buy_ticket` outcome as well. Open: what `outcome` is, how to find the event, and which logs to trust.

## Decision

- `purchaseResult(outcome: TxResult, contractId: string)`. It takes what `trackTransaction` returns, so the web plugs it in where it uses `moneyMoved` (`succeeded={(r) => purchaseResult(r, contractId).bought}`). The contract id is required (see "Revision").
- `summarizeTransaction` (and so `trackTransaction`) now sets `TxResult.events`: the NEP-297 `EVENT_JSON:` logs of every outcome that succeeded, with the executor and receipt id. A malformed log is skipped. A failed receipt's logs are never events: NEAR keeps the logs written before a panic, and a purchase logged and then reverted bought nothing.
- Bought only when an event run by `contractId`, of standard `ticket_escrow`, named `ticket_purchased`, carries a valid `token_id` (data as a record or a list of one); the first such event counts. A look-alike log written by any other account (a token's own receipt, a hostile listed token) is never a purchase, and neither is a result without events.
- Otherwise not bought, with the code of the first failed receipt only when the escrow ran that receipt and the code is a known `ERR_` code, else `null`: a token whose own panic text starts with `ERR_` is not the escrow's answer, and a token that refuses an unregistered or unfunded buyer before the contract runs gives `null`.
- A purchase whose escrow receipt logged `ticket_purchased` is bought even when a later receipt failed (the token's resolver): the ticket exists.

## Alternatives considered

- Take the raw `EXPERIMENTAL_tx_status`: every caller would need the status that `trackTransaction` does not return.
- Judge by the returned value (`"0"` refunded, the price kept): the value belongs to the token's resolver, says nothing about the ticket id, and is the ticket id for `buy_ticket`; the event answers both cases with one rule.
- Keep `contractId` optional (the first version): the plan's signature has one argument. Rejected in review: without it, a forged log reads as a purchase, and a screen that leaves the id out tells a buyer they hold a ticket they do not.

## Consequences

- Every `TxResult` from `summarizeTransaction` now has `events` (often `[]`); the tests that compared whole results list them.
- Every caller passes the contract id; the typecheck enforces it. The failed `ft_on_transfer` receipt runs on the escrow, not on the account the transaction called (the token), so `FailedReceipt.step` reads `other` for it; a purchase screen should word its failure from `purchaseResult`, not from `step`.
- Not verified against a deployed v2 contract: the shape of the real `ticket_purchased` data and the exact receipt order of the token used on testnet. The fixtures follow near-contract-standards' `ft_transfer_call` and the plan's event list.

## Revision (2026-11-13, integrator's review of lane K2)

- `contractId` is required: `purchaseResult(outcome, contractId)`. The integrator approved the change to the frozen signature. Before, a rejected purchase with a forged `ticket_purchased` in the token's receipt read `{ bought: true, tokenId: '12-9' }` when the id was left out (the old test pinned it).
- The branch that read a result without events as bought from its returned ticket id is removed; no caller needs it, since `trackTransaction` always sets `events`.
- The code comes only from a failed receipt the escrow ran.
- Tests pin each: a forged log from another executor is never a purchase, the code of a failed token receipt is `null`, a mint without `ticket_purchased` is not a purchase, two `ticket_purchased` events give the first, and a failure after the escrow logged the purchase is still bought.
