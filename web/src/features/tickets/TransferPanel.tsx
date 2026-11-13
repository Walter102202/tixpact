import { type FormEvent, useId, useRef, useState } from 'react';
import { isNamedAccount, missingAccountMessage, testnetAccountError } from '../../lib/accounts';
import { money } from '../../lib/money';
import { useTx } from '../../lib/near/useTx';
import { useServices } from '../../services';
import { RegisterPanel } from '../tokens/RegisterPanel';
import type { TokenAccount } from '../tokens/useTokenAccount';
import type { TicketData } from './TicketPage';
import { transferBlockedReason } from './ticketCopy';

/** For a ticket priced in a token: whether the receiver is registered with it, or unknown. */
type Registration = TokenAccount | 'unknown';

/**
 * Two steps: type an account, then confirm on a screen that writes it out in full and says the
 * refund right goes with the ticket. Nothing is sent before the second click. For a ticket priced
 * in a token, the review also checks the receiver's registration with the token: an unregistered
 * holder can hold the ticket, but a refund to it fails until it registers.
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
  const { ticket, event, unit } = data;
  const { reader } = useServices();
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState<string | null>(null);
  // Each review gets a number; an answer for an older one is dropped.
  const reviews = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const registerTx = useTx();
  const inputId = useId();
  const errorId = useId();
  const reasonId = useId();
  const reason = transferBlockedReason(ticket, event);
  const disabled = reason !== null || busy;
  const token = ticket.currency;

  async function readRegistration(token: string, account: string): Promise<Registration> {
    try {
      return {
        token,
        accountId: account,
        ...(await reader.tokenRegistration(token, account)),
        balance: null,
      };
    } catch {
      return 'unknown';
    }
  }

  async function review(formEvent: FormEvent) {
    formEvent.preventDefault();
    const account = input.trim();
    const mine = ++reviews.current;
    setTarget(null);
    setRegistration(null);
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
    const checkExists = isNamedAccount(account) && reader.accountExists !== undefined;
    if (!checkExists && token === null) {
      setTarget(account);
      return;
    }
    // Checked here, at review: the wallet opens on the next click, which must stay synchronous.
    let problem: string | null = null;
    if (checkExists) {
      setChecking(`Checking that ${account} exists on testnet…`);
      try {
        problem = (await reader.accountExists?.(account)) ? null : missingAccountMessage(account);
      } catch {
        problem = `Could not check that ${account} exists. Try again in a moment.`;
      }
    }
    let found: Registration | null = null;
    if (problem === null && token !== null && mine === reviews.current) {
      setChecking(`Checking whether ${account} is registered with ${unit.symbol}…`);
      found = await readRegistration(token, account);
    }
    if (mine !== reviews.current) return;
    setChecking(null);
    if (problem === null) {
      setTarget(account);
      setRegistration(found);
    } else setError(problem);
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
            setRegistration(null);
            // A review still being checked is for the old text.
            reviews.current += 1;
            setChecking(null);
          }}
          disabled={disabled || registerTx.busy}
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
          disabled={disabled || checking !== null || registerTx.busy}
          aria-describedby={reason === null && checking === null ? undefined : reasonId}
        >
          Review transfer
        </button>
        {(reason !== null || checking !== null) && (
          <p id={reasonId} className="muted">
            {reason ?? checking}
          </p>
        )}
      </form>

      {target !== null && !disabled && (
        <section className="confirm" aria-label="Confirm the transfer">
          <p>You are sending ticket {ticket.token_id} to</p>
          <p className="account-full">{target}</p>
          <p>
            <strong>You will lose the right to the refund.</strong> From then on only {target} can
            claim {money(ticket.principal, unit)}, and the transfer cannot be undone.
          </p>
          {registration === 'unknown' && (
            <p>
              Could not check whether {target} is registered with {unit.symbol}. If it is not, a
              refund to it fails until it registers.
            </p>
          )}
          {registration !== null && registration !== 'unknown' && !registration.registered && (
            <RegisterPanel
              account={registration}
              unit={unit}
              signer={ticket.owner_id}
              why={
                <p>
                  <strong>
                    {target} is not registered with {unit.symbol}.
                  </strong>{' '}
                  It can hold the ticket, but a refund to it fails until it registers, and the claim
                  then comes back to the ticket. You can register it now.
                </p>
              }
              tx={registerTx}
              refresh={{
                before: registration,
                read: () => readRegistration(registration.token, registration.accountId),
                apply: (fresh) => setRegistration(fresh),
                key: (value) => (value === 'unknown' ? 'unknown' : value?.registered),
              }}
            />
          )}
          {!registerTx.busy && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                // Cleared on send: any later transfer starts again from review.
                setTarget(null);
                setRegistration(null);
                onSend(target);
              }}
            >
              Transfer ticket {ticket.token_id} to {target}
            </button>
          )}
        </section>
      )}
    </section>
  );
}
