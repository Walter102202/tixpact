import {
  actions,
  type Config,
  type ContractCall,
  type EventView,
  formatDateTime,
  PHASE_LABELS,
} from '@ticket-escrow/client';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTx } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { Link } from '../../lib/router';
import { tooLong } from '../../lib/text';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { AccountLink } from '../../ui/AccountLink';
import { LoadState } from '../../ui/LoadState';
import { TxStatus } from '../../ui/TxStatus';
import { near } from '../events/eventCopy';
import { type VerifierAction, verifierBlockers } from './verifierActions';

interface VerifyData {
  event: EventView;
  config: Config;
}

export function VerifyPage({ id }: { id: string }) {
  const { reader } = useServices();
  const eventId = /^[1-9][0-9]*$/.test(id) ? Number(id) : null;

  async function read(): Promise<VerifyData | null> {
    if (eventId === null) return null;
    const [event, config] = await Promise.all([reader.getEvent(eventId), reader.getConfig()]);
    return event ? { event, config } : null;
  }

  const load = useLoad(`verify:${id}`, read);
  return (
    <LoadState load={load} loadingText="Reading the event from the contract…">
      {(data) =>
        data === null ? (
          <section className="page">
            <h1>Not found</h1>
            <p>There is no event {id}.</p>
          </section>
        ) : (
          <VerifyDetails
            data={data}
            reread={async () => (await read()) ?? data}
            apply={(fresh) => load.set(fresh)}
          />
        )
      }
    </LoadState>
  );
}

/** A decision checked at the first click: the second click sends exactly this. */
interface Pending {
  action: 'attest' | 'cancel';
  ref: string | null;
  accountId: string;
}

const SUCCESS: Record<VerifierAction, string> = {
  accept: 'You accepted the terms. Tickets can now be sold.',
  attest: 'Confirmed. The organizer can now collect the ticket money.',
  cancel: 'Cancelled. Every holder can now claim their price back.',
};

function VerifyDetails({
  data,
  reread,
  apply,
}: {
  data: VerifyData;
  reread: () => Promise<VerifyData>;
  apply: (data: VerifyData) => void;
}) {
  const { timeZone } = useServices();
  const { accountId, signIn } = useWallet();
  const tx = useTx();
  const { event, config } = data;
  const time = (ms: number) => formatDateTime(ms, timeZone);
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [inputError, setInputError] = useState<Partial<Record<VerifierAction, string>>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [sent, setSent] = useState<VerifierAction | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of account closes the box.
  useEffect(() => setPending(null), [accountId]);

  const blockers = verifierBlockers(event, accountId, time);
  const succeeded = tx.view.kind === 'done' && tx.view.result.ok;
  // After a success the page waits for the contract's new state instead of offering it again.
  const blocked = (action: VerifierAction) =>
    tx.busy
      ? 'A transaction is being sent.'
      : succeeded && sent === action
        ? 'Done.'
        : blockers[action];

  function send(action: VerifierAction, call: ContractCall) {
    setPending(null);
    setSent(action);
    void tx.run(call, {
      before: data,
      read: reread,
      apply,
      // What a verifier decision changes; the view's clock (now_ms) moves on every block.
      key: ({ event: e }) => [e.verifier_accepted, e.outcome, e.outcome_reason, e.evidence_ref],
    });
  }

  /** Checks the optional reference and opens the confirmation step with what was checked. */
  function ask(action: 'attest' | 'cancel') {
    if (accountId === null) return;
    const value = (action === 'attest' ? evidence : reason).trim();
    const error = tooLong(action === 'attest' ? 'evidence' : 'reason', value, config.max_ref_bytes);
    setInputError(error ? { [action]: error } : {});
    setPending(error ? null : { action, ref: value === '' ? null : value, accountId });
  }

  /** The checked decision, while its box may be shown: same account, and still allowed. */
  const confirming = (action: 'attest' | 'cancel'): Pending | null =>
    pending?.action === action && pending.accountId === accountId && blocked(action) === null
      ? pending
      : null;
  const attest = confirming('attest');
  const cancel = confirming('cancel');

  return (
    <article className="page verify-page">
      <p className="eyebrow">
        Verifier page ·{' '}
        <span className={`phase phase-${event.phase}`}>{PHASE_LABELS[event.phase]}</span>
      </p>
      <h1>{event.title}</h1>
      <p className="lead">
        {event.verifier_id} decides whether this event took place. Only that account can accept the
        terms, confirm the event, or declare it cancelled.
      </p>

      <div className="event-layout">
        <section className="card" aria-label="The terms">
          <h2 className="card-title">The terms</h2>
          <dl className="facts">
            <dt>Event</dt>
            <dd>
              <Link to={`/events/${event.event_id}`}>{event.title}</Link>, {event.venue}
            </dd>
            <dt>Organizer</dt>
            <dd>
              <AccountLink id={event.organizer_id} />
            </dd>
            <dt>Verifier</dt>
            <dd>
              <AccountLink id={event.verifier_id} />
            </dd>
            <dt>Starts</dt>
            <dd>{time(event.starts_at_ms)}</dd>
            <dt>Ends</dt>
            <dd>{time(event.ends_at_ms)}</dd>
            <dt>Confirmation deadline</dt>
            <dd>{time(event.resolution_deadline_ms)}</dd>
            <dt>Price</dt>
            <dd>{near(event.price)}</dd>
            <dt>Capacity</dt>
            <dd>{event.capacity} tickets</dd>
            <dt>Terms hash</dt>
            <dd className="reference">{event.terms_hash}</dd>
          </dl>
        </section>

        <section className="verifier-actions" aria-label="Your decision">
          {accountId === null && (
            <button type="button" className="btn btn-secondary" onClick={signIn}>
              Sign in as the verifier
            </button>
          )}

          <ActionBlock
            label="Accept"
            blocked={blocked('accept')}
            note="Accepting opens ticket sales. You commit to confirming, after the end and before the deadline, whether the event took place."
            onClick={() =>
              send('accept', actions.acceptVerification(event.event_id, event.terms_hash))
            }
          />

          <ActionBlock
            label="Confirm the event took place"
            blocked={blocked('attest')}
            note="Releases the ticket money to the organizer. Holders can no longer claim refunds."
            input={
              <RefInput
                label="Evidence (optional)"
                value={evidence}
                onChange={setEvidence}
                disabled={blocked('attest') !== null || attest !== null}
                error={inputError.attest}
              />
            }
            onClick={() => ask('attest')}
          />
          {attest && (
            <section className="confirm" aria-label="Confirm the attestation">
              <p>
                Confirm that {event.title} took place? Then the organizer can collect the ticket
                money, and no holder can claim a refund. This cannot be undone.
              </p>
              <KeptRef label="Evidence" value={attest.ref} />
              <div className="confirm-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    send('attest', actions.attestCompleted(event.event_id, attest.ref))
                  }
                >
                  Yes, it took place
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPending(null)}
                >
                  Go back
                </button>
              </div>
            </section>
          )}

          <ActionBlock
            label="Declare cancelled"
            blocked={blocked('cancel')}
            note="Every holder can then claim their price back. The organizer receives nothing."
            input={
              <RefInput
                label="Reason (optional)"
                value={reason}
                onChange={setReason}
                disabled={blocked('cancel') !== null || cancel !== null}
                error={inputError.cancel}
              />
            }
            onClick={() => ask('cancel')}
          />
          {cancel && (
            <section className="confirm" aria-label="Confirm the cancellation">
              <p>
                Cancel {event.title} for good? Every holder can claim their price back. This cannot
                be undone.
              </p>
              <KeptRef label="Reason" value={cancel.ref} />
              <div className="confirm-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => send('cancel', actions.cancelEvent(event.event_id, cancel.ref))}
                >
                  Yes, declare it cancelled
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPending(null)}
                >
                  Keep the event
                </button>
              </div>
            </section>
          )}

          <TxStatus
            tx={tx}
            failureTitle="The contract did not take this decision."
            failureNote="The terms and the state above were read again from the contract."
            success={() => <p>{sent ? SUCCESS[sent] : 'Done.'}</p>}
          />
        </section>
      </div>
    </article>
  );
}

/** The reference the decision stores for good, shown before the second click. */
function KeptRef({ label, value }: { label: 'Evidence' | 'Reason'; value: string | null }) {
  return value === null ? (
    <p className="muted">No {label.toLowerCase()} is kept on chain.</p>
  ) : (
    <p>
      {label} kept on chain: <span className="reference">{value}</span>
    </p>
  );
}

function ActionBlock({
  label,
  blocked,
  note,
  input,
  onClick,
}: {
  label: string;
  blocked: string | null;
  note: string;
  input?: ReactNode;
  onClick: () => void;
}) {
  const reasonId = useId();
  return (
    <div className="action-block">
      {input}
      <button
        type="button"
        className="btn"
        disabled={blocked !== null}
        aria-describedby={blocked === null ? undefined : reasonId}
        onClick={onClick}
      >
        {label}
      </button>
      {blocked === null ? (
        <p className="muted">{note}</p>
      ) : (
        <p id={reasonId} className="muted">
          {blocked}
        </p>
      )}
    </div>
  );
}

function RefInput({
  label,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        disabled={disabled}
        autoComplete="off"
        placeholder="A link or a short note, kept on chain"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(change) => onChange(change.target.value)}
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
