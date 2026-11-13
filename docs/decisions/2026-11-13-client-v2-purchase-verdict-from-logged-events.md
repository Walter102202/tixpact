# A purchase is judged by the `ticket_purchased` event of a receipt that succeeded

Date: 2026-11-13. Author: lane K2 (task K1). Status: accepted.

## Context

A purchase in a token is the buyer's `ft_transfer_call` on the token. When the contract rejects it, `ft_on_transfer` panics and the token's `ft_resolve_transfer` returns the amount to the buyer; the transaction itself still ends in `SuccessValue("0")`. The plan asks `purchaseResult(outcome)` to decide from the receipts, covering the v1 `buy_ticket` outcome as well. Open: what `outcome` is, how to find the event, and which logs to trust.

## Decision

- `purchaseResult(outcome: TxResult, contractId?: string)`. It takes what `trackTransaction` returns, so the web plugs it in where it uses `moneyMoved` (`succeeded={(r) => purchaseResult(r, contractId).bought}`).
- `summarizeTransaction` (and so `trackTransaction`) now sets `TxResult.events`: the NEP-297 `EVENT_JSON:` logs of every outcome that succeeded, with the executor and receipt id. A malformed log is skipped. A failed receipt's logs are never events: NEAR keeps the logs written before a panic, and a purchase logged and then reverted bought nothing.
- Bought when an event of standard `ticket_escrow` named `ticket_purchased` carries a valid `token_id` (data as a record or a list of one). With `contractId`, only an event whose executor is that contract counts, so a token that writes a look-alike log in its own receipt cannot fake a purchase.
- Otherwise not bought, with the code of the first failed receipt when it is a known `ERR_` code, else `null` (a token that refuses an unregistered or unfunded buyer before the contract runs).
- A hand-built `TxResult` without `events` (as tests and fakes write them) is bought when it succeeded and returned a ticket id, which is what v1 `buy_ticket` returns.

## Alternatives considered

- Take the raw `EXPERIMENTAL_tx_status`: every caller would need the status that `trackTransaction` does not return.
- Judge by the returned value (`"0"` refunded, the price kept): the value belongs to the token's resolver, says nothing about the ticket id, and is the ticket id for `buy_ticket`; the event answers both cases with one rule.
- Make `contractId` required: the plan's signature has one argument; the check is an extra guard for a token the deployment already chose, so it stays optional and documented.

## Consequences

- Every `TxResult` from `summarizeTransaction` now has `events` (often `[]`); the tests that compared whole results list them.
- Lane W2 should pass the contract id. The failed `ft_on_transfer` receipt runs on the escrow, not on the account the transaction called (the token), so `FailedReceipt.step` reads `other` for it; a purchase screen should word its failure from `purchaseResult`, not from `step`.
- Not verified against a deployed v2 contract: the shape of the real `ticket_purchased` data and the exact receipt order of the token used on testnet. The fixtures follow near-contract-standards' `ft_transfer_call` and the plan's event list.
