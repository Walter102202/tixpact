import { actions, type Unit } from '@ticket-escrow/client';
import type { ReactNode } from 'react';
import type { Refresh, TxControl } from '../../lib/near/useTx';
import { useServices } from '../../services';
import { TxStatus } from '../../ui/TxStatus';
import { nearExact } from '../events/eventCopy';
import type { TokenAccount } from './useTokenAccount';

/**
 * The one-step registration with a token (NEP-145 `storage_deposit`): whoever signs pays the
 * token's storage deposit for `account.accountId`, themselves or someone else. `why` says what
 * fails without it; the button names the account, the token and the exact deposit.
 */
export function RegisterPanel<T>({
  account,
  unit,
  signer,
  why,
  tx,
  refresh,
}: {
  account: TokenAccount;
  unit: Unit;
  /** Who signs and pays. */
  signer: string;
  why: ReactNode;
  tx: TxControl;
  /** What the page reads again once the registration ran. */
  refresh: Refresh<T>;
}) {
  const self = signer === account.accountId;
  const deposit = nearExact(account.minDeposit);
  const done = tx.view.kind === 'done' && tx.view.result.ok;
  return (
    <div className="register-panel">
      {why}
      {!tx.busy && !done && (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              void tx.run(
                actions.registerWithToken(account.token, account.accountId, account.minDeposit),
                refresh,
              )
            }
          >
            {self
              ? `Register with ${unit.symbol} for ${deposit}`
              : `Register ${account.accountId} with ${unit.symbol} for ${deposit}`}
          </button>
          <p className="muted">
            One step: the deposit goes to the token {account.token} to keep{' '}
            {self ? 'your' : `${account.accountId}'s`} {unit.symbol} balance, not to this contract.
          </p>
        </>
      )}
      <TxStatus
        tx={tx}
        failureTitle="The registration did not complete."
        failureNote="The deposit comes back to your account when the call fails."
        success={() => <Registered account={account.accountId} unit={unit} />}
      />
    </div>
  );
}

function Registered({ account, unit }: { account: string; unit: Unit }) {
  const { fixtureMode } = useServices();
  // The recorded transaction lends its hash, but the demo data does not change.
  if (fixtureMode) {
    return (
      <p>
        Demo: nothing was registered. Live, {account} is then registered with {unit.symbol}.
      </p>
    );
  }
  return (
    <p>
      {account} is registered with {unit.symbol}.
    </p>
  );
}
