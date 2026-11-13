import type { EntryPass, TicketView } from '@ticket-escrow/client';
import { useId, useState } from 'react';
import { useWallet } from '../../lib/near/useWallet';
import { useServices } from '../../services';
import { ONLY_HOLDER, passBlockedReason, signEntryPass } from './passFlow';

/**
 * The "Show entry pass" button for the signed-in holder of a ticket that can admit, or the
 * sentence that says why not. `onSigned` gets the pass the wallet signed.
 */
export function EntryPassOffer({
  ticket,
  label = 'Show entry pass',
  onSigned,
}: {
  ticket: TicketView;
  label?: string;
  onSigned: (pass: EntryPass) => void;
}) {
  const { wallet, contractId } = useServices();
  const { accountId } = useWallet();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();

  if (accountId === null || accountId !== ticket.owner_id) {
    return <p className="muted">{ONLY_HOLDER}</p>;
  }
  const blocked = passBlockedReason(ticket);
  if (blocked !== null) return <p className="muted">{blocked}</p>;

  async function sign() {
    setProblem(null);
    setBusy(true);
    // The wallet opens inside this click, before the first await (popup blockers).
    const outcome = await signEntryPass(wallet, contractId, ticket.token_id, Date.now());
    setBusy(false);
    if (outcome.ok) onSigned(outcome.pass);
    else setProblem(outcome.message);
  }

  return (
    <div className="pass-offer">
      <button
        type="button"
        className="btn"
        disabled={busy}
        aria-describedby={problem === null ? undefined : problemId}
        onClick={() => void sign()}
      >
        {busy ? 'Waiting for the wallet…' : label}
      </button>
      {problem !== null && (
        <p id={problemId} className="tx tx-notice" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
