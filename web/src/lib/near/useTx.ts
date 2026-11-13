import {
  type ContractCall,
  parseContractError,
  readUntilChanged,
  type TxResult,
  type TxStage,
  trackTransaction,
} from '@ticket-escrow/client';
import { useCallback, useRef, useState } from 'react';
import { useServices } from '../../services';

// One transaction from a click to an honest result: the wallet only sends; the chain, read by hash
// with every receipt, says how it ended; then the page re-reads until the change is visible.

/** How the re-read after a transaction went. */
export type Reread =
  /** No re-read was asked for. */
  | 'none'
  /** The page shows the change the transaction made. */
  | 'caught-up'
  /** The page was read again, but the node does not show the change yet. */
  | 'behind'
  /** The contract could not be read again. */
  | 'failed';

export type TxView =
  | { kind: 'idle' }
  | { kind: 'wallet' }
  | { kind: 'sending'; txHash: string; signerId: string; stage: TxStage }
  | { kind: 'done'; txHash: string; signerId: string; result: TxResult; reread: Reread }
  | {
      kind: 'unconfirmed';
      txHash: string;
      signerId: string;
      /** The last attempt to read the page again failed. */
      rereadFailed: boolean;
    }
  | { kind: 'not-sent'; message: string };

/** Re-read after the transaction: `read` until `key` differs from `before`'s, then `apply` it. */
export interface Refresh<T> {
  before: T;
  read: () => Promise<T>;
  apply: (value: T) => void;
  /**
   * The part of the page the transaction must change. Never the whole view: every live view carries
   * the chain clock (`now_ms`), so a whole-view comparison calls the first, stale read new.
   */
  key: (value: T) => unknown;
}

export interface TxControl {
  view: TxView;
  /**
   * True from the click until the result is known, and while a sent transaction's result is
   * unknown: no action that could pay twice may be offered.
   */
  busy: boolean;
  run: <T>(call: ContractCall, refresh?: Refresh<T>) => Promise<void>;
  dismiss: () => void;
  /** After an unknown result: read the page again; on success the actions come back. */
  recheck: () => Promise<void>;
}

export function notSentMessage(error: unknown): string {
  const parsed = parseContractError(error);
  if (parsed.code !== 'UNKNOWN')
    return `The wallet reported a failed transaction: ${parsed.message}`;
  return 'The wallet returned no transaction.';
}

const sameKey =
  <T>(key: (value: T) => unknown) =>
  (a: unknown, b: unknown) =>
    JSON.stringify(key(a as T)) === JSON.stringify(key(b as T));

export function useTx(): TxControl {
  const { wallet, txRpc, trackOptions, rereadOptions, fixtureMode } = useServices();
  const [view, setView] = useState<TxView>({ kind: 'idle' });
  // The refresh of the transaction in flight, kept for `recheck`.
  const lastRefresh = useRef<Refresh<unknown> | undefined>(undefined);

  const run = useCallback(
    async <T>(call: ContractCall, refresh?: Refresh<T>) => {
      lastRefresh.current = refresh as Refresh<unknown> | undefined;
      setView({ kind: 'wallet' });
      let sent: { txHash: string; signerId: string };
      try {
        sent = await wallet.send(call);
      } catch (error) {
        setView({ kind: 'not-sent', message: notSentMessage(error) });
        return;
      }
      const { txHash, signerId } = sent;
      setView({ kind: 'sending', txHash, signerId, stage: 'sending' });
      let result: TxResult;
      try {
        result = await trackTransaction(
          txRpc,
          txHash,
          signerId,
          (stage) => setView({ kind: 'sending', txHash, signerId, stage }),
          trackOptions,
        );
      } catch {
        // Sent, result unknown: read the page once, and keep every action hidden until the person
        // reads it again (`recheck`), so a second click cannot pay twice.
        let rereadFailed = false;
        if (refresh) {
          try {
            refresh.apply(await refresh.read());
          } catch {
            rereadFailed = true;
          }
        }
        setView({ kind: 'unconfirmed', txHash, signerId, rereadFailed });
        return;
      }

      let reread: Reread = 'none';
      if (refresh) {
        try {
          // Demo data never changes, so waiting for it to change would only end in "behind".
          if (result.ok && !fixtureMode) {
            const { changed, value } = await readUntilChanged(refresh.read, refresh.before, {
              ...rereadOptions,
              isEqual: sameKey(refresh.key),
            });
            refresh.apply(value);
            reread = changed ? 'caught-up' : 'behind';
          } else {
            refresh.apply(await refresh.read());
            reread = 'caught-up';
          }
        } catch {
          reread = 'failed';
        }
      }
      setView({ kind: 'done', txHash, signerId, result, reread });
    },
    [wallet, txRpc, trackOptions, rereadOptions, fixtureMode],
  );

  const recheck = useCallback(async () => {
    const refresh = lastRefresh.current;
    if (!refresh) {
      setView({ kind: 'idle' });
      return;
    }
    try {
      refresh.apply(await refresh.read());
      setView({ kind: 'idle' });
    } catch {
      setView((current) =>
        current.kind === 'unconfirmed' ? { ...current, rereadFailed: true } : current,
      );
    }
  }, []);

  const dismiss = useCallback(() => setView({ kind: 'idle' }), []);
  const busy = view.kind === 'wallet' || view.kind === 'sending' || view.kind === 'unconfirmed';
  return { view, busy, run, dismiss, recheck };
}
