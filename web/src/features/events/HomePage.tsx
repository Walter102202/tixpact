import {
  type EventView,
  formatDateTime,
  PHASE_LABELS,
  PROMISE_TEXT,
  type Unit,
} from '@ticket-escrow/client';
import { useId } from 'react';
import { money, unitFor } from '../../lib/money';
import { readAllPages } from '../../lib/pages';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { AgentTerminal } from '../landing/AgentTerminal';
import { Problem } from '../landing/Problem';
import { Replay } from '../landing/Replay';
import { Reveal, type RevealDelay } from '../landing/Reveal';

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
  const events = useLoad('events', async () => {
    const all = await readAllPages((from, limit) => reader.listEvents(from, limit));
    // Newest first: the events a visitor can still buy come before the ones already settled.
    const list = [...all].sort((a, b) => b.event_id - a.event_id);
    return Promise.all(
      list.map(async (event) => ({ event, unit: await unitFor(reader, event.currency) })),
    );
  });
  return (
    <>
      <section className="hero">
        <div className="hero-text rise">
          <p className="eyebrow hero-eyebrow">
            When an event is cancelled, your refund depends on the seller still having your money.
          </p>
          <h1>Event tickets whose price stays reserved until the event happens.</h1>
          <p className="lead">{PROMISE_TEXT}</p>
          <a className="btn" href="#events">
            See the events →
          </a>
        </div>
        <TicketStub />
      </section>

      <Problem />

      <Reveal as="section" className="landing-section steps" aria-labelledby="how-heading">
        <p className="eyebrow section-eyebrow">02</p>
        <h2 id="how-heading">How it works</h2>
        <div className="how-grid">
          <ol className="step-list">
            {STEPS.map((step, i) => (
              <Reveal as="li" key={step.title} delay={(i + 1) as RevealDelay} className="step">
                <span className="numeral" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Replay />
        </div>
      </Reveal>

      <Reveal as="section" className="landing-section agents" aria-labelledby="agents-heading">
        <p className="eyebrow section-eyebrow">03</p>
        <h2 id="agents-heading">An agent can hold tickets too.</h2>
        <p className="lead">
          The ticket agent buys only within the caps its owner sets, and its watcher claims the
          refund when an event is never confirmed.
        </p>
        <AgentTerminal />
      </Reveal>

      <Reveal
        as="section"
        id="events"
        className="landing-section events"
        aria-labelledby="events-heading"
      >
        <h2 id="events-heading">Events</h2>
        <LoadState load={events} loadingText="Reading events from the contract…">
          {(list) =>
            list.length === 0 ? (
              <p className="empty">No events yet.</p>
            ) : (
              <ul aria-labelledby="events-heading" className="event-list">
                {list.map(({ event, unit }) => (
                  <EventRow key={event.event_id} event={event} unit={unit} timeZone={timeZone} />
                ))}
              </ul>
            )
          }
        </LoadState>
      </Reveal>
    </>
  );
}

function EventRow({ event, unit, timeZone }: { event: EventView; unit: Unit; timeZone: string }) {
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
          <dd>{money(event.price, unit)}</dd>
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

/**
 * The hero image: a drawn ticket, not a screenshot (landing style). It is labelled as an example in
 * both modes, so it never reads as chain data next to the live events list.
 */
function TicketStub() {
  const labelId = useId();
  return (
    <div className="hero-art rise" data-delay="2">
      <div className="hero-diamond" aria-hidden="true" />
      <figure className="stub card" aria-labelledby={labelId}>
        <figcaption id={labelId} className="stub-label">
          Example ticket
        </figcaption>
        <p className="stub-eyebrow">Ticket 1-3 · Jazz night</p>
        <p className="stub-amount">1.5 NEAR</p>
        <p className="stub-state">Reserved</p>
        <p className="stub-note">Held by luis.testnet. Refund right goes with the ticket.</p>
      </figure>
    </div>
  );
}
