import type { FailedReceipt, TxResult, Unit } from '@ticket-escrow/client';

/**
 * The receipt that failed on the token itself, for a refund or a payout in `token`: the escrow's
 * `ft_transfer` to the payee. Null for an event priced in NEAR, or a failure anywhere else.
 */
export function refusedByToken(result: TxResult, token: string | null): FailedReceipt | null {
  const failed = result.failedReceipt;
  return token !== null && failed?.executorId === token ? failed : null;
}

/** How a standard token (near-contract-standards) refuses an account it does not know. */
const NOT_REGISTERED = /is not registered/;

/**
 * What a refund or payout says when the token refused to pay: nothing was paid, why, in plain
 * words, and what comes next. `restored` is the sentence that the right is back (the contract's
 * callback gave it back, R7); null when the page read again does not show it back.
 */
export function SettlementRefused({
  failed,
  payee,
  unit,
  restored,
  retry,
}: {
  failed: FailedReceipt;
  payee: string;
  unit: Unit;
  restored: string | null;
  /** The action to take again: "claim" or "collect". */
  retry: string;
}) {
  const unregistered = NOT_REGISTERED.test(failed.error.message);
  const why = unregistered
    ? `${unit.symbol} could not pay ${payee}, which is not registered with it`
    : `the token ${failed.executorId} refused to pay ${payee}`;
  return (
    <>
      <p>
        {restored === null
          ? `Nothing was paid: ${why}.`
          : `Nothing was paid and nothing was lost: ${why}.`}
      </p>
      {!unregistered && <p>{failed.error.message}</p>}
      {restored !== null && (
        <p>
          {restored}
          {unregistered && ` Register ${payee} with ${unit.symbol}, then ${retry} again.`}
        </p>
      )}
    </>
  );
}
