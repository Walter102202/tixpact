import { explorerTxUrl, type FailedReceipt, type TxResult } from '@ticket-escrow/client';
import type { ReactNode } from 'react';
import type { TxControl } from '../lib/near/useTx';
import { useServices } from '../services';

const STAGE_TEXT = {
  sending: 'The network is running the transaction.',
  executed: 'Every step ran. Waiting for the blocks to be final.',
  final: 'Final. Reading the contract again.',
} as const;

export function failedStepText(failed: FailedReceipt): string {
  switch (failed.step) {
    case 'transaction':
      return 'the transaction was rejected before it ran';
    case 'contract':
      return 'the contract call';
    case 'callback':
      return "the contract's confirmation after the transfer";
    case 'other':
      return `the transfer to ${failed.executorId}`;
  }
}

function TxLink({ txHash }: { txHash: string }) {
  const { fixtureMode } = useServices();
  if (fixtureMode) return null;
  return (
    <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
      View the transaction in the explorer
    </a>
  );
}

/**
 * The state of one transaction. `success` renders when the chain says it worked; anything else
 * is written out, never shown as success.
 */
export function TxStatus({
  tx,
  failureTitle = 'The transaction did not complete.',
  failureNote,
  succeeded = (result) => result.ok,
  success,
}: {
  tx: TxControl;
  failureTitle?: string;
  failureNote?: string;
  /** What counts as success; a claim also needs the contract to say money moved (`moneyMoved`). */
  succeeded?: (result: TxResult) => boolean;
  success: (result: TxResult) => ReactNode;
}) {
  const { view, dismiss } = tx;
  switch (view.kind) {
    case 'idle':
      return null;
    case 'wallet':
      return (
        <p className="tx tx-pending" role="status">
          Confirm in your wallet.
        </p>
      );
    case 'sending':
      return (
        <div className="tx tx-pending" role="status">
          <strong>Sending</strong>
          <p>{STAGE_TEXT[view.stage]}</p>
          <TxLink txHash={view.txHash} />
        </div>
      );
    case 'not-sent':
      return (
        <div className="tx tx-notice" role="alert">
          <p>{view.message}</p>
          {/* A wallet can throw after it broadcast the transaction; a blind retry could pay twice. */}
          <p className="muted">If you did approve it, reload this page before trying again.</p>
          <button type="button" className="btn btn-sm btn-secondary" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      );
    case 'unconfirmed':
      return (
        <div className="tx tx-notice" role="alert">
          <p>The transaction was sent, but its result could not be read yet.</p>
          <p className="muted">Check it in the explorer before trying again.</p>
          <TxLink txHash={view.txHash} />
          <button type="button" className="btn btn-sm btn-secondary" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      );
    case 'done': {
      const { result } = view;
      if (!succeeded(result)) {
        return (
          <div className="tx tx-failed" role="alert">
            <strong>{failureTitle}</strong>
            {result.failedReceipt && (
              <>
                <p>Failed step: {failedStepText(result.failedReceipt)}.</p>
                <p>{result.failedReceipt.error.message}</p>
              </>
            )}
            {failureNote && <p className="muted">{failureNote}</p>}
            <TxLink txHash={view.txHash} />
            <button type="button" className="btn btn-sm btn-secondary" onClick={dismiss}>
              Dismiss
            </button>
          </div>
        );
      }
      return (
        <div className="tx tx-done" role="status">
          {success(result)}
          {!view.caughtUp && (
            <p className="muted">
              The page has not caught up with the chain yet; reload in a few seconds.
            </p>
          )}
          <TxLink txHash={view.txHash} />
        </div>
      );
    }
  }
}
