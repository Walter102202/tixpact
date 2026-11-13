import {
  type AccountingView,
  actions,
  type EventView,
  moneyMoved,
  PHASE_LABELS,
  type Reader,
} from '@ticket-escrow/client';
import { type ReactNode, useState } from 'react';
import { useTx } from '../../lib/near/useTx';
import { readAllPages } from '../../lib/pages';
import { Link } from '../../lib/router';
import type { Load } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { TxStatus } from '../../ui/TxStatus';
import { nearExact } from '../events/eventCopy';

export interface OrganizedEvent {
  event: EventView;
  accounting: AccountingView | null;
}

/** Every event `organizer` created, with its accounting. */
export async function readOrganizedEvents(
  reader: Reader,
  organizer: string,
): Promise<OrganizedEvent[]> {
  const all = await readAllPages((from, limit) => reader.listEvents(from, limit));
  const mine = all.filter((e) => e.organizer_id === organizer);
  return Promise.all(
    mine.map(async (event) => ({ event, accounting: await reader.getAccounting(event.event_id) })),
  );
}

export function OrganizerEvents({
  organizer,
  load,
}: {
  organizer: string;
  load: Load<OrganizedEvent[]>;
}) {
  const { reader } = useServices();
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

  const cancelTx = useTx();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancelled = cancelTx.view.kind === 'done' && cancelTx.view.result.ok;
  // R2: the organizer (or the verifier) may cancel while unresolved, before the deadline, judged
  // at the chain time of the read. Demo data never changes, so a done cancel is not offered again.
  const cancellable =
    event.outcome === 'Unresolved' &&
    event.now_ms < event.resolution_deadline_ms &&
    !cancelled &&
    !cancelTx.busy &&
    !tx.busy;

  function cancel() {
    setConfirmingCancel(false);
    void cancelTx.run(actions.cancelEvent(event.event_id, null), {
      before: row,
      read: reread,
      apply,
      key: (r) => [r.event.outcome, r.event.outcome_reason],
    });
  }

  // The amount asked for, kept for the result: the re-read shows 0 once it is paid.
  const [asked, setAsked] = useState<string | null>(null);

  let payout: ReactNode;
  if (pending > 0n) {
    payout = (
      <p>
        Sending {nearExact(pending.toString())} to {organizer}.
      </p>
    );
  } else if (available > 0n && !paid) {
    payout = tx.busy ? null : (
      <button
        type="button"
        className="btn"
        onClick={() => {
          setAsked(available.toString());
          void tx.run(actions.claimPayout(event.event_id), {
            before: row,
            read: reread,
            apply,
            // What a payout changes; the event view's clock (now_ms) moves on every block.
            key: (r) => r.accounting,
          });
        }}
      >
        Collect {nearExact(available.toString())} to {organizer}
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
    payout = <p className="muted">Collected {nearExact(settled.toString())}.</p>;
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
          failureDetail={(result) =>
            result.failedReceipt?.step === 'callback' ? (
              <p>
                The transfer to {organizer} ran, but the contract could not record it. The payout
                stays pending, so it cannot be paid twice.
              </p>
            ) : null
          }
          succeeded={moneyMoved}
          success={() => (
            <p>
              Sent {nearExact(asked ?? available.toString())} to {organizer}.
            </p>
          )}
        />
        {cancellable && !confirmingCancel && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setConfirmingCancel(true)}
          >
            Cancel event
          </button>
        )}
        {cancellable && confirmingCancel && (
          <section className="confirm" aria-label="Confirm the cancellation">
            <p>
              Cancel {event.title} for good? Every holder can then claim their price back. This
              cannot be undone.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={cancel}>
                Yes, cancel the event
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmingCancel(false)}
              >
                Keep the event
              </button>
            </div>
          </section>
        )}
        <TxStatus
          tx={cancelTx}
          failureTitle="The event was not cancelled."
          failureNote="The event above was read again from the contract."
          success={() => <p>Cancelled. Every holder can now claim their price back.</p>}
        />
      </div>
    </li>
  );
}
