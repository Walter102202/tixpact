import { actions, type Config, type EventTerms } from '@ticket-escrow/client';
import { type FormEvent, useCallback, useId, useState } from 'react';
import { type Refresh, useTx } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { TxStatus } from '../../ui/TxStatus';
import { nearExact } from '../events/eventCopy';
import { type OrganizedEvent, OrganizerEvents, readOrganizedEvents } from './OrganizerEvents';
import { checkTerms, EMPTY_FORM, type Field, type FormValues, parseCapacity } from './terms';

export function OrganizerPage() {
  const { accountId, signIn } = useWallet();
  return (
    <section className="page organizer-page" aria-labelledby="organizer-heading">
      <h1 id="organizer-heading">Organize an event</h1>
      {accountId === null ? (
        <>
          <p>Sign in to create an event.</p>
          <button type="button" className="btn" onClick={signIn}>
            Sign in to organize
          </button>
        </>
      ) : (
        <Organizer key={accountId} organizer={accountId} />
      )}
    </section>
  );
}

function Organizer({ organizer }: { organizer: string }) {
  const { reader } = useServices();
  const read = useCallback(() => readOrganizedEvents(reader, organizer), [reader, organizer]);
  const events = useLoad(`organized:${organizer}`, read);
  // A create adds to the organizer's events: the form re-reads them after a send, so an unknown
  // result never brings the button back before the list was read again.
  const refresh: Refresh<OrganizedEvent[]> = {
    before: events.state.status === 'ready' ? events.state.data : [],
    read,
    apply: events.set,
    key: (rows) => rows.map((row) => row.event.event_id),
  };
  return (
    <div>
      <CreateEvent organizer={organizer} refresh={refresh} />
      <OrganizerEvents organizer={organizer} load={events} />
    </div>
  );
}

function CreateEvent({
  organizer,
  refresh,
}: {
  organizer: string;
  refresh: Refresh<OrganizedEvent[]>;
}) {
  const { reader } = useServices();
  const config = useLoad('config', () => reader.getConfig());
  return (
    <LoadState load={config} loadingText="Reading the contract's limits…">
      {(limits) => <CreateEventForm config={limits} organizer={organizer} refresh={refresh} />}
    </LoadState>
  );
}

const INPUTS: Record<Field, { type: string; hint?: string; inputMode?: 'decimal' | 'numeric' }> = {
  Title: { type: 'text' },
  Venue: { type: 'text' },
  Starts: { type: 'datetime-local' },
  Ends: { type: 'datetime-local' },
  'Confirmation deadline': {
    type: 'datetime-local',
    hint: 'The verifier can confirm between the end and this moment.',
  },
  'Price in NEAR': { type: 'text', inputMode: 'decimal' },
  Capacity: { type: 'text', inputMode: 'numeric' },
  'Verifier account': {
    type: 'text',
    hint: 'The account that confirms the event took place. It must accept these terms before sales open.',
  },
};

function CreateEventForm({
  config,
  organizer,
  refresh,
}: {
  config: Config;
  organizer: string;
  refresh: Refresh<OrganizedEvent[]>;
}) {
  const { reader, timeZone, now } = useServices();
  const tx = useTx();
  const formId = useId();
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState<EventTerms | null>(null);

  const capacity = parseCapacity(values.Capacity, config);
  const quote = useLoad(`quote:${capacity ?? 'none'}`, () =>
    capacity === null ? Promise.resolve(null) : reader.quoteEventBudget(capacity),
  );
  const budget = quote.state.status === 'ready' ? quote.state.data : null;
  const check = checkTerms(values, config, organizer, now?.() ?? Date.now());
  const errors = submitted ? check.errors : {};

  const verifier = check.errors['Verifier account'] ? null : values['Verifier account'].trim();
  const done = tx.view.kind === 'done' && tx.view.result.ok;

  function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    setSubmitted(true);
    if (check.terms === null || budget === null) return;
    setSent(check.terms);
    // Sent straight from the click: the wallet opens a popup, which browsers allow only here.
    void tx.run(actions.createEvent(check.terms, budget), refresh);
  }

  const waitingForQuote = capacity !== null && budget === null;
  return (
    <section className="create-event" aria-labelledby={`${formId}-heading`}>
      <h2 id={`${formId}-heading`}>Create an event</h2>
      <p className="muted">Times are in your time zone ({timeZone}).</p>
      <form onSubmit={submit} noValidate className="terms-form">
        {(Object.keys(INPUTS) as Field[]).map((field) => {
          const id = `${formId}-${field.replace(/\s+/g, '-')}`;
          const error = errors[field];
          const { type, hint, inputMode } = INPUTS[field];
          const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={field} className="field">
              <label htmlFor={id}>{field}</label>
              <input
                id={id}
                className="input"
                type={type}
                {...(inputMode ? { inputMode } : {})}
                value={values[field]}
                disabled={tx.busy}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={described || undefined}
                onChange={(change) =>
                  setValues((current) => ({ ...current, [field]: change.target.value }))
                }
              />
              {hint && (
                <p id={`${id}-hint`} className="muted field-hint">
                  {hint}
                </p>
              )}
              {error && (
                <p id={`${id}-error`} className="field-error">
                  {error}
                </p>
              )}
            </div>
          );
        })}

        <div className="organizer-promise">
          {budget !== null && <p className="budget">Storage budget: {nearExact(budget)}</p>}
          <ul>
            <li>
              You receive nothing before {verifier ?? 'the verifier'} confirms the event took place.
            </li>
            <li>
              If nobody confirms by the deadline, every ticket holder can claim their price back.
            </li>
            <li>
              The storage budget pays for keeping the event and its tickets on chain. It is not
              ticket money.
            </li>
          </ul>
        </div>

        {submitted && Object.keys(check.errors).length > 0 && (
          <p className="field-error" role="alert">
            Fix the fields marked above; nothing was sent.
          </p>
        )}
        {!tx.busy && !done && (
          <button type="submit" className="btn" disabled={waitingForQuote}>
            {budget === null
              ? 'Create the event'
              : `Create the event and pay ${nearExact(budget)} to the contract`}
          </button>
        )}
      </form>

      <TxStatus
        tx={tx}
        failureTitle="The event was not created."
        failureNote="The storage budget comes back to your account when the call fails."
        success={(result) => <Created eventId={result.value} terms={sent} />}
      />
    </section>
  );
}

function Created({ eventId, terms }: { eventId: unknown; terms: EventTerms | null }) {
  if (typeof eventId !== 'number') return <p>The event was created.</p>;
  const verifyUrl = `${window.location.origin}/verify/${eventId}`;
  return (
    <>
      <p>Event {eventId} created.</p>
      <Link to={`/events/${eventId}`}>Open event {eventId}</Link>
      <p>
        Tickets go on sale once {terms?.verifier_id ?? 'the verifier'} accepts the terms. Send them
        this page: <span className="account-full">{verifyUrl}</span>
      </p>
    </>
  );
}
