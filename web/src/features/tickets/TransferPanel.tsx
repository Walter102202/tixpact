import { type FormEvent, useId, useRef, useState } from 'react';
import { isNamedAccount, missingAccountMessage, testnetAccountError } from '../../lib/accounts';
import { useServices } from '../../services';
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
  const { reader } = useServices();
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState<string | null>(null);
  // Each review gets a number; an answer for an older one is dropped.
  const reviews = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const reasonId = useId();
  const reason = transferBlockedReason(ticket, event);
  const disabled = reason !== null || busy;

  async function review(formEvent: FormEvent) {
    formEvent.preventDefault();
    const account = input.trim();
    const mine = ++reviews.current;
    setTarget(null);
    const invalid = testnetAccountError(account);
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    if (account === ticket.owner_id) {
      setError('That account already holds this ticket.');
      return;
    }
    setError(null);
    if (!isNamedAccount(account) || reader.accountExists === undefined) {
      setTarget(account);
      return;
    }
    // Checked here, at review: the wallet opens on the next click, which must stay synchronous.
    setChecking(account);
    let outcome: string | null;
    try {
      outcome = (await reader.accountExists(account)) ? null : missingAccountMessage(account);
    } catch {
      outcome = `Could not check that ${account} exists. Try again in a moment.`;
    }
    if (mine !== reviews.current) return;
    setChecking(null);
    if (outcome === null) setTarget(account);
    else setError(outcome);
  }

  return (
    <section className="transfer-panel" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>Transfer this ticket</h2>
      <form onSubmit={(formEvent) => void review(formEvent)} noValidate>
        <label htmlFor={inputId}>Send to account</label>
        <input
          id={inputId}
          className="input"
          value={input}
          onChange={(change) => {
            setInput(change.target.value);
            setTarget(null);
            // A review still being checked is for the old text.
            reviews.current += 1;
            setChecking(null);
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
          disabled={disabled || checking !== null}
          aria-describedby={reason === null && checking === null ? undefined : reasonId}
        >
          Review transfer
        </button>
        {(reason !== null || checking !== null) && (
          <p id={reasonId} className="muted">
            {reason ?? `Checking that ${checking} exists on testnet…`}
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
          <button
            type="button"
            className="btn"
            onClick={() => {
              // Cleared on send: any later transfer starts again from review.
              setTarget(null);
              onSend(target);
            }}
          >
            Transfer ticket {ticket.token_id} to {target}
          </button>
        </section>
      )}
    </section>
  );
}
