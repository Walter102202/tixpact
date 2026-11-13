import { describe, expect, it } from 'vitest';
import { createFixtureReader, FIXTURES, TX_FIXTURES } from './fixtures.js';
import {
  AccountingViewSchema,
  ClaimSchema,
  ConfigSchema,
  EventViewSchema,
  OperationViewSchema,
  PhaseSchema,
  TicketHistorySchema,
  TicketViewSchema,
} from './schemas.js';
import { TxStatusSchema } from './tx.js';

const sum = (values: string[]) => values.reduce((total, v) => total + BigInt(v), 0n);

describe('fixtures', () => {
  it('every fixture passes its schema', () => {
    expect(ConfigSchema.parse(FIXTURES.config)).toEqual(FIXTURES.config);
    for (const event of FIXTURES.events) expect(EventViewSchema.parse(event)).toEqual(event);
    for (const row of FIXTURES.accounting) expect(AccountingViewSchema.parse(row)).toEqual(row);
    for (const ticket of FIXTURES.tickets) expect(TicketViewSchema.parse(ticket)).toEqual(ticket);
    for (const op of FIXTURES.operations) expect(OperationViewSchema.parse(op)).toEqual(op);
    for (const history of Object.values(FIXTURES.histories)) {
      expect(TicketHistorySchema.parse(history)).toEqual(history);
    }
    for (const tx of Object.values(TX_FIXTURES))
      expect(TxStatusSchema.parse(tx.status)).toBeTruthy();
  });

  it('cover every phase and every claim state', () => {
    expect(new Set(FIXTURES.events.map((e) => e.phase))).toEqual(new Set(PhaseSchema.options));
    expect(new Set(FIXTURES.tickets.map((t) => t.claim))).toEqual(new Set(ClaimSchema.options));
  });

  it('keep the accounting identity and match the tickets sold', () => {
    for (const event of FIXTURES.events) {
      const row = FIXTURES.accounting.find((a) => a.event_id === event.event_id);
      expect(row, `accounting for event ${event.event_id}`).toBeDefined();
      if (!row) continue;
      const tickets = FIXTURES.tickets.filter((t) => t.event_id === event.event_id);
      expect(tickets).toHaveLength(event.sold);
      expect(BigInt(row.principal_received)).toBe(sum(tickets.map((t) => t.principal)));
      expect(BigInt(row.principal_received)).toBe(
        sum([
          row.principal_reserved,
          row.organizer_available,
          row.refund_pending,
          row.organizer_pending,
          row.refunds_settled,
          row.organizer_settled,
        ]),
      );
      for (const ticket of tickets) expect(ticket.principal).toBe(event.price);
    }
  });

  it('derive each ticket claim from its event outcome and status', () => {
    for (const ticket of FIXTURES.tickets) {
      const event = FIXTURES.events.find((e) => e.event_id === ticket.event_id);
      expect(event).toBeDefined();
      if (!event) continue;
      expect(ticket.token_id).toBe(`${ticket.event_id}-${ticket.serial}`);
      const expected =
        event.outcome === 'Unresolved'
          ? 'Reserved'
          : event.outcome === 'Completed'
            ? 'ReleasedToOrganizer'
            : ticket.status === 'Active'
              ? 'Refundable'
              : ticket.status;
      expect(ticket.claim, ticket.token_id).toBe(expected);
      const history = FIXTURES.histories[ticket.token_id];
      expect(history?.entries[0]?.kind, ticket.token_id).toBe('Purchased');
      expect(history?.entries.at(-1)?.account_id, ticket.token_id).toBe(ticket.owner_id);
    }
  });

  it('link every pending operation to its locked ticket', () => {
    for (const op of FIXTURES.operations) {
      const ticket = FIXTURES.tickets.find((t) => t.token_id === op.token_id);
      expect(ticket?.pending_operation_id).toBe(op.operation_id);
      expect(ticket?.status).toBe('RefundPending');
      expect(op.recipient_id).toBe(ticket?.owner_id);
      expect(op.amount).toBe(ticket?.principal);
    }
    const locked = FIXTURES.tickets.filter((t) => t.pending_operation_id !== null);
    expect(locked).toHaveLength(FIXTURES.operations.length);
  });

  it('show a contract balance that covers everything it holds', () => {
    const held = sum(
      FIXTURES.accounting.flatMap((a) => [
        a.principal_reserved,
        a.organizer_available,
        a.refund_pending,
        a.organizer_pending,
        a.operating_budget,
      ]),
    );
    expect(BigInt(FIXTURES.accountProof.balance) >= held).toBe(true);
    expect(FIXTURES.accountProof.accessKeys).toBe(0);
  });
});

describe('createFixtureReader', () => {
  const reader = createFixtureReader();

  it('reads events, tickets and accounting like the contract', async () => {
    expect(reader.contractId).toBe(FIXTURES.contractId);
    expect(await reader.getEvent(1)).toEqual(FIXTURES.events[0]);
    expect(await reader.getEvent(999)).toBeNull();
    expect((await reader.listEvents(0, 50)).map((e) => e.event_id)).toEqual(
      FIXTURES.events.map((e) => e.event_id),
    );
    expect((await reader.listEvents(2, 2)).map((e) => e.event_id)).toEqual([3, 4]);
    expect(await reader.getAccounting(1)).toEqual(FIXTURES.accounting[0]);
    expect(await reader.getTicket('1-3')).toMatchObject({ owner_id: 'luis.testnet' });
    expect(await reader.getTicketHistory('1-3')).toEqual(FIXTURES.histories['1-3']);
    expect(await reader.getOperation(7)).toEqual(FIXTURES.operations[0]);
    expect(await reader.getOperation(8)).toBeNull();
    expect(await reader.getConfig()).toEqual(FIXTURES.config);
    expect(await reader.getAccountProof(FIXTURES.contractId)).toEqual(FIXTURES.accountProof);
  });

  it('quotes the budget the way the fixture config implies', async () => {
    expect(await reader.quoteEventBudget(50)).toBe('700000000000000000000000');
  });

  it('pages a holder tickets and covers every claim state for luis', async () => {
    const luis = await reader.listTicketsForOwner('luis.testnet', 0, 50);
    expect(luis.every((t) => t.owner_id === 'luis.testnet')).toBe(true);
    expect(new Set(luis.map((t) => t.claim))).toEqual(new Set(ClaimSchema.options));
    const page = await reader.listTicketsForOwner('luis.testnet', 1, 2);
    expect(page).toEqual(luis.slice(1, 3));
  });

  it('returns copies, so a caller cannot change the fixtures', async () => {
    const first = await reader.getEvent(1);
    if (first) first.title = 'Changed';
    expect((await reader.getEvent(1))?.title).toBe('Jazz night');
  });
});
