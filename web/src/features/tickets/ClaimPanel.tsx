import { actions, type TicketView } from '@ticket-escrow/client';
import type { Refresh, TxControl } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { near } from '../events/eventCopy';
import type { TicketData } from './TicketPage';

/**
 * The claim button, named with the amount and the destination. Shown only when the contract would
 * pay now (`canClaimRefund`), only to the holder, and never while a transaction is in flight or
 * after the claim was paid.
 */
export function ClaimPanel({
  ticket,
  claimable,
  isHolder,
  signedIn,
  busy,
  tx,
  refresh,
}: {
  ticket: TicketView;
  claimable: boolean;
  isHolder: boolean;
  signedIn: boolean;
  busy: boolean;
  tx: TxControl;
  refresh: Refresh<TicketData>;
}) {
  const { signIn } = useWallet();
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

  return (
    <div className="claim-panel">
      <button
        type="button"
        className="btn"
        onClick={() => void tx.run(actions.claimRefund(ticket.token_id), refresh)}
      >
        Claim {near(ticket.principal)} to {ticket.owner_id}
      </button>
      <p className="muted">
        Your wallet shows a 1 yoctoNEAR deposit: the contract requires it so that only the holder's
        full key can claim.
      </p>
    </div>
  );
}
