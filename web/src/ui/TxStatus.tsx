import { explorerTxUrl, type FailedReceipt, type TxResult } from '@ticket-escrow/client';
import { type ReactNode, useEffect, useRef } from 'react';
import type { Reread, TxControl } from '../lib/near/useTx';
import { useServices } from '../services';

const STAGE_TEXT = {
  sending: 'The network is running the transaction.',
  executed: 'Every step ran. Waiting for the blocks to be final.',
  final: 'Final. Reading the contract again.',
} as const;

const NOT_READ_AGAIN = 'The contract could not be read again; reload this page.';

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

/** What the page says about its own data after a failed transaction. */
function rereadNote(reread: Reread, note: string | undefined): string | undefined {
  return reread === 'failed' ? NOT_READ_AGAIN : note;
}

/**
 * The state of one transaction, in one live region that exists before the click and stays for
 * every state. Failures and notices inside it are alerts. When the clicked button disappears,
 * focus moves here so keyboard and screen-reader users are not dropped at the top of the page.
 *
 * `success` renders only when `succeeded` says so; anything else is written out, never shown as
 * success.
 */
export function TxStatus({
  tx,
  failureTitle = 'The transaction did not complete.',
  failureNote,
  failureDetail,
  failureBody,
  succeeded = (result) => result.ok,
  success,
}: {
  tx: TxControl;
  failureTitle?: string;
  /** Shown after a failure when the page was read again. */
  failureNote?: string;
  /** Extra sentences for a particular failure. */
  failureDetail?: (result: TxResult, signerId: string) => ReactNode;
  /**
   * Replaces the failed step and its message, for a transaction whose receipts the generic words
   * would misname (a purchase in a token runs on the token first, then on this contract). When it
   * returns `undefined`, the generic words stay.
   */
  failureBody?: (result: TxResult, signerId: string) => ReactNode;
  /** What counts as success; a claim also needs the contract to say money moved (`moneyMoved`). */
  succeeded?: (result: TxResult) => boolean;
  success: (result: TxResult, signerId: string) => ReactNode;
}) {
  const { view, dismiss, recheck } = tx;
  const region = useRef<HTMLDivElement>(null);
  const active = view.kind !== 'idle';

  useEffect(() => {
    const focused = document.activeElement;
    if (active && (focused === null || focused === document.body)) region.current?.focus();
  }, [active]);

  return (
    <div ref={region} className="tx-region" role="status" tabIndex={-1}>
      <TxContent
        view={view}
        dismiss={dismiss}
        recheck={recheck}
        failureTitle={failureTitle}
        failureNote={failureNote}
        failureDetail={failureDetail}
        failureBody={failureBody}
        succeeded={succeeded}
        success={success}
      />
    </div>
  );
}

function TxContent({
  view,
  dismiss,
  recheck,
  failureTitle,
  failureNote,
  failureDetail,
  failureBody,
  succeeded,
  success,
}: {
  view: TxControl['view'];
  dismiss: () => void;
  recheck: () => Promise<void>;
  failureTitle: string;
  failureNote: string | undefined;
  failureDetail: ((result: TxResult, signerId: string) => ReactNode) | undefined;
  failureBody: ((result: TxResult, signerId: string) => ReactNode) | undefined;
  succeeded: (result: TxResult) => boolean;
  success: (result: TxResult, signerId: string) => ReactNode;
}) {
  switch (view.kind) {
    case 'idle':
      return null;
    case 'wallet':
      return <p className="tx tx-pending">Confirm in your wallet.</p>;
    case 'sending':
      return (
        <div className="tx tx-pending">
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
          <p className="muted">
            Check it in the explorer before trying again. Nothing else is offered here until the
            chain gives the result or this page is read again.
          </p>
          {view.rereadFailed && <p className="muted">{NOT_READ_AGAIN}</p>}
          <TxLink txHash={view.txHash} />
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void recheck()}>
            Check again
          </button>
        </div>
      );
    case 'done': {
      const { result, signerId, reread } = view;
      if (!succeeded(result)) {
        const note = rereadNote(reread, failureNote);
        const body = failureBody?.(result, signerId);
        return (
          <div className="tx tx-failed" role="alert">
            <strong>{failureTitle}</strong>
            {body !== undefined
              ? body
              : result.failedReceipt && (
                  <>
                    <p>Failed step: {failedStepText(result.failedReceipt)}.</p>
                    <p>{result.failedReceipt.error.message}</p>
                  </>
                )}
            {failureDetail?.(result, signerId)}
            {note && <p className="muted">{note}</p>}
            <TxLink txHash={view.txHash} />
            <button type="button" className="btn btn-sm btn-secondary" onClick={dismiss}>
              Dismiss
            </button>
          </div>
        );
      }
      return (
        <div className="tx tx-done">
          {success(result, signerId)}
          {reread === 'behind' && (
            <p className="muted">
              The page has not caught up with the chain yet; reload in a few seconds.
            </p>
          )}
          {reread === 'failed' && <p className="muted">{NOT_READ_AGAIN}</p>}
          <TxLink txHash={view.txHash} />
        </div>
      );
    }
  }
}
