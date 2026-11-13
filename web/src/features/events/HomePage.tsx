import { type EventView, formatDateTime, PHASE_LABELS, PROMISE_TEXT } from '@ticket-escrow/client';
import { readAllPages } from '../../lib/pages';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { near } from './eventCopy';

const STEPS = [
  {
    title: 'You buy, the contract holds the money',
    body: 'The price goes into the contract, not to the organizer. Your ticket is a NEAR NFT (NEP-171) that records exactly what you paid.',
  },
  {
    title: 'An agreed verifier confirms the event',
    body: 'Before sales open, a verifier named in the terms accepts them. Only that account can confirm the event took place.',
  },
  {
    title: 'Paid out, or refunded to whoever holds the ticket',
    body: 'Confirmed: the organizer collects. Cancelled, or no confirmation by the deadline: the holder of each ticket claims its price back. Anyone can trigger the switch.',
  },
];

export function HomePage() {
  const { reader, timeZone } = useServices();
  const events = useLoad('events', () =>
    readAllPages((from, limit) => reader.listEvents(from, limit)),
  );
  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <h1>Event tickets whose price stays reserved until the event happens.</h1>
          <p className="lead">{PROMISE_TEXT}</p>
          <a className="btn" href="#events">
            See the events →
          </a>
        </div>
        <TicketStub />
      </section>

      <section className="steps" aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="step-list">
          {STEPS.map((step, i) => (
            <li key={step.title} className="step">
              <span className="numeral" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="events" className="events" aria-labelledby="events-heading">
        <h2 id="events-heading">Events</h2>
        <LoadState load={events} loadingText="Reading events from the contract…">
          {(list) =>
            list.length === 0 ? (
              <p className="empty">No events yet.</p>
            ) : (
              <ul aria-labelledby="events-heading" className="event-list">
                {list.map((event) => (
                  <EventRow key={event.event_id} event={event} timeZone={timeZone} />
                ))}
              </ul>
            )
          }
        </LoadState>
      </section>
    </>
  );
}

function EventRow({ event, timeZone }: { event: EventView; timeZone: string }) {
  return (
    <li className="event-row">
      <div className="event-row-main">
        <h3>
          <Link to={`/events/${event.event_id}`}>{event.title}</Link>
        </h3>
        <p>
          {event.venue} · {formatDateTime(event.starts_at_ms, timeZone)}
        </p>
      </div>
      <dl className="event-row-facts">
        <div>
          <dt>Price</dt>
          <dd>{near(event.price)}</dd>
        </div>
        <div>
          <dt>Verifier</dt>
          <dd>{event.verifier_id}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`phase phase-${event.phase}`}>{PHASE_LABELS[event.phase]}</span>
          </dd>
        </div>
      </dl>
    </li>
  );
}

/** The hero image: a drawn ticket, not a screenshot (landing style). */
function TicketStub() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="hero-diamond" />
      <div className="stub card">
        <p className="stub-eyebrow">Ticket 1-3 · Jazz night</p>
        <p className="stub-amount">1.5 NEAR</p>
        <p className="stub-state">Reserved</p>
        <p className="stub-note">Held by luis.testnet. Refund right goes with the ticket.</p>
      </div>
    </div>
  );
}
