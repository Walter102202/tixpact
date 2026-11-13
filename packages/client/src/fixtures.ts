import { parseNear } from './format.js';
import type { AccountProof, Reader } from './reader.js';
import {
  type AccountingView,
  AccountingViewSchema,
  type Config,
  ConfigSchema,
  type EventView,
  EventViewSchema,
  type HistoryEntry,
  type OperationView,
  OperationViewSchema,
  type TicketHistory,
  TicketHistorySchema,
  type TicketView,
  TicketViewSchema,
  YoctoSchema,
} from './schemas.js';
import type { TxStatusRpc } from './tx.js';

// Fixture mode (VITE_FIXTURES=1) and the tests run on this data. One event per phase, tickets in
// every claim state (luis.testnet holds one of each), the accounting identity holds per event, and
// everything a fixture reader returns goes through the same schemas as a live response.

export const FIXTURE_CONTRACT_ID = 'ticket-escrow.testnet';
/** The chain time every fixture event is read at. */
export const FIXTURE_NOW_MS = 1_794_650_000_000;

const ORGANIZER = 'org.testnet';
const VERIFIER = 'teatro.testnet';
const ANA = 'ana.testnet';
const LUIS = 'luis.testnet';
/** A contract Ana sends ticket 1-4 to with `nft_transfer_call`; its answer is still pending. */
const RECEIVER = 'resale-desk.testnet';
/** Holds a tUSD ticket that Luis gave her, but is not registered with tUSD (interface v2). */
const SOFIA = 'sofia.testnet';

/** The test dollar token the fixture deployment accepts: symbol tUSD, 6 decimals. */
export const FIXTURE_TOKEN_ID = 'tusd.testnet';
const TUSD = FIXTURE_TOKEN_ID;
/** A tUSD amount in its smallest unit, from whole dollars and cents: `usd(12.5)` is 12_500_000. */
const usd = (dollars: number) => (BigInt(Math.round(dollars * 100)) * 10_000n).toString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = FIXTURE_NOW_MS;

const config: Config = {
  version: '2.0.0',
  max_capacity: 100,
  max_page: 50,
  max_title_bytes: 120,
  max_venue_bytes: 120,
  max_ref_bytes: 256,
  max_memo_bytes: 256,
  max_msg_bytes: 1024,
  history_cap: 16,
  storage_per_event: parseNear('0.05'),
  storage_per_ticket: parseNear('0.013'),
  fault_injection: false,
  tokens: [{ account_id: TUSD, symbol: 'tUSD', decimals: 6 }],
};

/** Fixture budget: one event plus `capacity` tickets of storage. The live quote comes from the contract. */
function quote(capacity: number, from: Config = config): string {
  return (
    BigInt(from.storage_per_event) +
    BigInt(capacity) * BigInt(from.storage_per_ticket)
  ).toString();
}

type EventSpec = Pick<
  EventView,
  | 'event_id'
  | 'title'
  | 'venue'
  | 'starts_at_ms'
  | 'ends_at_ms'
  | 'resolution_deadline_ms'
  | 'price'
  | 'capacity'
  | 'sold'
  | 'phase'
  | 'created_at_ms'
> &
  Partial<EventView>;

function event(spec: EventSpec): EventView {
  return {
    organizer_id: ORGANIZER,
    verifier_id: VERIFIER,
    verifier_accepted: true,
    // Clients never recompute the hash; any well-formed value works for fixtures.
    terms_hash: `${'5e'.repeat(31)}${spec.event_id.toString(16).padStart(2, '0')}`,
    outcome: 'Unresolved',
    outcome_reason: null,
    resolved_at_ms: null,
    resolved_by: null,
    evidence_ref: null,
    now_ms: NOW,
    currency: null,
    ...spec,
  };
}

const events: EventView[] = [
  event({
    event_id: 1,
    title: 'Jazz night',
    venue: 'Teatro Municipal',
    starts_at_ms: 1_794_700_000_000,
    ends_at_ms: 1_794_710_800_000,
    resolution_deadline_ms: 1_794_883_600_000,
    price: parseNear('1.5'),
    capacity: 50,
    sold: 4,
    created_at_ms: 1_794_600_000_000,
    phase: 'OnSale',
  }),
  event({
    event_id: 2,
    title: 'Poetry reading',
    venue: 'Biblioteca Nacional',
    starts_at_ms: NOW + 2 * DAY,
    ends_at_ms: NOW + 2 * DAY + 2 * HOUR,
    resolution_deadline_ms: NOW + 4 * DAY + 2 * HOUR,
    price: parseNear('0.5'),
    capacity: 20,
    sold: 0,
    created_at_ms: NOW - 2 * HOUR,
    verifier_accepted: false,
    phase: 'AwaitingVerifier',
  }),
  event({
    event_id: 3,
    title: 'Chamber quartet',
    venue: 'Sala SCD',
    starts_at_ms: NOW + DAY,
    ends_at_ms: NOW + DAY + 2 * HOUR,
    resolution_deadline_ms: NOW + 3 * DAY + 2 * HOUR,
    price: parseNear('2'),
    capacity: 2,
    sold: 2,
    created_at_ms: NOW - 2 * DAY,
    phase: 'SoldOut',
  }),
  event({
    event_id: 4,
    title: 'Rock in the park',
    venue: "Parque O'Higgins",
    starts_at_ms: NOW - HOUR,
    ends_at_ms: NOW + 2 * HOUR,
    resolution_deadline_ms: NOW + 2 * DAY + 2 * HOUR,
    price: parseNear('1'),
    capacity: 30,
    sold: 1,
    created_at_ms: NOW - 3 * DAY,
    phase: 'InProgress',
  }),
  event({
    event_id: 5,
    title: 'Film premiere',
    venue: 'Cineteca Nacional',
    starts_at_ms: NOW - 5 * HOUR,
    ends_at_ms: NOW - 2 * HOUR,
    resolution_deadline_ms: NOW + DAY,
    price: parseNear('0.8'),
    capacity: 40,
    sold: 1,
    created_at_ms: NOW - 4 * DAY,
    phase: 'AwaitingAttestation',
  }),
  event({
    event_id: 6,
    title: 'Stand-up comedy',
    venue: 'Club de la Comedia',
    starts_at_ms: NOW - 3 * DAY,
    ends_at_ms: NOW - 3 * DAY + 2 * HOUR,
    resolution_deadline_ms: NOW - DAY,
    price: parseNear('1.2'),
    capacity: 25,
    sold: 1,
    created_at_ms: NOW - 6 * DAY,
    phase: 'Expirable',
  }),
  event({
    event_id: 7,
    title: 'Opera gala',
    venue: 'Teatro Municipal',
    starts_at_ms: NOW - 2 * DAY,
    ends_at_ms: NOW - 2 * DAY + 3 * HOUR,
    resolution_deadline_ms: NOW + DAY,
    price: parseNear('1.5'),
    capacity: 60,
    sold: 3,
    created_at_ms: NOW - 7 * DAY,
    outcome: 'Completed',
    outcome_reason: 'Attested',
    resolved_at_ms: NOW - 2 * DAY + 4 * HOUR,
    resolved_by: VERIFIER,
    evidence_ref: 'https://teatro.example/reports/opera-gala',
    phase: 'Completed',
  }),
  event({
    event_id: 8,
    title: 'Summer festival',
    venue: 'Espacio Riesco',
    starts_at_ms: NOW + 3 * DAY,
    ends_at_ms: NOW + 3 * DAY + 8 * HOUR,
    resolution_deadline_ms: NOW + 5 * DAY + 8 * HOUR,
    price: parseNear('1.5'),
    capacity: 10,
    sold: 4,
    created_at_ms: NOW - 5 * DAY,
    outcome: 'Refundable',
    outcome_reason: 'Cancelled',
    resolved_at_ms: NOW - 6 * HOUR,
    resolved_by: ORGANIZER,
    phase: 'Refundable',
  }),
  // Interface v2: events priced in tUSD, one per outcome, so tUSD tickets exist in every claim
  // state. Id 9 is left free: the recorded create_event transaction returns 9.
  event({
    event_id: 10,
    title: 'Indie showcase',
    venue: 'Sala Metro',
    starts_at_ms: NOW + 2 * DAY,
    ends_at_ms: NOW + 2 * DAY + 3 * HOUR,
    resolution_deadline_ms: NOW + 4 * DAY + 3 * HOUR,
    price: usd(10),
    capacity: 40,
    sold: 2,
    created_at_ms: NOW - DAY,
    phase: 'OnSale',
    currency: TUSD,
  }),
  event({
    event_id: 11,
    title: 'Harbor lights',
    venue: 'Muelle Prat',
    starts_at_ms: NOW + DAY,
    ends_at_ms: NOW + DAY + 4 * HOUR,
    resolution_deadline_ms: NOW + 3 * DAY + 4 * HOUR,
    price: usd(25),
    capacity: 30,
    sold: 4,
    created_at_ms: NOW - 4 * DAY,
    outcome: 'Refundable',
    outcome_reason: 'Cancelled',
    resolved_at_ms: NOW - 3 * HOUR,
    resolved_by: VERIFIER,
    evidence_ref: 'https://teatro.example/notices/harbor-lights',
    phase: 'Refundable',
    currency: TUSD,
  }),
  event({
    event_id: 12,
    title: 'Rooftop jazz',
    venue: 'Terraza Bellavista',
    starts_at_ms: NOW - 2 * DAY,
    ends_at_ms: NOW - 2 * DAY + 2 * HOUR,
    resolution_deadline_ms: NOW + DAY,
    price: usd(12.5),
    capacity: 20,
    sold: 2,
    created_at_ms: NOW - 6 * DAY,
    outcome: 'Completed',
    outcome_reason: 'Attested',
    resolved_at_ms: NOW - 2 * DAY + 3 * HOUR,
    resolved_by: VERIFIER,
    phase: 'Completed',
    currency: TUSD,
  }),
];

const ZERO = '0';

function accountingRow(
  eventId: number,
  capacity: number,
  amounts: Partial<Omit<AccountingView, 'event_id' | 'operating_budget'>>,
): AccountingView {
  return {
    event_id: eventId,
    principal_received: ZERO,
    principal_reserved: ZERO,
    refund_pending: ZERO,
    refunds_settled: ZERO,
    organizer_available: ZERO,
    organizer_pending: ZERO,
    organizer_settled: ZERO,
    operating_budget: quote(capacity),
    currency: null,
    ...amounts,
  };
}

const accounting: AccountingView[] = [
  accountingRow(1, 50, {
    principal_received: parseNear('6'),
    principal_reserved: parseNear('6'),
  }),
  accountingRow(2, 20, {}),
  accountingRow(3, 2, { principal_received: parseNear('4'), principal_reserved: parseNear('4') }),
  accountingRow(4, 30, { principal_received: parseNear('1'), principal_reserved: parseNear('1') }),
  accountingRow(5, 40, {
    principal_received: parseNear('0.8'),
    principal_reserved: parseNear('0.8'),
  }),
  accountingRow(6, 25, {
    principal_received: parseNear('1.2'),
    principal_reserved: parseNear('1.2'),
  }),
  accountingRow(7, 60, {
    principal_received: parseNear('4.5'),
    organizer_available: parseNear('4.5'),
  }),
  accountingRow(8, 10, {
    principal_received: parseNear('6'),
    principal_reserved: parseNear('3'),
    refund_pending: parseNear('1.5'),
    refunds_settled: parseNear('1.5'),
  }),
  accountingRow(10, 40, {
    principal_received: usd(20),
    principal_reserved: usd(20),
    currency: TUSD,
  }),
  accountingRow(11, 30, {
    principal_received: usd(100),
    principal_reserved: usd(50),
    refund_pending: usd(25),
    refunds_settled: usd(25),
    currency: TUSD,
  }),
  accountingRow(12, 20, {
    principal_received: usd(25),
    organizer_available: usd(25),
    currency: TUSD,
  }),
];

function ticket(
  eventId: number,
  serial: number,
  owner: string,
  claim: TicketView['claim'],
  status: TicketView['status'] = 'Active',
  pendingOperationId: number | null = null,
): TicketView {
  const event = events.find((e) => e.event_id === eventId);
  if (event === undefined) throw new Error(`fixture event ${eventId} is missing`);
  return {
    token_id: `${eventId}-${serial}`,
    event_id: eventId,
    serial,
    owner_id: owner,
    principal: event.price,
    status,
    claim,
    pending_operation_id: pendingOperationId,
    currency: event.currency,
  };
}

const REFUND_OPERATION_ID = 7;
/** The tUSD refund of ticket 11-2, still in flight. */
const TOKEN_REFUND_OPERATION_ID = 12;

const tickets: TicketView[] = [
  ticket(1, 1, ANA, 'Reserved'),
  ticket(1, 2, ANA, 'Reserved'),
  ticket(1, 3, LUIS, 'Reserved'),
  ticket(1, 4, RECEIVER, 'Reserved', 'TransferPending'),
  ticket(3, 1, ANA, 'Reserved'),
  ticket(3, 2, LUIS, 'Reserved'),
  ticket(4, 1, ANA, 'Reserved'),
  ticket(5, 1, LUIS, 'Reserved'),
  ticket(6, 1, LUIS, 'Reserved'),
  ticket(7, 1, LUIS, 'ReleasedToOrganizer'),
  ticket(7, 2, ANA, 'ReleasedToOrganizer'),
  ticket(7, 3, ANA, 'ReleasedToOrganizer'),
  ticket(8, 1, LUIS, 'Refundable'),
  ticket(8, 2, LUIS, 'RefundPending', 'RefundPending', REFUND_OPERATION_ID),
  ticket(8, 3, LUIS, 'Refunded', 'Refunded'),
  ticket(8, 4, ANA, 'Refundable'),
  ticket(10, 1, LUIS, 'Reserved'),
  ticket(10, 2, ANA, 'Reserved'),
  ticket(11, 1, LUIS, 'Refundable'),
  ticket(11, 2, LUIS, 'RefundPending', 'RefundPending', TOKEN_REFUND_OPERATION_ID),
  ticket(11, 3, LUIS, 'Refunded', 'Refunded'),
  ticket(11, 4, SOFIA, 'Refundable'),
  ticket(12, 1, LUIS, 'ReleasedToOrganizer'),
  ticket(12, 2, ANA, 'ReleasedToOrganizer'),
];

const entry = (kind: HistoryEntry['kind'], accountId: string, atMs: number): HistoryEntry => ({
  kind,
  account_id: accountId,
  at_ms: atMs,
});

/** Ticket 3-2 changed hands 20 times: the first entry and the latest 15 are kept, 5 dropped. */
function longHistory(): TicketHistory {
  const start = NOW - 20 * HOUR;
  const all = [entry('Purchased', LUIS, start)];
  for (let i = 1; i <= 20; i += 1) {
    all.push(entry('Transferred', i % 2 === 1 ? ANA : LUIS, start + i * 30 * MINUTE));
  }
  const cap = config.history_cap;
  return { dropped: all.length - cap, entries: [...all.slice(0, 1), ...all.slice(-(cap - 1))] };
}

const histories: Record<string, TicketHistory> = Object.fromEntries(
  tickets.map((t) => {
    const purchasedAt = (events.find((e) => e.event_id === t.event_id)?.created_at_ms ?? 0) + HOUR;
    return [t.token_id, { dropped: 0, entries: [entry('Purchased', t.owner_id, purchasedAt)] }];
  }),
);
histories['1-3'] = {
  dropped: 0,
  entries: [entry('Purchased', ANA, NOW - 8 * HOUR), entry('Transferred', LUIS, NOW - 7 * HOUR)],
};
histories['1-4'] = {
  dropped: 0,
  entries: [
    entry('Purchased', ANA, NOW - 3 * HOUR),
    entry('Transferred', RECEIVER, NOW - 2 * MINUTE),
  ],
};
histories['3-2'] = longHistory();
histories['8-2'] = {
  dropped: 0,
  entries: [entry('Purchased', LUIS, NOW - 4 * DAY), entry('RefundRequested', LUIS, NOW - HOUR)],
};
histories['8-3'] = {
  dropped: 0,
  entries: [
    entry('Purchased', LUIS, NOW - 4 * DAY),
    entry('RefundRequested', LUIS, NOW - 5 * HOUR),
    entry('RefundSettled', LUIS, NOW - 5 * HOUR + 2_000),
  ],
};

histories['11-2'] = {
  dropped: 0,
  entries: [entry('Purchased', LUIS, NOW - 3 * DAY), entry('RefundRequested', LUIS, NOW - HOUR)],
};
histories['11-3'] = {
  dropped: 0,
  entries: [
    entry('Purchased', LUIS, NOW - 3 * DAY),
    entry('RefundRequested', LUIS, NOW - 2 * HOUR),
    entry('RefundSettled', LUIS, NOW - 2 * HOUR + 2_000),
  ],
};
histories['11-4'] = {
  dropped: 0,
  entries: [entry('Purchased', LUIS, NOW - 3 * DAY), entry('Transferred', SOFIA, NOW - 2 * DAY)],
};

const operations: OperationView[] = [
  {
    operation_id: REFUND_OPERATION_ID,
    kind: 'Refund',
    event_id: 8,
    token_id: '8-2',
    recipient_id: LUIS,
    amount: parseNear('1.5'),
    started_at_ms: NOW - HOUR,
    currency: null,
  },
  {
    operation_id: TOKEN_REFUND_OPERATION_ID,
    kind: 'Refund',
    event_id: 11,
    token_id: '11-2',
    recipient_id: LUIS,
    amount: usd(25),
    started_at_ms: NOW - HOUR,
    currency: TUSD,
  },
];

/** What the contract owes in an event's own currency: everything not yet paid out. */
const owed = (a: AccountingView) =>
  BigInt(a.principal_reserved) +
  BigInt(a.organizer_available) +
  BigInt(a.refund_pending) +
  BigInt(a.organizer_pending);

export interface FixtureData {
  contractId: string;
  nowMs: number;
  config: Config;
  events: EventView[];
  accounting: AccountingView[];
  tickets: TicketView[];
  histories: Record<string, TicketHistory>;
  operations: OperationView[];
  accountProof: AccountProof;
  /**
   * Per NEP-141 token: its minimum registration deposit (yoctoNEAR) and the balance of every
   * registered account (smallest units). An account without an entry is not registered.
   */
  tokens: Record<string, { minDeposit: string; balances: Record<string, string> }>;
}

/** One coherent chain: the contract's balances follow from the events it holds. */
function fixtureData(
  chosen: Pick<FixtureData, 'events' | 'accounting' | 'tickets' | 'operations'>,
): FixtureData {
  const { accounting: rows, tickets: held } = chosen;
  /** NEAR the contract holds: what NEAR events owe, plus every event's budget (always NEAR). */
  const near = rows.reduce(
    (total, a) => total + (a.currency === null ? owed(a) : 0n) + BigInt(a.operating_budget),
    0n,
  );
  /** What the contract owes in a token, which its balance of that token covers exactly. */
  const owedIn = (token: string) =>
    rows
      .filter((a) => a.currency === token)
      .reduce((total, a) => total + owed(a), 0n)
      .toString();
  return {
    contractId: FIXTURE_CONTRACT_ID,
    nowMs: NOW,
    config,
    ...chosen,
    histories: Object.fromEntries(
      held.flatMap((t) => {
        const history = histories[t.token_id];
        return history === undefined ? [] : [[t.token_id, history]];
      }),
    ),
    accountProof: {
      // What the contract holds plus the balance it was deployed with.
      balance: (near + BigInt(parseNear('1.25'))).toString(),
      codeHash: 'E8jZ1giWcVrps8PcV75ATauu6gFRkcwjNtKp7NKmipZG',
      accessKeys: 0,
      blockHeight: 190_000_000,
    },
    // An account is registered with a token exactly when it has a balance entry. Ana has less than
    // a ticket to event 10 costs (the faucet case); Sofia holds ticket 11-4 but is not registered,
    // so its refund cannot reach her until she registers.
    tokens: {
      [TUSD]: {
        // NEP-145 minimum of a near-contract-standards token: 125 bytes at 10^19 yoctoNEAR a byte.
        minDeposit: parseNear('0.00125'),
        balances: {
          [FIXTURE_CONTRACT_ID]: owedIn(TUSD),
          [LUIS]: usd(40),
          [ANA]: usd(4),
          [ORGANIZER]: '0',
        },
      },
    },
  };
}

const inNear = <T extends { currency: string | null }>(rows: readonly T[]) =>
  rows.filter((row) => row.currency === null);

/**
 * The default fixture chain: the events priced in NEAR, in the shapes of interface v2. The
 * deployment accepts tUSD and the token ledger exists, but no event is priced in it.
 */
export const FIXTURES: FixtureData = fixtureData({
  events: inNear(events),
  accounting: inNear(accounting),
  tickets: inNear(tickets),
  operations: inNear(operations),
});

/**
 * `FIXTURES` plus three events priced in tUSD (ids 10, 11 and 12: on sale, refunds open, completed),
 * with tUSD tickets in every claim state, a tUSD refund in flight, and a holder who is not
 * registered with the token.
 */
export const FIXTURES_WITH_TOKENS: FixtureData = fixtureData({
  events,
  accounting,
  tickets,
  operations,
});

/** A `Reader` over fixture data. Every result is a fresh copy parsed by the live schemas. */
export function createFixtureReader(data: FixtureData = FIXTURES): Reader {
  const parsed = <T>(schema: { parse(raw: unknown): T }, value: unknown): T =>
    schema.parse(structuredClone(value));
  const orNull = <T>(schema: { parse(raw: unknown): T }, value: unknown): T | null =>
    value === undefined ? null : parsed(schema, value);

  return {
    contractId: data.contractId,
    getConfig: async () => parsed(ConfigSchema, data.config),
    quoteEventBudget: async (capacity) => parsed(YoctoSchema, quote(capacity, data.config)),
    getEvent: async (eventId) =>
      orNull(
        EventViewSchema,
        data.events.find((e) => e.event_id === eventId),
      ),
    listEvents: async (fromIndex, limit) =>
      data.events.slice(fromIndex, fromIndex + limit).map((e) => parsed(EventViewSchema, e)),
    getAccounting: async (eventId) =>
      orNull(
        AccountingViewSchema,
        data.accounting.find((a) => a.event_id === eventId),
      ),
    getTicket: async (tokenId) =>
      orNull(
        TicketViewSchema,
        data.tickets.find((t) => t.token_id === tokenId),
      ),
    listTicketsForOwner: async (accountId, fromIndex, limit) =>
      data.tickets
        .filter((t) => t.owner_id === accountId)
        .slice(fromIndex, fromIndex + limit)
        .map((t) => parsed(TicketViewSchema, t)),
    getTicketHistory: async (tokenId) => orNull(TicketHistorySchema, data.histories[tokenId]),
    getOperation: async (operationId) =>
      orNull(
        OperationViewSchema,
        data.operations.find((o) => o.operation_id === operationId),
      ),
    // Fixture mode only shows the contract account, so every account reads as the contract.
    getAccountProof: async () => structuredClone(data.accountProof),
    // The accounts the fixture data names exist; any other does not.
    accountExists: async (accountId) => fixtureAccounts(data).has(accountId),
    // A standard token reports 0 for an account it does not know.
    tokenBalance: async (token, accountId) =>
      parsed(YoctoSchema, tokenLedger(data, token).balances[accountId] ?? '0'),
    tokenRegistration: async (token, accountId) => {
      const ledger = tokenLedger(data, token);
      return {
        registered: Object.hasOwn(ledger.balances, accountId),
        minDeposit: parsed(YoctoSchema, ledger.minDeposit),
      };
    },
  };
}

/** The ledger of a fixture token; any other account answers like a missing contract. */
function tokenLedger(data: FixtureData, token: string): FixtureData['tokens'][string] {
  const ledger = data.tokens[token];
  if (ledger === undefined) throw new Error(`Account ${token} has no token contract.`);
  return ledger;
}

function fixtureAccounts(data: FixtureData): Set<string> {
  return new Set([
    data.contractId,
    ...data.events.flatMap((e) => [e.organizer_id, e.verifier_id]),
    ...data.tickets.map((t) => t.owner_id),
  ]);
}

// Recorded transaction statuses, in the shape `EXPERIMENTAL_tx_status` returns at `FINAL`.
// Hand-built from the RPC types in near-api-js 7.5.3 for the four settlement paths the web must
// tell apart; replace them with captures from testnet once the contract is deployed (Task I1).

export interface RecordedTx {
  hash: string;
  signerId: string;
  /** The receipt `trackTransaction` must report as failed, or null when every receipt succeeded. */
  failedReceiptId: string | null;
  status: Record<string, unknown>;
}

const BLOCK_HASH = 'fbAY4YDto3roFRvs6HB7HZVELnweFYwdvMYMUL4MhfuW';
const GAS_REFUND = { SuccessValue: '' };

function outcome(
  id: string,
  executorId: string,
  status: unknown,
  receiptIds: string[] = [],
  logs: string[] = [],
) {
  return {
    proof: [],
    block_hash: BLOCK_HASH,
    id,
    outcome: {
      logs,
      receipt_ids: receiptIds,
      gas_burnt: 2_428_000_000_000,
      tokens_burnt: '242800000000000000000',
      executor_id: executorId,
      status,
      metadata: { version: 3, gas_profile: [] },
    },
  };
}

function recordedStatus(
  hash: string,
  signerId: string,
  action: { method: string; argsBase64: string; deposit: string; gasTgas: number },
  finalStatus: unknown,
  receipts: ReturnType<typeof outcome>[],
  receiverId: string = FIXTURE_CONTRACT_ID,
): Record<string, unknown> {
  const first = receipts[0]?.id ?? '';
  return {
    final_execution_status: 'FINAL',
    status: finalStatus,
    transaction: {
      signer_id: signerId,
      public_key: 'ed25519:9rE2JTbwQx8zfpNPuBL6faJkMthYwJkrFqio7RxmvZSf',
      nonce: 190_000_000_001,
      receiver_id: receiverId,
      actions: [
        {
          FunctionCall: {
            method_name: action.method,
            args: action.argsBase64,
            gas: action.gasTgas * 1_000_000_000_000,
            deposit: action.deposit,
          },
        },
      ],
      priority_fee: 0,
      signature: 'ed25519:opLesjwoytwsms19sXY6i7aLXzyd7uubgyDcA5vtRun7',
      hash,
    },
    transaction_outcome: outcome(hash, signerId, { SuccessReceiptId: first }, [first]),
    receipts_outcome: receipts,
  };
}

const eventJson = (event: string, data: Record<string, unknown>) =>
  `EVENT_JSON:${JSON.stringify({ standard: 'ticket_escrow', version: '2.0.0', event, data: [data] })}`;

const OUT_OF_GAS = {
  Failure: {
    ActionError: {
      index: 0,
      kind: { FunctionCallError: { ExecutionError: 'Exceeded the prepaid gas.' } },
    },
  },
};

const SOLD_OUT = {
  Failure: {
    ActionError: {
      index: 0,
      kind: {
        FunctionCallError: {
          ExecutionError: 'Smart contract panicked: ERR_SOLD_OUT: event 3 has no tickets left',
        },
      },
    },
  },
};

const VANISHED = 'vanishing-holder.testnet';
const ACCOUNT_GONE = {
  Failure: {
    ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: VANISHED } } },
  },
};

const claim = (argsBase64: string) => ({
  method: 'claim_refund',
  argsBase64,
  deposit: '1',
  gasTgas: 100,
});

const refund = { operation_id: 8, recipient_id: LUIS, amount: parseNear('1.5') };

/** Base64 of a JSON value; `btoa` exists in browsers and in Node. The JSON here is ASCII. */
const base64Json = (value: unknown) => btoa(JSON.stringify(value));

/** A call that runs in one contract receipt and succeeds, plus the signer's gas refund. */
function recordedCall(spec: {
  hash: string;
  receiptId: string;
  refundId: string;
  signerId: string;
  method: string;
  args: Record<string, unknown>;
  deposit: string;
  gasTgas: number;
  /** The call's return value; omitted for a method that returns nothing. */
  value?: unknown;
  /** The account called: the escrow contract unless given (a token, in interface v2). */
  receiverId?: string;
  logs?: string[];
}): RecordedTx {
  const receiverId = spec.receiverId ?? FIXTURE_CONTRACT_ID;
  const returned = { SuccessValue: spec.value === undefined ? '' : base64Json(spec.value) };
  return {
    hash: spec.hash,
    signerId: spec.signerId,
    failedReceiptId: null,
    status: recordedStatus(
      spec.hash,
      spec.signerId,
      {
        method: spec.method,
        argsBase64: base64Json(spec.args),
        deposit: spec.deposit,
        gasTgas: spec.gasTgas,
      },
      returned,
      [
        outcome(spec.receiptId, receiverId, returned, [spec.refundId], spec.logs),
        outcome(spec.refundId, spec.signerId, GAS_REFUND),
      ],
      receiverId,
    ),
  };
}

export const TX_FIXTURES = {
  /** Luis claims ticket 8-3: transfer and callback succeed, the call returns `true`. */
  refundSettled: {
    hash: 'uNXXfQMGNaynXqRXoTaAaui1Pj9JTwFJq5Zcq9VJRjZn',
    signerId: LUIS,
    failedReceiptId: null,
    status: recordedStatus(
      'uNXXfQMGNaynXqRXoTaAaui1Pj9JTwFJq5Zcq9VJRjZn',
      LUIS,
      claim('eyJ0b2tlbl9pZCI6IjgtMyJ9'),
      { SuccessValue: 'dHJ1ZQ==' },
      [
        outcome(
          'XTuUQot8ZxhW4a2sz3fzJeWUfP4LRekUMGPJXGYYXtSC',
          FIXTURE_CONTRACT_ID,
          { SuccessReceiptId: 'zYLDkC4JE9fpWLYgVspdLqmXuiEuP1CsbsrZHGUpqooi' },
          [
            'kqf1b8Fw5woDHKQCC7grFJy9jn9PkQeQLbVZgEjn1nyF',
            'zYLDkC4JE9fpWLYgVspdLqmXuiEuP1CsbsrZHGUpqooi',
          ],
          [eventJson('refund_requested', { ...refund, token_id: '8-3' })],
        ),
        outcome('kqf1b8Fw5woDHKQCC7grFJy9jn9PkQeQLbVZgEjn1nyF', LUIS, { SuccessValue: '' }),
        outcome(
          'zYLDkC4JE9fpWLYgVspdLqmXuiEuP1CsbsrZHGUpqooi',
          FIXTURE_CONTRACT_ID,
          { SuccessValue: 'dHJ1ZQ==' },
          ['haZgbvTx3Y1BByNpdpyAccqZKmwDBUDfa4ALpyrnJLKj'],
          [eventJson('refund_settled', { ...refund, token_id: '8-3' })],
        ),
        outcome('haZgbvTx3Y1BByNpdpyAccqZKmwDBUDfa4ALpyrnJLKj', LUIS, GAS_REFUND),
      ],
    ),
  },

  /** Luis claims ticket 8-2: the transfer succeeds, the callback runs out of gas (t11). */
  refundCallbackFailed: {
    hash: 'aRLtEAoTjMsVgyVUnr7s6btVeurimX7asbshsmqs4qgd',
    signerId: LUIS,
    failedReceiptId: 'iKsG4TXV9exAj8Rqpy4uXRGznpZWbEz8LBgtoSbC6fj2',
    status: recordedStatus(
      'aRLtEAoTjMsVgyVUnr7s6btVeurimX7asbshsmqs4qgd',
      LUIS,
      claim('eyJ0b2tlbl9pZCI6IjgtMiJ9'),
      OUT_OF_GAS,
      [
        outcome(
          'PbsJnLdpWH26fG26kAfj3iCRkJTa3LZ7voYGw6hBpkFX',
          FIXTURE_CONTRACT_ID,
          { SuccessReceiptId: 'iKsG4TXV9exAj8Rqpy4uXRGznpZWbEz8LBgtoSbC6fj2' },
          [
            'wtvGtifHuxYRHX1fP7qSbSys4qk955Tnta7sJ8KVNFAx',
            'iKsG4TXV9exAj8Rqpy4uXRGznpZWbEz8LBgtoSbC6fj2',
          ],
          [eventJson('refund_requested', { ...refund, operation_id: 7, token_id: '8-2' })],
        ),
        outcome('wtvGtifHuxYRHX1fP7qSbSys4qk955Tnta7sJ8KVNFAx', LUIS, { SuccessValue: '' }),
        outcome('iKsG4TXV9exAj8Rqpy4uXRGznpZWbEz8LBgtoSbC6fj2', FIXTURE_CONTRACT_ID, OUT_OF_GAS, [
          'VVMqweCwneZbNV828bki33zpkvZtCNzK4CJMypbgjKvA',
        ]),
        outcome('VVMqweCwneZbNV828bki33zpkvZtCNzK4CJMypbgjKvA', LUIS, GAS_REFUND),
      ],
    ),
  },

  /**
   * The holder no longer exists when the refund transfer runs (t10): the transfer fails, the
   * callback restores the claim and returns `false`, so the transaction itself succeeds.
   * Ticket 9-1 is not part of the view fixtures.
   */
  refundTransferFailed: {
    hash: 's3kiLkxL4X1xo8gYSKN7KdivAFieinijYDRx39iDfDgY',
    signerId: VANISHED,
    failedReceiptId: '1iwUGhY5rYUiYz8J2EMgWbyroomDbhqrEaTaNjGjFDHM',
    status: recordedStatus(
      's3kiLkxL4X1xo8gYSKN7KdivAFieinijYDRx39iDfDgY',
      VANISHED,
      claim('eyJ0b2tlbl9pZCI6IjktMSJ9'),
      { SuccessValue: 'ZmFsc2U=' },
      [
        outcome(
          'fym18y5kc2ThYdcQHvuVtgiGsnWbDRbzMUWZr3NcUnod',
          FIXTURE_CONTRACT_ID,
          { SuccessReceiptId: 'Fp2gXNSCFr7L8kLnZgX4yjjxQdp8YwianY661CPLUG2g' },
          [
            '1iwUGhY5rYUiYz8J2EMgWbyroomDbhqrEaTaNjGjFDHM',
            'Fp2gXNSCFr7L8kLnZgX4yjjxQdp8YwianY661CPLUG2g',
          ],
          [eventJson('refund_requested', { ...refund, recipient_id: VANISHED, token_id: '9-1' })],
        ),
        outcome('1iwUGhY5rYUiYz8J2EMgWbyroomDbhqrEaTaNjGjFDHM', VANISHED, ACCOUNT_GONE, [
          'vq8or4obHzNgbSvBi6TPCrmyuhnRZzSWDbFbLqxFzF1e',
        ]),
        outcome(
          'Fp2gXNSCFr7L8kLnZgX4yjjxQdp8YwianY661CPLUG2g',
          FIXTURE_CONTRACT_ID,
          { SuccessValue: 'ZmFsc2U=' },
          [],
          [eventJson('refund_failed', { ...refund, recipient_id: VANISHED, token_id: '9-1' })],
        ),
        // The failed transfer's deposit comes back to the contract in a later receipt.
        outcome('vq8or4obHzNgbSvBi6TPCrmyuhnRZzSWDbFbLqxFzF1e', FIXTURE_CONTRACT_ID, GAS_REFUND),
      ],
    ),
  },

  /** Ana tries to buy a ticket for the sold-out event 3: the call panics, the deposit comes back. */
  buyRejected: {
    hash: 'haquUSQCEB7QD1K4i4Hjy3LKtLnRY479Pn6M3cDrYzhW',
    signerId: ANA,
    failedReceiptId: 'CKqfAcqcLZB29GZQsyTc9UvYzv3jPPNkgZTm36BHcVVt',
    status: recordedStatus(
      'haquUSQCEB7QD1K4i4Hjy3LKtLnRY479Pn6M3cDrYzhW',
      ANA,
      {
        method: 'buy_ticket',
        argsBase64: 'eyJldmVudF9pZCI6M30=',
        deposit: parseNear('2'),
        gasTgas: 50,
      },
      SOLD_OUT,
      [
        outcome('CKqfAcqcLZB29GZQsyTc9UvYzv3jPPNkgZTm36BHcVVt', FIXTURE_CONTRACT_ID, SOLD_OUT, [
          'F7zcjv2hgJPNjxf3Sqv96RyNZbu4TsPdmGqAe64WVWBw',
        ]),
        outcome('F7zcjv2hgJPNjxf3Sqv96RyNZbu4TsPdmGqAe64WVWBw', ANA, GAS_REFUND),
      ],
    ),
  },

  /** Ana buys ticket 1-4: the call returns the new ticket id. */
  buySucceeded: {
    hash: 'AXBfY5E1CdGAt4TzSk7u1wgqUzaTqPVRdvcFsxjjoPq2',
    signerId: ANA,
    failedReceiptId: null,
    status: recordedStatus(
      'AXBfY5E1CdGAt4TzSk7u1wgqUzaTqPVRdvcFsxjjoPq2',
      ANA,
      {
        method: 'buy_ticket',
        argsBase64: 'eyJldmVudF9pZCI6MX0=',
        deposit: parseNear('1.5'),
        gasTgas: 50,
      },
      { SuccessValue: 'IjEtNCI=' },
      [
        outcome(
          '9rE2JTbwQx8zfpNPuBL6faJkMthYwJkrFqio7RxmvZSf',
          FIXTURE_CONTRACT_ID,
          { SuccessValue: 'IjEtNCI=' },
          ['opLesjwoytwsms19sXY6i7aLXzyd7uubgyDcA5vtRun7'],
          [
            `EVENT_JSON:${JSON.stringify({ standard: 'nep171', version: '1.2.0', event: 'nft_mint', data: [{ owner_id: ANA, token_ids: ['1-4'] }] })}`,
            eventJson('ticket_purchased', {
              event_id: 1,
              token_id: '1-4',
              buyer_id: ANA,
              price: parseNear('1.5'),
            }),
          ],
        ),
        outcome('opLesjwoytwsms19sXY6i7aLXzyd7uubgyDcA5vtRun7', ANA, GAS_REFUND),
      ],
    ),
  },

  /** Luis transfers ticket 1-3 to Ana with `nft_transfer`, which returns nothing. */
  transferSucceeded: {
    hash: 'CUoB1t9JXg4Zkpvp1YZbVKvRw8GHwtXxNaNkcAeXu4fS',
    signerId: LUIS,
    failedReceiptId: null,
    status: recordedStatus(
      'CUoB1t9JXg4Zkpvp1YZbVKvRw8GHwtXxNaNkcAeXu4fS',
      LUIS,
      {
        method: 'nft_transfer',
        argsBase64:
          'eyJyZWNlaXZlcl9pZCI6ImFuYS50ZXN0bmV0IiwidG9rZW5faWQiOiIxLTMiLCJhcHByb3ZhbF9pZCI6bnVsbCwibWVtbyI6bnVsbH0=',
        deposit: '1',
        gasTgas: 30,
      },
      { SuccessValue: '' },
      [
        outcome(
          'B6m3vrbcvHPp3nT1j8jZr4dKyu4wD3E9cpXiZ9mJgBDh',
          FIXTURE_CONTRACT_ID,
          { SuccessValue: '' },
          ['7zCNZ8ohT3iFUNbJpWJjkN2s8JVtYy6NU8hT2zTGGsXc'],
          [
            `EVENT_JSON:${JSON.stringify({ standard: 'nep171', version: '1.2.0', event: 'nft_transfer', data: [{ old_owner_id: LUIS, new_owner_id: ANA, token_ids: ['1-3'] }] })}`,
          ],
        ),
        outcome('7zCNZ8ohT3iFUNbJpWJjkN2s8JVtYy6NU8hT2zTGGsXc', LUIS, GAS_REFUND),
      ],
    ),
  },

  /** org.testnet creates event 9 with a 0.7 NEAR storage budget; the call returns the new id. */
  eventCreated: recordedCall({
    hash: 'cBAMw4BEwDzTqfPABGwF2zBwL2DFR16QNsttNd4aNtGV',
    receiptId: 'Fu5YrRrGeYWT81t6uxym74CGFishgL5FQqLkg6hJLJqG',
    refundId: 'jzjuty9bVoeoCFMGRNthr9CBwGagBfo9GZ7zwJcFeYSH',
    signerId: ORGANIZER,
    method: 'create_event',
    args: {
      terms: {
        title: 'Tango evening',
        venue: 'Centro Cultural GAM',
        starts_at_ms: NOW + 5 * DAY,
        ends_at_ms: NOW + 5 * DAY + 3 * HOUR,
        resolution_deadline_ms: NOW + 7 * DAY + 3 * HOUR,
        price: parseNear('1.5'),
        capacity: 50,
        verifier_id: VERIFIER,
      },
    },
    deposit: parseNear('0.7'),
    gasTgas: 30,
    value: 9,
  }),

  /** teatro.testnet accepts the terms of event 2. */
  verificationAccepted: recordedCall({
    hash: '4dWDv3YEZGDybMDVTUyYUuyMqfs7fz3eozv4QgqFDudS',
    receiptId: 'rfY2Reo3Pp92V9pnea42n58tJSkd8qfCMDngtf2VV7mt',
    refundId: 's1My3Hbv45ezSJPg6n8YLfzQsVD5jKyqUJAg9M2vnMZ5',
    signerId: VERIFIER,
    method: 'accept_verification',
    args: { event_id: 2, terms_hash: `${'5e'.repeat(31)}02` },
    deposit: '1',
    gasTgas: 30,
  }),

  /** teatro.testnet confirms that event 5 took place. */
  eventAttested: recordedCall({
    hash: '6fcnGL13viFr8K839J56MpYq9eY2Do3UGz9yh7gt929o',
    receiptId: 'oLg8osCkciFxQrrTMe5JxurAacLnTPciNxBavhMxYDJn',
    refundId: 'ZuX4dwogCMBHHmMH5fZBHj44Y6Y6LUjaTEyKZCUt8d4j',
    signerId: VERIFIER,
    method: 'attest_completed',
    args: { event_id: 5, evidence_ref: null },
    deposit: '1',
    gasTgas: 30,
  }),

  /** teatro.testnet cancels event 1. */
  eventCancelled: recordedCall({
    hash: 'SUYUyaGw7u81yCyPe1CiaiPAd4CknQ77jvJRtHEhDZPx',
    receiptId: 'uZBxZWVHi4CAjsFJgnhpjeD7ZW9b2kTfAdjS5S7VpQRb',
    refundId: 'YPSN2BsH3cphKk1JkAQUJhMEw9vKYF1Y2WT3zwYDtpxX',
    signerId: VERIFIER,
    method: 'cancel_event',
    args: { event_id: 1, reason_ref: null },
    deposit: '1',
    gasTgas: 30,
  }),

  /** org.testnet collects the 4.5 NEAR of event 7: transfer and callback succeed, returns `true`. */
  payoutSettled: {
    hash: 'oCy3kGVMBjhP1iR2PHDCAHbC63Y87CUFZS4wZ9NRg15W',
    signerId: ORGANIZER,
    failedReceiptId: null,
    status: recordedStatus(
      'oCy3kGVMBjhP1iR2PHDCAHbC63Y87CUFZS4wZ9NRg15W',
      ORGANIZER,
      { method: 'claim_payout', argsBase64: btoa('{"event_id":7}'), deposit: '1', gasTgas: 100 },
      { SuccessValue: 'dHJ1ZQ==' },
      [
        outcome(
          'Qrp1D37e3eJoM8aFgtRjzquiNWUK7ozuD7NWbT5VU9CB',
          FIXTURE_CONTRACT_ID,
          { SuccessReceiptId: 'mFKZN7J5w4zHhwoKoRkFqTAnXAfBEVniHNfaJPo3rLBa' },
          [
            'J8PCKHbKaU24uaTB7PoYM5K5MTqDg8FJcLBmTXAerBnb',
            'mFKZN7J5w4zHhwoKoRkFqTAnXAfBEVniHNfaJPo3rLBa',
          ],
          [
            eventJson('payout_requested', {
              operation_id: 9,
              event_id: 7,
              amount: parseNear('4.5'),
            }),
          ],
        ),
        outcome('J8PCKHbKaU24uaTB7PoYM5K5MTqDg8FJcLBmTXAerBnb', ORGANIZER, { SuccessValue: '' }),
        outcome(
          'mFKZN7J5w4zHhwoKoRkFqTAnXAfBEVniHNfaJPo3rLBa',
          FIXTURE_CONTRACT_ID,
          { SuccessValue: 'dHJ1ZQ==' },
          ['3JfEfkgjYEmHEtctmpVrNg6FnGNtdkTsGh8JuPEoLC2B'],
          [eventJson('payout_settled', { operation_id: 9, event_id: 7, amount: parseNear('4.5') })],
        ),
        outcome('3JfEfkgjYEmHEtctmpVrNg6FnGNtdkTsGh8JuPEoLC2B', ORGANIZER, GAS_REFUND),
      ],
    ),
  },

  /**
   * org.testnet collects event 7, but deletes its account before the transfer runs: the transfer
   * fails, the callback makes the 4.5 NEAR available again and returns `false`.
   */
  payoutTransferFailed: {
    hash: 'xXHb577AHA1YXyzsEKTHCwpTRBB7HG6V42TuhwzAzXY',
    signerId: ORGANIZER,
    failedReceiptId: 'C2NdT9VcAzT1XB1f7sUqbwuUMi5A9Z2CtGKctCjwLynb',
    status: recordedStatus(
      'xXHb577AHA1YXyzsEKTHCwpTRBB7HG6V42TuhwzAzXY',
      ORGANIZER,
      { method: 'claim_payout', argsBase64: btoa('{"event_id":7}'), deposit: '1', gasTgas: 100 },
      { SuccessValue: 'ZmFsc2U=' },
      [
        outcome(
          'B7aQhYmvifQQYmDD5uDCqFBWBivcKDiXVnKzTqDbaryo',
          FIXTURE_CONTRACT_ID,
          { SuccessReceiptId: 'EM8ZAxeZcCztBUeVEFDfZKAo92mmreEef76Wv4thnzpF' },
          [
            'C2NdT9VcAzT1XB1f7sUqbwuUMi5A9Z2CtGKctCjwLynb',
            'EM8ZAxeZcCztBUeVEFDfZKAo92mmreEef76Wv4thnzpF',
          ],
          [
            eventJson('payout_requested', {
              operation_id: 10,
              event_id: 7,
              amount: parseNear('4.5'),
            }),
          ],
        ),
        outcome(
          'C2NdT9VcAzT1XB1f7sUqbwuUMi5A9Z2CtGKctCjwLynb',
          ORGANIZER,
          {
            Failure: {
              ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: ORGANIZER } } },
            },
          },
          ['H7F4QSXhZ2gRQMPkGgpC79xtkr3kDMeGpCDvy6pbhmXm'],
        ),
        outcome(
          'EM8ZAxeZcCztBUeVEFDfZKAo92mmreEef76Wv4thnzpF',
          FIXTURE_CONTRACT_ID,
          { SuccessValue: 'ZmFsc2U=' },
          [],
          [eventJson('payout_failed', { operation_id: 10, event_id: 7, amount: parseNear('4.5') })],
        ),
        // The failed transfer's deposit comes back to the contract in a later receipt.
        outcome('H7F4QSXhZ2gRQMPkGgpC79xtkr3kDMeGpCDvy6pbhmXm', FIXTURE_CONTRACT_ID, GAS_REFUND),
      ],
    ),
  },

  /**
   * org.testnet collects event 7: the transfer succeeds, the callback runs out of gas, so the
   * contract still shows the payout in flight.
   */
  payoutCallbackFailed: {
    hash: 'YNfotakvYX3WXn4BxwhsdKZ4SDuscupkraV53it4dfQ',
    signerId: ORGANIZER,
    failedReceiptId: 'GBXQMzsDkK29gssNKbB9DF3tJYDCvFgE7NhDKgrGqG19',
    status: recordedStatus(
      'YNfotakvYX3WXn4BxwhsdKZ4SDuscupkraV53it4dfQ',
      ORGANIZER,
      { method: 'claim_payout', argsBase64: btoa('{"event_id":7}'), deposit: '1', gasTgas: 100 },
      OUT_OF_GAS,
      [
        outcome(
          '7nZqrEh6k7V2pbVFyoEb1EeifT5Eiz4aZx1N85E7gDE2',
          FIXTURE_CONTRACT_ID,
          { SuccessReceiptId: 'GBXQMzsDkK29gssNKbB9DF3tJYDCvFgE7NhDKgrGqG19' },
          [
            '2LbxrV1Y2WJWANY1eRxexAMHYnQ1vWAULVCp4NQG35VW',
            'GBXQMzsDkK29gssNKbB9DF3tJYDCvFgE7NhDKgrGqG19',
          ],
          [
            eventJson('payout_requested', {
              operation_id: 11,
              event_id: 7,
              amount: parseNear('4.5'),
            }),
          ],
        ),
        outcome('2LbxrV1Y2WJWANY1eRxexAMHYnQ1vWAULVCp4NQG35VW', ORGANIZER, { SuccessValue: '' }),
        outcome('GBXQMzsDkK29gssNKbB9DF3tJYDCvFgE7NhDKgrGqG19', FIXTURE_CONTRACT_ID, OUT_OF_GAS, [
          '54QJTq5wiaMHUZJqpDe2DU2z9yTRyghX2k2FrWUNLqWf',
        ]),
        outcome('54QJTq5wiaMHUZJqpDe2DU2z9yTRyghX2k2FrWUNLqWf', ORGANIZER, GAS_REFUND),
      ],
    ),
  },

  /**
   * Sofia registers with tUSD (`storage_deposit`, registration only, exactly the minimum), so a
   * refund can reach her. The token returns her storage balance.
   */
  tokenRegistered: recordedCall({
    hash: 'v5tmsYbVCWb8u41W7jqtxdqfyAqeJFzGXAXWFemWgUx2',
    receiptId: 'ekAYRWGUfwBjXSwKMvqZYZqU5waivhjo8Wie5jTiv65h',
    refundId: '4hkPKqzvHhV2gbk2wiev5fGLbFHL2gtSPGYFS5caCzWb',
    signerId: SOFIA,
    receiverId: TUSD,
    method: 'storage_deposit',
    args: { account_id: SOFIA, registration_only: true },
    deposit: parseNear('0.00125'),
    gasTgas: 30,
    value: { total: parseNear('0.00125'), available: '0' },
  }),

  /** Ana asks the test token for its faucet: 100 tUSD minted to her, returned as the amount. */
  faucetMinted: recordedCall({
    hash: 'tFpFJ46EVTE5UBdJWycCkax4wohE2QK6mL6ZFAVga7qi',
    receiptId: 'VmDvR8L6idM5KJoVpXC5hLhq1PFQGS4rUPwTqtftdyds',
    refundId: 'MvVQvpwznoXKhpgAZjMB5mQzaTYsqssXq9movcfXpKyp',
    signerId: ANA,
    receiverId: TUSD,
    method: 'faucet',
    args: {},
    deposit: '0',
    gasTgas: 30,
    value: usd(100),
    logs: [
      `EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_mint', data: [{ owner_id: ANA, amount: usd(100), memo: 'faucet' }] })}`,
    ],
  }),

  /** Luis buys ticket 10-3 with 10 tUSD (`ft_transfer_call`): the contract keeps it all. */
  tokenBuySucceeded: tokenPurchase({
    hash: 'Vjhz21xfQF6x7xBNzbqLEuA1YJJf18sGrMP6UN6XgFXs',
    ids: [
      'woSkAgKPmqr6CnqPdP2nyW9nPryQ1qkXwhKryetXJvqG',
      '3sPshYEfbRM9XpvMiQhgmAaQ7sWUjRzWoT5GRxPRhfPY',
      's39zi94MBVzRMgPXqVykVmNfYoMaS8zUXRx4NCLPFtXW',
      'ZLmwxwJw6yRA4i8gpwt4o1BciecEH5qc5nGgF1nSDuSi',
    ],
    buyer: LUIS,
    eventId: 10,
    amount: usd(10),
    onTransfer: {
      status: { SuccessValue: base64Json('0') },
      logs: [
        `EVENT_JSON:${JSON.stringify({ standard: 'nep171', version: '1.2.0', event: 'nft_mint', data: [{ owner_id: LUIS, token_ids: ['10-3'] }] })}`,
        // The fields contract v2 logs (contract/src/log.rs on track/c2, 8d3e4eb).
        eventJson('ticket_purchased', {
          event_id: 10,
          token_id: '10-3',
          owner_id: LUIS,
          price: usd(10),
          currency: TUSD,
        }),
      ],
    },
  }),

  /**
   * Ana tries to buy a ticket to event 12 after it started: `ft_on_transfer` panics, the token
   * gives the 12.5 tUSD back in its resolver, and the transaction itself succeeds.
   */
  tokenBuyRejected: tokenPurchase({
    hash: 'Ezf6RTqKhHuVm438VrJNvboHeg9n6EDsYaAHU9gL4NbC',
    ids: [
      '8jbEBE4mgmjYYHsEQufVspcKzpJuHeEBFeHSGwbMhqG9',
      'UZucNeWXANKL6b5BkcvD42AS6aU1xLqJLBQsTu4LUckG',
      '3NwTP5f4Rjtz1NMTs81gXCjAdoCFqA7XRKyx87HpSabu',
      '1VdouCCNStLcoAW4Zwp92GDw1B1HdjY1VELyXbvCDeVB',
    ],
    buyer: ANA,
    eventId: 12,
    amount: usd(12.5),
    onTransfer: {
      status: panicked('ERR_TOO_LATE: tickets to event 12 were sold until it started'),
      logs: [],
    },
  }),

  /**
   * Sofia tries to buy a ticket to event 10 without being registered with tUSD: the token itself
   * rejects the call, so nothing reaches the contract and no money moves.
   */
  tokenBuyUnfunded: {
    hash: 'xQFx73ztTGc1khciMGb3GwhNZoKrN9d1ShGmbEG7Ntcz',
    signerId: SOFIA,
    failedReceiptId: 'vVZCSKyRiGkza9iaCrUhn4pGCR2GKvNPSJvpkbfb43ay',
    status: recordedStatus(
      'xQFx73ztTGc1khciMGb3GwhNZoKrN9d1ShGmbEG7Ntcz',
      SOFIA,
      tokenPurchaseAction(10, usd(10)),
      panicked(`The account ${SOFIA} is not registered`),
      [
        outcome(
          'vVZCSKyRiGkza9iaCrUhn4pGCR2GKvNPSJvpkbfb43ay',
          TUSD,
          panicked(`The account ${SOFIA} is not registered`),
          ['yc2NUzHpRGToTUJF2TXKquxNzqKhWcJ3Fh1GXYc5BAD5'],
        ),
        outcome('yc2NUzHpRGToTUJF2TXKquxNzqKhWcJ3Fh1GXYc5BAD5', SOFIA, GAS_REFUND),
      ],
      TUSD,
    ),
  },
} satisfies Record<string, RecordedTx>;

/** A receipt status for a contract panic with this message. */
function panicked(message: string) {
  return {
    Failure: {
      ActionError: {
        index: 0,
        kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${message}` } },
      },
    },
  };
}

/** The `ft_transfer_call` action of a token purchase, as `actions.buyTicketWithToken` builds it. */
function tokenPurchaseAction(eventId: number, amount: string) {
  return {
    method: 'ft_transfer_call',
    argsBase64: base64Json({
      receiver_id: FIXTURE_CONTRACT_ID,
      amount,
      memo: null,
      msg: JSON.stringify({ event_id: eventId }),
    }),
    deposit: '1',
    gasTgas: 100,
  };
}

/**
 * A purchase in tUSD as a near-contract-standards token runs it: `ft_transfer_call` on the token
 * moves the amount to the contract and calls `ft_on_transfer` there, then `ft_resolve_transfer`
 * on the token returns whatever the contract did not keep. The transaction's value is the
 * resolver's: the amount kept, `"0"` when the contract rejected the purchase.
 */
function tokenPurchase(spec: {
  hash: string;
  /** Receipt ids: transfer call, `ft_on_transfer`, resolver, gas refund. */
  ids: [string, string, string, string];
  buyer: string;
  eventId: number;
  amount: string;
  onTransfer: { status: unknown; logs: string[] };
}): RecordedTx {
  const [callId, onTransferId, resolveId, refundId] = spec.ids;
  const kept = 'SuccessValue' in (spec.onTransfer.status as object);
  const moved = (from: string, to: string, memo?: string) =>
    `EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: from, new_owner_id: to, amount: spec.amount, ...(memo === undefined ? {} : { memo }) }] })}`;
  const resolved = { SuccessValue: base64Json(kept ? spec.amount : '0') };
  return {
    hash: spec.hash,
    signerId: spec.buyer,
    failedReceiptId: kept ? null : onTransferId,
    status: recordedStatus(
      spec.hash,
      spec.buyer,
      tokenPurchaseAction(spec.eventId, spec.amount),
      resolved,
      [
        outcome(
          callId,
          TUSD,
          { SuccessReceiptId: resolveId },
          [onTransferId, resolveId],
          [moved(spec.buyer, FIXTURE_CONTRACT_ID)],
        ),
        outcome(
          onTransferId,
          FIXTURE_CONTRACT_ID,
          spec.onTransfer.status,
          [],
          spec.onTransfer.logs,
        ),
        outcome(
          resolveId,
          TUSD,
          resolved,
          [refundId],
          kept ? [] : [moved(FIXTURE_CONTRACT_ID, spec.buyer, 'refund')],
        ),
        outcome(refundId, spec.buyer, GAS_REFUND),
      ],
      TUSD,
    ),
  };
}

/** A `TxStatusRpc` that answers from recorded statuses, whatever stage is asked for. */
export function createFixtureRpc(recorded: Record<string, RecordedTx> = TX_FIXTURES): TxStatusRpc {
  return {
    async viewTransactionStatusWithReceipts({ txHash }) {
      const tx = Object.values(recorded).find((r) => r.hash === txHash);
      if (!tx) throw new Error(`Transaction ${txHash} doesn't exist`);
      return structuredClone(tx.status);
    },
  };
}
