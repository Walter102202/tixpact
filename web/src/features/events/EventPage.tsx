import {
  type AccountingView,
  type EventView,
  formatDateTime,
  PHASE_LABELS,
  PROMISE_TEXT,
  type Unit,
} from '@ticket-escrow/client';
import { money, unitFor } from '../../lib/money';
import { useWallet } from '../../lib/near/useWallet';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { AccountLink } from '../../ui/AccountLink';
import { CurrencyFact } from '../../ui/CurrencyFact';
import { LoadState } from '../../ui/LoadState';
import { BuyPanel } from './BuyPanel';
import { outcomeLine, referenceLabel, verifierStatus } from './eventCopy';

export interface EventData {
  event: EventView;
  accounting: AccountingView | null;
  /** The unit of the event's currency: every amount below is in it. */
  unit: Unit;
}

export function EventPage({ id }: { id: string }) {
  const { reader } = useServices();
  const eventId = /^[1-9][0-9]*$/.test(id) ? Number(id) : null;

  async function read(): Promise<EventData | null> {
    if (eventId === null) return null;
    const [event, accounting] = await Promise.all([
      reader.getEvent(eventId),
      reader.getAccounting(eventId),
    ]);
    return event ? { event, accounting, unit: await unitFor(reader, event.currency) } : null;
  }

  const load = useLoad(`event:${id}`, read);
  return (
    <LoadState load={load} loadingText="Reading the event from the contract…">
      {(data) =>
        data === null ? (
          <section className="page">
            <h1>Not found</h1>
            <p>There is no event {id}.</p>
          </section>
        ) : (
          <EventDetails
            data={data}
            reread={async () => (await read()) ?? data}
            apply={(fresh) => load.set(fresh)}
          />
        )
      }
    </LoadState>
  );
}

function EventDetails({
  data,
  reread,
  apply,
}: {
  data: EventData;
  reread: () => Promise<EventData>;
  apply: (data: EventData) => void;
}) {
  const { timeZone } = useServices();
  const { accountId } = useWallet();
  const { event, accounting, unit } = data;
  const outcome = outcomeLine(event);
  const time = (ms: number) => formatDateTime(ms, timeZone);

  return (
    <article className="page event-page">
      <p className="eyebrow">
        <span className={`phase phase-${event.phase}`}>{PHASE_LABELS[event.phase]}</span>
      </p>
      <h1>{event.title}</h1>
      <p className="lead">{event.venue}</p>

      <div className="event-layout">
        <div>
          <dl className="facts">
            <dt>Price</dt>
            <dd>{money(event.price, unit)}</dd>
            <CurrencyFact currency={event.currency} unit={unit} />
            <dt>Reserved in the contract</dt>
            <dd>{accounting ? money(accounting.principal_reserved, unit) : 'Not available'}</dd>
            <dt>Tickets sold</dt>
            <dd>
              {event.sold} of {event.capacity}
            </dd>
            <dt>Organizer</dt>
            <dd>
              <AccountLink id={event.organizer_id} />
            </dd>
            <dt>Verifier</dt>
            <dd>
              <AccountLink id={event.verifier_id} /> · {verifierStatus(event)}
            </dd>
            <dt>Starts</dt>
            <dd>{time(event.starts_at_ms)}</dd>
            <dt>Ends</dt>
            <dd>{time(event.ends_at_ms)}</dd>
            <dt>Confirmation deadline</dt>
            <dd>{time(event.resolution_deadline_ms)}</dd>
          </dl>
          {accountId === event.verifier_id && (
            <p>
              <Link to={`/verify/${event.event_id}`}>Open the verifier page</Link>
            </p>
          )}

          {outcome && (
            <section className="outcome" aria-label="Outcome">
              <p className="outcome-line">{outcome}</p>
              {event.resolved_at_ms !== null && (
                <p className="muted">On {time(event.resolved_at_ms)}</p>
              )}
              {event.evidence_ref !== null && (
                <dl className="facts">
                  <dt>{referenceLabel(event)}</dt>
                  {/* Free text chosen by the caller: shown, never linked or vouched for. */}
                  <dd className="reference">{event.evidence_ref}</dd>
                </dl>
              )}
            </section>
          )}
        </div>

        <aside className="card promise-card">
          <p className="promise">{PROMISE_TEXT}</p>
          <BuyPanel data={data} reread={reread} apply={apply} />
        </aside>
      </div>
    </article>
  );
}
