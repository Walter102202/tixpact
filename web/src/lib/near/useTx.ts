import {
  type ContractCall,
  parseContractError,
  readUntilChanged,
  type TxResult,
  type TxStage,
  trackTransaction,
} from '@ticket-escrow/client';
import { useCallback, useState } from 'react';
import { useServices } from '../../services';

// One transaction from a click to an honest result: the wallet only sends; the chain, read by hash
// with every receipt, says how it ended; then the page re-reads until the change is visible.

export type TxView =
  | { kind: 'idle' }
  | { kind: 'wallet' }
  | { kind: 'sending'; txHash: string; stage: TxStage }
  | { kind: 'done'; txHash: string; result: TxResult; caughtUp: boolean }
  | { kind: 'unconfirmed'; txHash: string }
  | { kind: 'not-sent'; message: string };

/** Re-read after the transaction: `read` until it differs from `before`, then `apply` it. */
export interface Refresh<T> {
  before: T;
  read: () => Promise<T>;
  apply: (value: T) => void;
}

export interface TxControl {
  view: TxView;
  /** True from the click until the result is known: no second button may be offered. */
  busy: boolean;
  run: <T>(call: ContractCall, refresh?: Refresh<T>) => Promise<void>;
  dismiss: () => void;
}

export function notSentMessage(error: unknown): string {
  const parsed = parseContractError(error);
  if (parsed.code !== 'UNKNOWN')
    return `The wallet reported a failed transaction: ${parsed.message}`;
  return 'The wallet returned no transaction.';
}

export function useTx(): TxControl {
  const { wallet, txRpc, trackOptions, rereadOptions, fixtureMode } = useServices();
  const [view, setView] = useState<TxView>({ kind: 'idle' });

  const run = useCallback(
    async <T>(call: ContractCall, refresh?: Refresh<T>) => {
      setView({ kind: 'wallet' });
      let sent: { txHash: string; signerId: string };
      try {
        sent = await wallet.send(call);
      } catch (error) {
        setView({ kind: 'not-sent', message: notSentMessage(error) });
        return;
      }
      const { txHash, signerId } = sent;
      setView({ kind: 'sending', txHash, stage: 'sending' });
      let result: TxResult;
      try {
        result = await trackTransaction(
          txRpc,
          txHash,
          signerId,
          (stage) => setView({ kind: 'sending', txHash, stage }),
          trackOptions,
        );
      } catch {
        setView({ kind: 'unconfirmed', txHash });
        return;
      }
      let caughtUp = true;
      if (refresh) {
        try {
          // Demo data never changes, so waiting for it to change would only end in a false
          // "not caught up" note.
          if (result.ok && !fixtureMode) {
            const { changed, value } = await readUntilChanged(
              refresh.read,
              refresh.before,
              rereadOptions,
            );
            refresh.apply(value);
            caughtUp = changed;
          } else {
            refresh.apply(await refresh.read());
          }
        } catch {
          caughtUp = false;
        }
      }
      setView({ kind: 'done', txHash, result, caughtUp });
    },
    [wallet, txRpc, trackOptions, rereadOptions, fixtureMode],
  );

  const dismiss = useCallback(() => setView({ kind: 'idle' }), []);
  return { view, busy: view.kind === 'wallet' || view.kind === 'sending', run, dismiss };
}
