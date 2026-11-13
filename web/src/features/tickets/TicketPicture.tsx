import { mediaMatchesHash, type TicketDisplay, type TicketView } from '@ticket-escrow/client';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';

interface Shown {
  display: TicketDisplay;
  /** SHA-256 of the SVG bytes equals the hash the contract gives, checked here. */
  matches: boolean;
}

/**
 * The ticket as a wallet shows it: the picture and the sentence the contract computes from the
 * ticket's state at every read (`nft_token`). Its own read, so a failure only leaves it out. It is
 * read again whenever the page reads the ticket in another state, after a claim or a transfer.
 * The picture goes in an `<img>`, which runs no script, and only when its hash checks out.
 */
export function TicketPicture({ ticket }: { ticket: TicketView }) {
  const { reader } = useServices();
  const state = `${ticket.owner_id}:${ticket.status}:${ticket.claim}`;
  const load = useLoad(
    `ticket-display:${ticket.token_id}:${state}`,
    async (): Promise<Shown | null> => {
      const display = (await reader.ticketDisplay?.(ticket.token_id)) ?? null;
      return display === null ? null : { display, matches: mediaMatchesHash(display) };
    },
  );
  if (load.state.status !== 'ready' || load.state.data === null) return null;
  const { display, matches } = load.state.data;
  if (display.description === null && display.media === null) return null;
  const picture = display.media !== null;

  return (
    <section className="ticket-picture" aria-labelledby="ticket-picture-heading">
      <h2 id="ticket-picture-heading">As wallets show it</h2>
      {picture && matches && (
        <img
          className="ticket-picture-image"
          src={display.media ?? undefined}
          alt={display.description ?? display.title ?? `Ticket ${ticket.token_id}`}
          width={360}
          height={180}
        />
      )}
      {picture && !matches && (
        <p className="tx tx-notice">
          The picture does not match the hash the contract gives, so it is not shown.
        </p>
      )}
      {display.description !== null && <p>{display.description}</p>}
      <p className="muted">
        {picture
          ? 'The contract computes the picture and this sentence at every read, so they change with the ticket.'
          : 'The contract computes this sentence at every read, so it changes with the ticket.'}
        {picture && matches && ' The picture matches the hash the contract gives.'}
      </p>
    </section>
  );
}
