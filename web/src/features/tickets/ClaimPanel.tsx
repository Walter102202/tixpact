import { actions, type TicketView, type Unit } from '@ticket-escrow/client';
import { useEffect } from 'react';
import { moneyExact } from '../../lib/money';
import { type Refresh, type TxControl, useTx } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { RegisterPanel } from '../tokens/RegisterPanel';
import { refusedByToken } from '../tokens/SettlementRefused';
import { useTokenAccount } from '../tokens/useTokenAccount';
import type { TicketData } from './TicketPage';

/**
 * The claim button, named with the amount and the destination. Shown only when the contract would
 * pay now (`canClaimRefund`), only to the holder, and never while a transaction is in flight or
 * after the claim was paid. For a ticket priced in a token, the holder's registration with the
 * token is checked first: the token cannot pay an account it does not know, and the claim would
 * come back to the ticket.
 */
export function ClaimPanel({
  ticket,
  unit,
  claimable,
  isHolder,
  signedIn,
  busy,
  tx,
  refresh,
}: {
  ticket: TicketView;
  unit: Unit;
  claimable: boolean;
  isHolder: boolean;
  signedIn: boolean;
  busy: boolean;
  tx: TxControl;
  refresh: Refresh<TicketData>;
}) {
  const { signIn } = useWallet();
  const registerTx = useTx();
  // Read only when it decides something: a claimable ticket shown to its holder.
  const asked = claimable && isHolder ? ticket.owner_id : null;
  const { load: holder, refresh: holderRefresh } = useTokenAccount(ticket.currency, asked);
  // A claim the token refused says the holder may not be registered: read it again, so the
  // registration is offered when that is why.
  const refused =
    tx.view.kind === 'done' && refusedByToken(tx.view.result, ticket.currency) !== null;
  const { reload } = holder;
  useEffect(() => {
    if (refused) reload();
  }, [refused, reload]);
  if (!claimable || busy) return null;

  if (!signedIn) {
    return (
      <div className="claim-panel">
        <button type="button" className="btn" onClick={signIn}>
          Sign in to claim
        </button>
        <p className="muted">Only the holder, {ticket.owner_id}, can claim it.</p>
      </div>
    );
  }
  if (!isHolder) return null;

  const claim = (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => void tx.run(actions.claimRefund(ticket.token_id), refresh)}
      >
        Claim {moneyExact(ticket.principal, unit)} to {ticket.owner_id}
      </button>
      <p className="muted">
        Your wallet shows a 1 yoctoNEAR deposit: the contract requires it so that only the holder's
        full key can claim.
      </p>
    </>
  );

  if (ticket.currency === null) return <div className="claim-panel">{claim}</div>;

  const { state } = holder;
  if (state.status === 'loading' || (state.status === 'ready' && state.data === null)) {
    return (
      <div className="claim-panel">
        <p className="muted" role="status">
          Checking that {ticket.owner_id} is registered with {unit.symbol}…
        </p>
      </div>
    );
  }
  if (state.status === 'error') {
    // An outage does not hold back a refund: a claim to an unregistered account fails and comes
    // back to the ticket, which costs a fee and nothing else.
    return (
      <div className="claim-panel">
        {claim}
        <p className="muted">
          Could not check that {ticket.owner_id} is registered with {unit.symbol}. If it is not, the
          claim fails and comes back to the ticket.
        </p>
        <button type="button" className="btn btn-sm btn-secondary" onClick={holder.reload}>
          Check again
        </button>
      </div>
    );
  }
  const account = state.data;
  if (account === null) return null;
  if (!account.registered) {
    return (
      <div className="claim-panel">
        <RegisterPanel
          account={account}
          unit={unit}
          signer={ticket.owner_id}
          why={
            <p>
              {ticket.owner_id} is not registered with {unit.symbol}, so the token cannot pay a
              refund to it yet: the claim would fail and come back to the ticket. Register first,
              then claim.
            </p>
          }
          tx={registerTx}
          refresh={holderRefresh(account)}
        />
      </div>
    );
  }
  return <div className="claim-panel">{claim}</div>;
}
