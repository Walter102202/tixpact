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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = FIXTURE_NOW_MS;

const config: Config = {
  version: '1.0.0',
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
];

function ticket(
  eventId: number,
  serial: number,
  owner: string,
  claim: TicketView['claim'],
  status: TicketView['status'] = 'Active',
  pendingOperationId: number | null = null,
): TicketView {
  const price = events.find((e) => e.event_id === eventId)?.price;
  if (price === undefined) throw new Error(`fixture event ${eventId} is missing`);
  return {
    token_id: `${eventId}-${serial}`,
    event_id: eventId,
    serial,
    owner_id: owner,
    principal: price,
    status,
    claim,
    pending_operation_id: pendingOperationId,
  };
}

const REFUND_OPERATION_ID = 7;

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

const operations: OperationView[] = [
  {
    operation_id: REFUND_OPERATION_ID,
    kind: 'Refund',
    event_id: 8,
    token_id: '8-2',
    recipient_id: LUIS,
    amount: parseNear('1.5'),
    started_at_ms: NOW - HOUR,
  },
];

const held = accounting.reduce(
  (total, a) =>
    total +
    BigInt(a.principal_reserved) +
    BigInt(a.organizer_available) +
    BigInt(a.refund_pending) +
    BigInt(a.organizer_pending) +
    BigInt(a.operating_budget),
  0n,
);

const accountProof: AccountProof = {
  // What the contract holds plus the balance it was deployed with.
  balance: (held + BigInt(parseNear('1.25'))).toString(),
  codeHash: 'E8jZ1giWcVrps8PcV75ATauu6gFRkcwjNtKp7NKmipZG',
  accessKeys: 0,
  blockHeight: 190_000_000,
};

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
}

export const FIXTURES: FixtureData = {
  contractId: FIXTURE_CONTRACT_ID,
  nowMs: NOW,
  config,
  events,
  accounting,
  tickets,
  histories,
  operations,
  accountProof,
};

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
  };
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
): Record<string, unknown> {
  const first = receipts[0]?.id ?? '';
  return {
    final_execution_status: 'FINAL',
    status: finalStatus,
    transaction: {
      signer_id: signerId,
      public_key: 'ed25519:9rE2JTbwQx8zfpNPuBL6faJkMthYwJkrFqio7RxmvZSf',
      nonce: 190_000_000_001,
      receiver_id: FIXTURE_CONTRACT_ID,
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
  `EVENT_JSON:${JSON.stringify({ standard: 'ticket_escrow', version: '1.0.0', event, data: [data] })}`;

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
} satisfies Record<string, RecordedTx>;

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
