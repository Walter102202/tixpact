import { describe, expect, it } from 'vitest';
import {
  createFixtureReader,
  FIXTURE_TOKEN_ID,
  FIXTURES,
  FIXTURES_WITH_TOKENS,
  TX_FIXTURES,
} from './fixtures.js';
import { unitOf } from './format.js';
import {
  AccountingViewSchema,
  ClaimSchema,
  ConfigSchema,
  EventViewSchema,
  OperationViewSchema,
  PhaseSchema,
  TicketHistorySchema,
  TicketStatusSchema,
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
    expect(new Set(FIXTURES.tickets.map((t) => t.status))).toEqual(
      new Set(TicketStatusSchema.options),
    );
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

describe('fixtures with tokens (interface v2)', () => {
  const data = FIXTURES_WITH_TOKENS;
  const token = FIXTURE_TOKEN_ID;
  const inToken = <T extends { currency: string | null }>(rows: T[]) =>
    rows.filter((r) => r.currency === token);

  it('pass their schemas, and keep the NEAR set free of token events', () => {
    for (const event of data.events) expect(EventViewSchema.parse(event)).toEqual(event);
    for (const row of data.accounting) expect(AccountingViewSchema.parse(row)).toEqual(row);
    for (const ticket of data.tickets) expect(TicketViewSchema.parse(ticket)).toEqual(ticket);
    for (const op of data.operations) expect(OperationViewSchema.parse(op)).toEqual(op);
    expect(FIXTURES.events.every((e) => e.currency === null)).toBe(true);
    expect(data.events.filter((e) => e.currency === null)).toEqual(FIXTURES.events);
    expect(data.config.tokens).toEqual([{ account_id: token, symbol: 'tUSD', decimals: 6 }]);
    expect(data.events.map((e) => e.event_id)).not.toContain(9);
  });

  it('price events in tUSD with tickets in every claim state and an on-sale event', () => {
    const events = inToken(data.events);
    expect(events.map((e) => e.phase)).toEqual(['OnSale', 'Refundable', 'Completed']);
    expect(new Set(inToken(data.tickets).map((t) => t.claim))).toEqual(
      new Set(ClaimSchema.options),
    );
    for (const event of events) expect(unitOf(data.config, event.currency).symbol).toBe('tUSD');
  });

  it('give every ticket, row and operation the currency of its event', () => {
    for (const ticket of data.tickets) {
      const event = data.events.find((e) => e.event_id === ticket.event_id);
      expect(ticket.currency, ticket.token_id).toBe(event?.currency);
      expect(ticket.principal, ticket.token_id).toBe(event?.price);
    }
    for (const row of data.accounting) {
      expect(row.currency).toBe(data.events.find((e) => e.event_id === row.event_id)?.currency);
    }
    for (const op of data.operations) {
      const ticket = data.tickets.find((t) => t.token_id === op.token_id);
      expect(op.currency).toBe(ticket?.currency);
      expect(op.amount).toBe(ticket?.principal);
      expect(ticket?.pending_operation_id).toBe(op.operation_id);
    }
  });

  it('keep the accounting identity per event, in the event currency', () => {
    for (const event of data.events) {
      const row = data.accounting.find((a) => a.event_id === event.event_id);
      const tickets = data.tickets.filter((t) => t.event_id === event.event_id);
      expect(tickets).toHaveLength(event.sold);
      expect(BigInt(row?.principal_received ?? -1)).toBe(sum(tickets.map((t) => t.principal)));
      expect(BigInt(row?.principal_received ?? -1)).toBe(
        sum(
          row
            ? [
                row.principal_reserved,
                row.organizer_available,
                row.refund_pending,
                row.organizer_pending,
                row.refunds_settled,
                row.organizer_settled,
              ]
            : [],
        ),
      );
    }
  });

  it('hold in tUSD exactly what tUSD events owe, and in NEAR what NEAR events owe and every budget', () => {
    const owed = (rows: typeof data.accounting) =>
      sum(
        rows.flatMap((a) => [
          a.principal_reserved,
          a.organizer_available,
          a.refund_pending,
          a.organizer_pending,
        ]),
      );
    expect(BigInt(data.tokens[token]?.balances[data.contractId] ?? -1)).toBe(
      owed(inToken(data.accounting)),
    );
    const nearHeld =
      owed(data.accounting.filter((a) => a.currency === null)) +
      sum(data.accounting.map((a) => a.operating_budget));
    expect(BigInt(data.accountProof.balance) >= nearHeld).toBe(true);
    expect(FIXTURES.tokens[token]?.balances[FIXTURES.contractId]).toBe('0');
  });

  it('name a holder of a claimable tUSD ticket who is not registered with tUSD', async () => {
    const reader = createFixtureReader(data);
    const sofia = await reader.listTicketsForOwner('sofia.testnet', 0, 50);
    expect(sofia.map((t) => [t.token_id, t.claim])).toEqual([['11-4', 'Refundable']]);
    expect((await reader.tokenRegistration(token, 'sofia.testnet')).registered).toBe(false);
    expect(await reader.accountExists?.('sofia.testnet')).toBe(true);
    // Ana cannot pay a ticket to event 10 from her balance: the faucet case.
    const price = BigInt((await reader.getEvent(10))?.price ?? 0);
    expect(BigInt(await reader.tokenBalance(token, 'ana.testnet')) < price).toBe(true);
  });

  it('record token purchases a real token would let reach the contract, and one it would refuse', () => {
    const ledger = data.tokens[token]?.balances ?? {};
    const sent = (tx: { status: Record<string, unknown> }) => {
      const t = tx.status.transaction as {
        signer_id: string;
        actions: Array<{ FunctionCall: { args: string } }>;
      };
      const args = JSON.parse(atob(t.actions[0]?.FunctionCall.args ?? '')) as { amount: string };
      return { signer: t.signer_id, amount: BigInt(args.amount) };
    };
    for (const tx of [TX_FIXTURES.tokenBuySucceeded, TX_FIXTURES.tokenBuyRejected]) {
      const { signer, amount } = sent(tx);
      expect(BigInt(ledger[signer] ?? -1) >= amount, `${signer} can pay ${amount}`).toBe(true);
    }
    expect(Object.hasOwn(ledger, sent(TX_FIXTURES.tokenBuyUnfunded).signer)).toBe(false);
  });

  it('read the tUSD refund in flight and the ticket history of the gift to Sofia', async () => {
    const reader = createFixtureReader(data);
    expect(await reader.getOperation(12)).toMatchObject({ token_id: '11-2', currency: token });
    expect((await reader.getTicketHistory('11-4'))?.entries.map((e) => e.kind)).toEqual([
      'Purchased',
      'Transferred',
    ]);
    expect(await createFixtureReader().getTicketHistory('11-4')).toBeNull();
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
