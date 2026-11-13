import { actions } from '@ticket-escrow/client';
import { type ReactNode, useId } from 'react';
import { useTx } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { Link } from '../../lib/router';
import { TxStatus } from '../../ui/TxStatus';
import type { EventData } from './EventPage';
import { buyBlockedReason, near } from './eventCopy';

export function BuyPanel({
  data,
  reread,
  apply,
}: {
  data: EventData;
  reread: () => Promise<EventData>;
  apply: (data: EventData) => void;
}) {
  const { event } = data;
  const { accountId, signIn } = useWallet();
  const tx = useTx();
  const reasonId = useId();
  const reason = buyBlockedReason(event);
  const label = `Buy for ${near(event.price)}`;

  function buy() {
    void tx.run(actions.buyTicket(event.event_id, event.price), {
      before: data,
      read: reread,
      apply,
    });
  }

  let control: ReactNode = null;
  if (tx.busy) {
    control = null;
  } else if (reason !== null) {
    control = (
      <>
        <button type="button" className="btn" disabled aria-describedby={reasonId}>
          {label}
        </button>
        <p id={reasonId} className="muted">
          {reason}
        </p>
      </>
    );
  } else if (accountId === null) {
    control = (
      <>
        <button type="button" className="btn" onClick={signIn}>
          Sign in to buy
        </button>
        <p className="muted">Your wallet opens to sign in; buying is a second, separate step.</p>
      </>
    );
  } else {
    control = (
      <>
        <button type="button" className="btn" onClick={buy}>
          {label}
        </button>
        <p className="muted">
          {near(event.price)} goes to the contract, not to the organizer, and stays reserved for
          whoever holds the ticket.
        </p>
      </>
    );
  }

  return (
    <section className="buy-panel" aria-label="Buy a ticket">
      {control}
      <TxStatus
        tx={tx}
        failureTitle="The payment did not complete."
        failureNote="A rejected purchase returns the deposit to your account."
        success={(result) => (
          <Bought tokenId={typeof result.value === 'string' ? result.value : null} />
        )}
      />
    </section>
  );
}

function Bought({ tokenId }: { tokenId: string | null }) {
  if (tokenId === null) return <p>The purchase went through.</p>;
  return (
    <>
      <p>You hold ticket {tokenId}.</p>
      <Link to={`/tickets/${tokenId}`}>Open ticket {tokenId}</Link>
    </>
  );
}
