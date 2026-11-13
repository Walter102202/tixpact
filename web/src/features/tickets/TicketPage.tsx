import {
  actions,
  CLAIM_LABELS,
  canClaimRefund,
  type EventView,
  formatDateTime,
  moneyMoved,
  type OperationView,
  type TicketHistory,
  type TicketView,
  TokenIdSchema,
  type TxResult,
  type Unit,
} from '@ticket-escrow/client';
import { useState } from 'react';
import { money, unitFor } from '../../lib/money';
import { useTx } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { Link, navigate } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { AccountLink } from '../../ui/AccountLink';
import { LoadState } from '../../ui/LoadState';
import { TxStatus } from '../../ui/TxStatus';
import { outcomeLine } from '../events/eventCopy';
import { EntryPassOffer } from '../pass/EntryPassOffer';
import { passPagePath } from '../pass/passFlow';
import { refusedByToken, SettlementRefused } from '../tokens/SettlementRefused';
import { ClaimPanel } from './ClaimPanel';
import { TransferPanel } from './TransferPanel';
import { claimWord, historyText } from './ticketCopy';

export interface TicketData {
  ticket: TicketView;
  event: EventView;
  history: TicketHistory | null;
  /** The settlement in flight for this ticket, when there is one. */
  operation: OperationView | null;
  /** The unit of the event's currency: the ticket's amounts are in it. */
  unit: Unit;
}

export interface Reread {
  reread: () => Promise<TicketData>;
  apply: (data: TicketData) => void;
}

export function TicketPage({ id }: { id: string }) {
  const { reader } = useServices();
  const tokenId = TokenIdSchema.safeParse(id).success ? id : null;

  async function read(): Promise<TicketData | null> {
    if (tokenId === null) return null;
    const ticket = await reader.getTicket(tokenId);
    if (ticket === null) return null;
    const [event, history, operation, unit] = await Promise.all([
      reader.getEvent(ticket.event_id),
      reader.getTicketHistory(tokenId),
      ticket.pending_operation_id === null
        ? Promise.resolve(null)
        : reader.getOperation(ticket.pending_operation_id),
      unitFor(reader, ticket.currency),
    ]);
    if (event === null) throw new Error(`event ${ticket.event_id} of ticket ${tokenId} is missing`);
    return { ticket, event, history, operation, unit };
  }

  const load = useLoad(`ticket:${id}`, read);
  return (
    <LoadState load={load} loadingText="Reading the ticket from the contract…">
      {(data) =>
        data === null ? (
          <section className="page">
            <h1>Not found</h1>
            <p>There is no ticket {id}.</p>
          </section>
        ) : (
          <TicketDetails
            data={data}
            reread={async () => (await read()) ?? data}
            apply={(fresh) => load.set(fresh)}
          />
        )
      }
    </LoadState>
  );
}

/** The fact that says where this ticket's price is now. */
function moneyFact(ticket: TicketView): string {
  switch (ticket.claim) {
    case 'Reserved':
    case 'Refundable':
      return 'Reserved in the contract';
    case 'RefundPending':
      return 'Being refunded';
    case 'Refunded':
      return 'Refunded';
    case 'ReleasedToOrganizer':
      // Released is not paid: the organizer may not have collected yet (R11).
      return CLAIM_LABELS.ReleasedToOrganizer;
  }
}

function TicketDetails({ data, reread, apply }: { data: TicketData } & Reread) {
  const { contractId, timeZone } = useServices();
  const { accountId } = useWallet();
  const claimTx = useTx();
  const transferTx = useTx();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { ticket, event, history, unit } = data;
  const time = (ms: number) => formatDateTime(ms, timeZone);

  const isHolder = accountId !== null && accountId === ticket.owner_id;
  const claimable = canClaimRefund(ticket, event);
  const live = claimable || ticket.claim === 'Reserved';
  const busy = claimTx.busy || transferTx.busy;
  const paid = claimTx.view.kind === 'done' && moneyMoved(claimTx.view.result);
  const transferred = transferTx.view.kind === 'done' && transferTx.view.result.ok;

  return (
    <article className="page ticket-page">
      <p className="eyebrow">
        <Link to={`/events/${event.event_id}`}>{event.title}</Link>
      </p>
      <h1>Ticket {ticket.token_id}</h1>
      <p className="lead">
        A NEAR NFT (NEP-171) on the contract <AccountLink id={contractId} />. Whoever holds it holds
        the right to its refund.
      </p>

      <div className="event-layout">
        <div>
          <dl className="facts">
            <dt>Event</dt>
            <dd>
              <Link to={`/events/${event.event_id}`}>{event.title}</Link>
            </dd>
            <dt>Holder</dt>
            <dd>
              <AccountLink id={ticket.owner_id} />
            </dd>
            <dt>Price paid</dt>
            <dd>{money(ticket.principal, unit)}</dd>
            <dt>{moneyFact(ticket)}</dt>
            <dd>{money(ticket.principal, unit)}</dd>
            <dt>Confirmation deadline</dt>
            <dd>{time(event.resolution_deadline_ms)}</dd>
          </dl>
          <section className="pass-section" aria-labelledby="pass-heading">
            <h2 id="pass-heading">Entry pass</h2>
            <EntryPassOffer ticket={ticket} onSigned={(pass) => navigate(passPagePath(pass))} />
          </section>
          <History history={history} time={time} />
        </div>

        <section className="card state-card" aria-label="Where the money is">
          <p className={`claim-word claim-${ticket.claim}`}>{claimWord(ticket, event)}</p>
          <StateText data={data} time={time} />

          {accountId !== null && !isHolder && live && (
            <p className="muted">
              Only the holder, {ticket.owner_id}, can transfer or claim this ticket.
            </p>
          )}

          <ClaimPanel
            ticket={ticket}
            unit={unit}
            claimable={claimable && !paid}
            isHolder={isHolder}
            signedIn={accountId !== null}
            busy={busy}
            tx={claimTx}
            refresh={{ before: data, read: reread, apply, key: ticketKey }}
          />
          <TxStatus
            tx={claimTx}
            failureTitle="The payment did not complete."
            failureNote="The state above was read again from the contract."
            failureDetail={callbackFailure}
            failureBody={(result, signerId) => {
              const refused = refusedByToken(result, ticket.currency);
              // A refusal by the token: plain words, not "Failed step: the transfer to tusd…".
              if (refused === null) return undefined;
              return (
                <SettlementRefused
                  failed={refused}
                  payee={signerId}
                  unit={unit}
                  // As the contract was read again: its callback gives the right back (R7).
                  restored={claimable ? 'The claim is back on the ticket.' : null}
                  retry="claim"
                />
              );
            }}
            succeeded={moneyMoved}
            success={(_, signerId) => (
              <p>
                Refunded {money(ticket.principal, unit)} to {signerId}.
              </p>
            )}
          />

          {isHolder && ticket.claim === 'Reserved' && !transferred && (
            <TransferPanel
              data={data}
              busy={busy}
              onSend={(account) => {
                setSentTo(account);
                void transferTx.run(actions.transferTicket(ticket.token_id, account), {
                  before: data,
                  read: reread,
                  apply,
                  key: ticketKey,
                });
              }}
            />
          )}
          <TxStatus
            tx={transferTx}
            failureTitle="The transfer did not complete."
            failureNote="The holder shown above was read again from the contract."
            success={() => (
              <p>
                Ticket {ticket.token_id} now belongs to {sentTo}.
              </p>
            )}
          />
        </section>
      </div>
    </article>
  );
}

/** What a claim or a transfer changes; the event view's clock (now_ms) moves on every block. */
const ticketKey = ({ ticket }: TicketData) => [
  ticket.owner_id,
  ticket.status,
  ticket.claim,
  ticket.pending_operation_id,
];

/**
 * After a failed callback the transfer ran (it is the earlier receipt, and it did not fail), but
 * the contract could not record it: the ticket stays RefundPending for good (t11).
 */
function callbackFailure(result: TxResult, signerId: string) {
  if (result.failedReceipt?.step !== 'callback') return null;
  return (
    <p>
      The transfer to {signerId} ran, but the contract could not record it. The ticket stays locked.
    </p>
  );
}

function StateText({ data, time }: { data: TicketData; time: (ms: number) => string }) {
  const { ticket, event, history, operation, unit } = data;
  const amount = money(ticket.principal, unit);

  if (canClaimRefund(ticket, event)) {
    return (
      <>
        <p className="state-headline">{outcomeLine(event)}</p>
        <p>{amount} goes back to whoever holds the ticket, when they claim it.</p>
      </>
    );
  }
  if (ticket.status === 'TransferPending') {
    return (
      <p>
        The ticket was sent to {ticket.owner_id}, a contract that has not answered yet. Until it
        does, the ticket cannot be transferred or claimed.
      </p>
    );
  }
  switch (ticket.claim) {
    case 'Reserved':
      return (
        <p>
          {amount} stays reserved in the contract until {event.verifier_id} confirms the event, or
          the deadline passes on {time(event.resolution_deadline_ms)}.
        </p>
      );
    case 'Refundable':
      return <p>{amount} is reserved for this ticket.</p>;
    case 'RefundPending': {
      const recipient = operation?.recipient_id ?? ticket.owner_id;
      const amount = money(operation?.amount ?? ticket.principal, unit);
      return (
        <>
          <p>
            A refund of {amount} to {recipient}{' '}
            {operation ? `started on ${time(operation.started_at_ms)}` : 'is open'}.
          </p>
          {/* No promise of a later confirmation: after a failed callback none comes (t11). */}
          <p className="muted">
            The contract has not recorded how it ended. Until it does, the ticket stays locked, so
            it cannot be paid twice.
          </p>
        </>
      );
    }
    case 'Refunded': {
      const settled = [...(history?.entries ?? [])]
        .reverse()
        .find((e) => e.kind === 'RefundSettled');
      return (
        <p>
          {amount} was sent back to {settled?.account_id ?? ticket.owner_id}
          {settled ? ` on ${time(settled.at_ms)}` : ''}.
        </p>
      );
    }
    case 'ReleasedToOrganizer':
      return (
        <>
          <p className="state-headline">{outcomeLine(event)}</p>
          <p>The price of this ticket was released to the organizer.</p>
        </>
      );
  }
}

function History({
  history,
  time,
}: {
  history: TicketHistory | null;
  time: (ms: number) => string;
}) {
  if (history === null || history.entries.length === 0) return null;
  const [first, ...rest] = history.entries;
  return (
    <section className="history" aria-labelledby="history-heading">
      <h2 id="history-heading">History</h2>
      <ol aria-labelledby="history-heading" className="history-list">
        {first && <HistoryItem text={historyText(first)} at={time(first.at_ms)} />}
        {history.dropped > 0 && (
          <li className="history-gap">
            {history.dropped} earlier {history.dropped === 1 ? 'entry is' : 'entries are'} not kept
            by the contract.
          </li>
        )}
        {rest.map((entry, i) => (
          // Entries have no id; their position in this read is stable.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above.
          <HistoryItem key={i} text={historyText(entry)} at={time(entry.at_ms)} />
        ))}
      </ol>
    </section>
  );
}

function HistoryItem({ text, at }: { text: string; at: string }) {
  return (
    <li>
      <span>{text}</span> <span className="muted">{at}</span>
    </li>
  );
}
