import { AccountIdSchema } from '@ticket-escrow/client';
import { type FormEvent, useId, useState } from 'react';
import { near } from '../events/eventCopy';
import type { TicketData } from './TicketPage';
import { transferBlockedReason } from './ticketCopy';

/**
 * Two steps: type an account, then confirm on a screen that writes it out in full and says the
 * refund right goes with the ticket. Nothing is sent before the second click.
 */
export function TransferPanel({
  data,
  busy,
  onSend,
}: {
  data: TicketData;
  busy: boolean;
  onSend: (account: string) => void;
}) {
  const { ticket, event } = data;
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const reasonId = useId();
  const reason = transferBlockedReason(ticket, event);
  const disabled = reason !== null || busy;

  function review(formEvent: FormEvent) {
    formEvent.preventDefault();
    const account = input.trim();
    setTarget(null);
    if (!AccountIdSchema.safeParse(account).success) {
      setError('That is not a valid NEAR account id.');
    } else if (account === ticket.owner_id) {
      setError('That account already holds this ticket.');
    } else {
      setError(null);
      setTarget(account);
    }
  }

  return (
    <section className="transfer-panel" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>Transfer this ticket</h2>
      <form onSubmit={review} noValidate>
        <label htmlFor={inputId}>Send to account</label>
        <input
          id={inputId}
          className="input"
          value={input}
          onChange={(change) => {
            setInput(change.target.value);
            setTarget(null);
          }}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="ana.testnet"
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
        />
        {error !== null && (
          <p id={errorId} className="field-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-secondary"
          disabled={disabled}
          aria-describedby={reason === null ? undefined : reasonId}
        >
          Review transfer
        </button>
        {reason !== null && (
          <p id={reasonId} className="muted">
            {reason}
          </p>
        )}
      </form>

      {target !== null && !disabled && (
        <section className="confirm" aria-label="Confirm the transfer">
          <p>You are sending ticket {ticket.token_id} to</p>
          <p className="account-full">{target}</p>
          <p>
            <strong>You will lose the right to the refund.</strong> From then on only {target} can
            claim {near(ticket.principal)}, and the transfer cannot be undone.
          </p>
          <button type="button" className="btn" onClick={() => onSend(target)}>
            Transfer ticket {ticket.token_id} to {target}
          </button>
        </section>
      )}
    </section>
  );
}
