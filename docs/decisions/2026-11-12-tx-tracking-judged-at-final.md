# A transaction is judged on its final status, and any failed receipt makes it a failure

Date: 2026-11-12. Author: Track W (Task W0). Status: accepted. Corrected 2026-11-12 after the independent review of W0 (see "Corrections").

## Context

The plan fixes `trackTransaction(rpc, txHash, signerId, onStage)` and its result shape, but not the stages, when it resolves, or what counts as a failure. A refund whose transfer fails still ends with a successful transaction status (the callback returns `false`), so the transaction status alone would show success (plan, Review Focus 1). `near-api-js` 7.5.3 `viewTransactionStatusWithReceipts` takes a `waitUntil` level and defaults to `EXECUTED_OPTIMISTIC` (`lib/index.d.ts`, `JsonRpcProvider.viewTransactionStatusWithReceipts`).

## Decision

- Stages, reported once each and in order: `sending` (submitted), `executed` (the node answered at `EXECUTED_OPTIMISTIC` or later and the transaction has a result), `final` (`FINAL`, and every outcome the node lists has run).
- It resolves only at `FINAL` and judges the `FINAL` response, never the optimistic one. An outcome whose status is a plain string (`Unknown`, `Pending`) or a transaction status of `NotStarted` or `Started` means "not run yet": it keeps polling and in the end rejects. It never turns into a success.
- `ok` is true only when the transaction outcome and every receipt outcome have `SuccessValue` or `SuccessReceiptId`, and the transaction status is a `SuccessValue` (`summarizeTransaction`). `failedReceipt` is the first failed outcome in the node's order. `value` is the decoded `SuccessValue` whenever there is one, also when `ok` is false.
- `claim_refund` and `claim_payout` resolve to the contract's own answer to "did money move". `moneyMoved(result)` is `result.ok && result.value === true`; the web checks it, not `ok`, before it shows "Refunded" or "Collected".
- `failedReceipt` carries `executorId` as well as the plan's `receiptId` and `error`, so the web can name the failed step (the contract for a call or callback, the payee for a transfer) without a second request.
- Errors and early answers are retried: 20 requests per stage, 1 s apart by default (`TrackOptions`), then it rejects with the transaction hash in the message.
- Resolving at `FINAL` does not guarantee that the next view read sees the change: the RPC is load-balanced and the failover can switch endpoints. After a transaction the web re-reads the affected view with `readUntilChanged` until it differs from the snapshot taken before sending (at most 5 reads, 1 s apart). Until then the page keeps "Sending" and shows no second button.
- It takes a structural `TxStatusRpc` (one method). `createRpc()` returns a `FailoverRpcProvider` that satisfies it and `ReaderRpc`; a test pins that at compile time.

## Alternatives considered

- Resolve at `EXECUTED_OPTIMISTIC`: faster by about one block, and the next read is even more likely to be stale.
- Trust the transaction status: shows success for a refund whose transfer failed.
- Poll with `waitUntil: 'NONE'`: the shape of early answers is not documented in the installed types; waiting on the node is simpler.

## Consequences

The web shows "Sending" a little longer (until finality, about two blocks, plus the re-read). If a gas-refund receipt were ever listed as `Unknown` at `FINAL`, the tracker would reject instead of reporting success; that is the safe direction, and the testnet captures after Task I1 will show whether it happens. The recorded statuses in `fixtures.ts` are hand-built from the RPC types; replace them with testnet captures after the first deployment (Task I1).

## Corrections

- The first version said that a read at `final` made after `trackTransaction` resolves sees the transaction's effects. That is not guaranteed (load-balanced RPC, failover between nodes); the re-read rule above replaces it.
- The first version counted an outcome with a plain-string status as a success. A transaction is now `ok` only when every outcome succeeded, and `moneyMoved` was added for the claim calls. Reproduction from the review: `TX_FIXTURES.refundTransferFailed` without its failed receipt gave `{ ok: true, value: false }`, which `moneyMoved` reports as no money moved (pinned in `tx.test.ts`).
