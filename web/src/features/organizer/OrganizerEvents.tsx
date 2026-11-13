import {
  type AccountingView,
  actions,
  type EventView,
  moneyMoved,
  PHASE_LABELS,
} from '@ticket-escrow/client';
import { type ReactNode, useState } from 'react';
import { useTx } from '../../lib/near/useTx';
import { readAllPages } from '../../lib/pages';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { TxStatus } from '../../ui/TxStatus';
import { near } from '../events/eventCopy';

interface OrganizedEvent {
  event: EventView;
  accounting: AccountingView | null;
}

export function OrganizerEvents({ organizer }: { organizer: string }) {
  const { reader } = useServices();
  const load = useLoad(`organized:${organizer}`, async (): Promise<OrganizedEvent[]> => {
    const all = await readAllPages((from, limit) => reader.listEvents(from, limit));
    const mine = all.filter((e) => e.organizer_id === organizer);
    return Promise.all(
      mine.map(async (event) => ({
        event,
        accounting: await reader.getAccounting(event.event_id),
      })),
    );
  });

  return (
    <section className="organized" aria-labelledby="organized-heading">
      <h2 id="organized-heading">Your events</h2>
      <LoadState load={load} loadingText="Reading your events from the contract…">
        {(rows) =>
          rows.length === 0 ? (
            <p className="empty">{organizer} has not created any events.</p>
          ) : (
            <ul aria-label="Your events" className="event-list">
              {rows.map((row) => (
                <OrganizedRow
                  key={row.event.event_id}
                  row={row}
                  organizer={organizer}
                  reread={async () => ({
                    event: (await reader.getEvent(row.event.event_id)) ?? row.event,
                    accounting: await reader.getAccounting(row.event.event_id),
                  })}
                  apply={(fresh) =>
                    load.set(
                      rows.map((r) => (r.event.event_id === fresh.event.event_id ? fresh : r)),
                    )
                  }
                />
              ))}
            </ul>
          )
        }
      </LoadState>
    </section>
  );
}

function OrganizedRow({
  row,
  organizer,
  reread,
  apply,
}: {
  row: OrganizedEvent;
  organizer: string;
  reread: () => Promise<OrganizedEvent>;
  apply: (row: OrganizedEvent) => void;
}) {
  const { event, accounting } = row;
  const tx = useTx();
  const available = BigInt(accounting?.organizer_available ?? '0');
  const pending = BigInt(accounting?.organizer_pending ?? '0');
  const settled = BigInt(accounting?.organizer_settled ?? '0');
  const paid = tx.view.kind === 'done' && moneyMoved(tx.view.result);

  // The amount asked for, kept for the result: the re-read shows 0 once it is paid.
  const [asked, setAsked] = useState<string | null>(null);

  let payout: ReactNode;
  if (pending > 0n) {
    payout = (
      <p>
        Sending {near(pending.toString())} to {organizer}.
      </p>
    );
  } else if (available > 0n && !paid) {
    payout = tx.busy ? null : (
      <button
        type="button"
        className="btn"
        onClick={() => {
          setAsked(available.toString());
          void tx.run(actions.claimPayout(event.event_id), { before: row, read: reread, apply });
        }}
      >
        Collect {near(available.toString())} to {organizer}
      </button>
    );
  } else if (event.outcome === 'Unresolved') {
    payout = (
      <p className="muted">
        Nothing to collect until {event.verifier_id} confirms the event took place.
      </p>
    );
  } else if (event.outcome === 'Refundable') {
    payout = <p className="muted">Open for refunds: the organizer receives nothing.</p>;
  } else if (settled > 0n) {
    payout = <p className="muted">Collected {near(settled.toString())}.</p>;
  } else {
    payout = <p className="muted">Nothing to collect.</p>;
  }

  return (
    <li className="event-row">
      <div className="event-row-main">
        <h3>
          <Link to={`/events/${event.event_id}`}>{event.title}</Link>
        </h3>
        <p>
          <span className={`phase phase-${event.phase}`}>{PHASE_LABELS[event.phase]}</span>{' '}
          {event.sold} of {event.capacity} sold ·{' '}
          <Link to={`/verify/${event.event_id}`}>Verifier page</Link>
        </p>
      </div>
      <div className="payout">
        {payout}
        <TxStatus
          tx={tx}
          failureTitle="The payout did not complete."
          failureNote="The amount above was read again from the contract."
          succeeded={moneyMoved}
          success={() => (
            <p>
              Sent {near(asked ?? available.toString())} to {organizer}.
            </p>
          )}
        />
      </div>
    </li>
  );
}
