import { actions, type Config, type EventTerms, unitOf } from '@ticket-escrow/client';
import { type FormEvent, Fragment, useCallback, useId, useState } from 'react';
import { isNamedAccount, missingAccountMessage } from '../../lib/accounts';
import { NEAR_UNIT } from '../../lib/money';
import { type Refresh, useTx } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { TxStatus } from '../../ui/TxStatus';
import { nearExact } from '../events/eventCopy';
import { type OrganizedEvent, OrganizerEvents, readOrganizedEvents } from './OrganizerEvents';
import {
  checkTerms,
  EMPTY_FORM,
  type Field,
  type FieldErrors,
  type FormValues,
  parseCapacity,
} from './terms';

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
  Price: { type: 'text', inputMode: 'decimal' },
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
  const { reader, timeZone, now, contractId } = useServices();
  const tx = useTx();
  const formId = useId();
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  // Null is NEAR; otherwise one of the tokens the contract accepts (`config.tokens`).
  const [currency, setCurrency] = useState<string | null>(null);
  const unit = currency === null ? NEAR_UNIT : unitOf(config, currency);
  const [submitted, setSubmitted] = useState(false);
  const [sent, setSent] = useState<EventTerms | null>(null);

  const capacity = parseCapacity(values.Capacity, config);
  const quote = useLoad(`quote:${capacity ?? 'none'}`, async () => ({
    capacity,
    budget: capacity === null ? null : await reader.quoteEventBudget(capacity),
  }));
  // Only the quote for the capacity now in the field counts: the budget sent must cover it.
  const budget =
    quote.state.status === 'ready' && quote.state.data.capacity === capacity
      ? quote.state.data.budget
      : null;
  const quoteFailed = capacity !== null && quote.state.status === 'error';
  const check = checkTerms(values, {
    config,
    organizer,
    contractId,
    nowMs: now?.() ?? Date.now(),
    timeZone,
    currency,
    unit,
  });
  const verifier = check.errors['Verifier account'] ? null : values['Verifier account'].trim();

  // A mistyped named verifier would lock the budget in an event nobody can accept, or hand the
  // role to whoever registers that name: check it exists before the button works.
  const toCheck = verifier !== null && isNamedAccount(verifier) ? verifier : null;
  const known = useLoad(`verifier:${toCheck ?? ''}`, async () => ({
    id: toCheck,
    exists:
      toCheck === null || reader.accountExists === undefined
        ? true
        : await reader.accountExists(toCheck),
  }));
  // Only the answer for the id now in the field counts.
  const found =
    known.state.status === 'ready' && known.state.data.id === toCheck
      ? known.state.data.exists
      : null;
  const checkFailed = toCheck !== null && known.state.status === 'error';
  const checking = toCheck !== null && found === null && !checkFailed;
  let verifierProblem: string | null = null;
  if (checkFailed) {
    verifierProblem = `Could not check that ${toCheck} exists. Nothing is sent until it is checked.`;
  } else if (toCheck !== null && found === false) {
    verifierProblem = missingAccountMessage(toCheck);
  }

  const errors: FieldErrors = {
    ...(submitted ? check.errors : {}),
    ...(verifierProblem === null ? {} : { 'Verifier account': verifierProblem }),
  };
  const done = tx.view.kind === 'done' && tx.view.result.ok;

  function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    setSubmitted(true);
    if (check.terms === null || budget === null || (toCheck !== null && found !== true)) return;
    setSent(check.terms);
    // Sent straight from the click: the wallet opens a popup, which browsers allow only here.
    void tx.run(actions.createEvent(check.terms, budget), refresh);
  }

  const waitingForQuote = capacity !== null && budget === null;
  // Every disabled button says why.
  let waiting: string | null = null;
  if (waitingForQuote && !quoteFailed) waiting = 'Reading the storage budget…';
  else if (checking) waiting = `Checking that ${toCheck} exists on testnet…`;
  let disabledBecause: string | undefined;
  if (quoteFailed) disabledBecause = `${formId}-quote-error`;
  else if (waiting !== null) disabledBecause = `${formId}-waiting`;
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
            <Fragment key={field}>
              {field === 'Price' && config.tokens.length > 0 && (
                <CurrencyPicker
                  config={config}
                  value={currency}
                  disabled={tx.busy}
                  onChange={setCurrency}
                />
              )}
              <div className="field">
                <label htmlFor={id}>{field === 'Price' ? `Price in ${unit.symbol}` : field}</label>
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
                {field === 'Verifier account' && checkFailed && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={known.reload}>
                    Check the account again
                  </button>
                )}
              </div>
            </Fragment>
          );
        })}

        <div className="organizer-promise">
          {budget !== null && <p className="budget">Storage budget: {nearExact(budget)}</p>}
          {quoteFailed && (
            <div className="quote-error">
              <p id={`${formId}-quote-error`} className="field-error" role="alert">
                Could not read the storage budget.
              </p>
              <button type="button" className="btn btn-sm btn-secondary" onClick={quote.reload}>
                Try again
              </button>
            </div>
          )}
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

        {submitted && Object.keys(errors).length > 0 && (
          <p className="field-error" role="alert">
            Fix the fields marked above; nothing was sent.
          </p>
        )}
        {!tx.busy && !done && (
          <>
            <button
              type="submit"
              className="btn"
              disabled={waitingForQuote || waiting !== null}
              aria-describedby={disabledBecause}
            >
              {budget === null
                ? 'Create the event'
                : `Create the event and pay ${nearExact(budget)} to the contract`}
            </button>
            {waiting !== null && (
              <p id={`${formId}-waiting`} className="muted">
                {waiting}
              </p>
            )}
          </>
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
  const { fixtureMode } = useServices();
  // The recorded transaction lends its result (event 9), but the demo data gains no event.
  if (fixtureMode) return <p>Demo: no event was created. Live, the new event opens from here.</p>;
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

/**
 * The event's currency: NEAR or one of the tokens the contract accepts. Shown only when the
 * contract accepts a token. The terms hash covers it, so it cannot change after creation.
 */
function CurrencyPicker({
  config,
  value,
  disabled,
  onChange,
}: {
  config: Config;
  value: string | null;
  disabled: boolean;
  onChange: (currency: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="field currency-field">
      <label htmlFor={id}>Currency</label>
      <select
        id={id}
        className="input"
        value={value ?? ''}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(change) => onChange(change.target.value === '' ? null : change.target.value)}
      >
        <option value="">NEAR</option>
        {config.tokens.map((token) => (
          <option key={token.account_id} value={token.account_id}>
            {token.symbol} (the token {token.account_id})
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="muted field-hint">
        The price, the refunds and the payout are all in this currency. The storage budget is always
        in NEAR.
      </p>
    </div>
  );
}
