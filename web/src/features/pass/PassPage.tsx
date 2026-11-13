import {
  decodePass,
  doorUrl,
  type EntryPass,
  type EventView,
  encodePass,
  PASS_TTL_MS,
  type TicketView,
  TokenIdSchema,
} from '@ticket-escrow/client';
import { useEffect, useState } from 'react';
import { Link, replaceHash, useHash } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { AccountLink } from '../../ui/AccountLink';
import { LoadState } from '../../ui/LoadState';
import { EntryPassOffer } from './EntryPassOffer';
import { clockTime, countdown } from './passFlow';
import { QrCode } from './QrCode';

interface PassTicket {
  ticket: TicketView;
  event: EventView | null;
}

/** The time now, read again every second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** `/tickets/:id/pass`: the holder's entry pass, carried in the URL fragment. */
export function PassPage({ id }: { id: string }) {
  const { reader, contractId } = useServices();
  const hash = useHash();
  const tokenId = TokenIdSchema.safeParse(id).success ? id : null;
  const fromUrl = decodePass(hash);
  // A pass for another ticket or contract is not this page's to show.
  const pass = fromUrl?.ticket === id && fromUrl.contract === contractId ? fromUrl : null;

  const load = useLoad(`pass-ticket:${id}`, async (): Promise<PassTicket | null> => {
    if (tokenId === null) return null;
    const ticket = await reader.getTicket(tokenId);
    if (ticket === null) return null;
    return { ticket, event: await reader.getEvent(ticket.event_id) };
  });

  return (
    <LoadState load={load} loadingText="Reading the ticket from the contract…">
      {(data) =>
        data === null ? (
          <section className="page">
            <h1>Not found</h1>
            <p>There is no ticket {id}.</p>
          </section>
        ) : (
          <article className="page pass-page">
            <p className="eyebrow">
              <Link to={`/tickets/${id}`}>
                Ticket {id}
                {data.event ? ` · ${data.event.title}` : ''}
              </Link>
            </p>
            <h1>Entry pass</h1>
            {pass === null ? (
              <section className="card pass-card">
                <p>
                  Show this pass at the door. Your wallet signs it, nothing is sent to the chain,
                  and it admits for five minutes.
                </p>
                <EntryPassOffer
                  ticket={data.ticket}
                  onSigned={(signed) => replaceHash(`p=${encodePass(signed)}`)}
                />
              </section>
            ) : (
              <PassView pass={pass} ticket={data.ticket} />
            )}
          </article>
        )
      }
    </LoadState>
  );
}

function PassView({ pass, ticket }: { pass: EntryPass; ticket: TicketView }) {
  const { timeZone } = useServices();
  const now = useNow();
  const expiresAt = pass.issuedAtMs + PASS_TTL_MS;
  const left = expiresAt - now;
  const door = doorUrl(window.location.origin, pass);

  return (
    <section className="card pass-card" aria-label="Entry pass">
      {left > 0 ? (
        <>
          <QrCode text={door} label={`QR code of the entry pass for ticket ${pass.ticket}`} />
          <p className="pass-countdown" role="timer">
            Admits for <strong>{countdown(left)}</strong>
          </p>
        </>
      ) : (
        <p className="pass-expired">
          This pass expired at {clockTime(expiresAt, timeZone)}. Sign a new one to show at the door.
        </p>
      )}
      <dl className="facts">
        <dt>Ticket</dt>
        <dd>{pass.ticket}</dd>
        <dt>Holder</dt>
        <dd>
          <AccountLink id={pass.account} />
        </dd>
        <dt>Signed</dt>
        <dd>{clockTime(pass.issuedAtMs, timeZone)}</dd>
      </dl>
      {ticket.owner_id !== pass.account && (
        <p className="tx tx-notice">
          {pass.account} signed this pass but no longer holds the ticket, so it will not admit. The
          holder is {ticket.owner_id}.
        </p>
      )}
      {left > 0 ? (
        <p>
          <a href={door} target="_blank" rel="noreferrer">
            Open the door check in a new tab
          </a>
        </p>
      ) : (
        <EntryPassOffer
          ticket={ticket}
          label="Sign a new pass"
          onSigned={(signed) => replaceHash(`p=${encodePass(signed)}`)}
        />
      )}
    </section>
  );
}
