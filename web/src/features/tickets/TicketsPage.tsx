import { CLAIM_LABELS, type EventView, type TicketView } from '@ticket-escrow/client';
import { useWallet } from '../../lib/near/useWallet';
import { readAllPages } from '../../lib/pages';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { near } from '../events/eventCopy';
import { claimWord } from './ticketCopy';

interface HeldTicket {
  ticket: TicketView;
  event: EventView | null;
}

export function TicketsPage() {
  const { accountId, signIn } = useWallet();
  return (
    <section className="page" aria-labelledby="tickets-heading">
      <h1 id="tickets-heading">My tickets</h1>
      {accountId === null ? (
        <>
          <p>Sign in to see the tickets you hold.</p>
          <button type="button" className="btn" onClick={signIn}>
            Sign in to see your tickets
          </button>
        </>
      ) : (
        <HeldTickets key={accountId} accountId={accountId} />
      )}
    </section>
  );
}

function HeldTickets({ accountId }: { accountId: string }) {
  const { reader } = useServices();
  const load = useLoad(`tickets:${accountId}`, async (): Promise<HeldTicket[]> => {
    const tickets = await readAllPages((from, limit) =>
      reader.listTicketsForOwner(accountId, from, limit),
    );
    const ids = [...new Set(tickets.map((t) => t.event_id))];
    const events = new Map(
      await Promise.all(ids.map(async (id) => [id, await reader.getEvent(id)] as const)),
    );
    return tickets.map((ticket) => ({ ticket, event: events.get(ticket.event_id) ?? null }));
  });

  return (
    <LoadState load={load} loadingText="Reading your tickets from the contract…">
      {(held) =>
        held.length === 0 ? (
          <p className="empty">{accountId} holds no tickets.</p>
        ) : (
          <ul aria-label="Your tickets" className="ticket-list">
            {held.map(({ ticket, event }) => (
              <li key={ticket.token_id} className="ticket-row">
                <div>
                  <h2 className="ticket-row-title">
                    <Link to={`/tickets/${ticket.token_id}`}>Ticket {ticket.token_id}</Link>
                  </h2>
                  <p className="muted">{event?.title ?? `Event ${ticket.event_id}`}</p>
                </div>
                <dl className="event-row-facts">
                  <div>
                    <dt>Holder</dt>
                    <dd className="account-id">{ticket.owner_id}</dd>
                  </div>
                  <div>
                    <dt>Price paid</dt>
                    <dd>{near(ticket.principal)}</dd>
                  </div>
                  <div>
                    <dt>State</dt>
                    <dd>
                      <span className={`claim-word claim-${ticket.claim}`}>
                        {event ? claimWord(ticket, event) : CLAIM_LABELS[ticket.claim]}
                      </span>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )
      }
    </LoadState>
  );
}
