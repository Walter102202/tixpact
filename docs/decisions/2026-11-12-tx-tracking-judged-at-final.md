# A transaction is judged on its final status, and any failed receipt makes it a failure

Date: 2026-11-12. Author: Track W (Task W0). Status: accepted.

## Context

The plan fixes `trackTransaction(rpc, txHash, signerId, onStage)` and its result shape, but not the stages, when it resolves, or what counts as a failure. A refund whose transfer fails still ends with a successful transaction status (the callback returns `false`), so the transaction status alone would show success (plan, Review Focus 1). `near-api-js` 7.5.3 `viewTransactionStatusWithReceipts` takes a `waitUntil` level and defaults to `EXECUTED_OPTIMISTIC` (`lib/index.d.ts`, `JsonRpcProvider.viewTransactionStatusWithReceipts`).

## Decision

- Stages, reported once each and in order: `sending` (submitted), `executed` (the node answered at `EXECUTED_OPTIMISTIC` or later: every non-refund receipt ran), `final` (`FINAL`).
- It resolves only at `FINAL`, and judges the `FINAL` response, never the optimistic one. A contract read made afterwards at `final` finality therefore sees the transaction's effects.
- `ok` is true only when no outcome (transaction or receipt) has a `Failure` and the transaction status is a `SuccessValue`. `failedReceipt` is the first failed outcome in the node's order. `value` is the decoded `SuccessValue` whenever there is one, also when `ok` is false.
- `failedReceipt` carries `executorId` as well as the plan's `receiptId` and `error`, so the web can name the failed step (the contract for a call or callback, the payee for a transfer) without a second request.
- Errors and early answers are retried: 20 requests per stage, 1 s apart by default (`TrackOptions`), then it rejects with the transaction hash in the message.
- It takes a structural `TxStatusRpc` (one method). `createRpc()` returns a `FailoverRpcProvider` that satisfies it and `ReaderRpc`; a test pins that at compile time.

## Alternatives considered

- Resolve at `EXECUTED_OPTIMISTIC`: faster by about one block, but the follow-up `final` read can miss the change and show stale state.
- Trust the transaction status: shows success for a refund whose transfer failed.
- Poll with `waitUntil: 'NONE'`: the shape of early answers is not documented in the installed types; waiting on the node is simpler.

## Consequences

The web shows "Sending" a little longer (until finality, about two blocks). The recorded statuses in `fixtures.ts` are hand-built from the RPC types; replace them with testnet captures after the first deployment (Task I1).
