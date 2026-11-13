import { describe, expect, it } from 'vitest';
import {
  AccountingViewSchema,
  ConfigSchema,
  EventTermsSchema,
  EventViewSchema,
  OperationViewSchema,
  TicketHistorySchema,
  TicketViewSchema,
  YoctoSchema,
} from './schemas.js';

// The JSON examples of the plan's frozen interface. The plan elides two values ("9f2c…" for the
// terms hash and "…" for the storage constants); they are filled in with well-formed values here.
const eventTerms = {
  title: 'Jazz night',
  venue: 'Teatro Municipal',
  starts_at_ms: 1794700000000,
  ends_at_ms: 1794710800000,
  resolution_deadline_ms: 1794883600000,
  price: '1500000000000000000000000',
  capacity: 50,
  verifier_id: 'teatro.testnet',
  currency: null,
};

const eventView = {
  event_id: 1,
  organizer_id: 'org.testnet',
  verifier_id: 'teatro.testnet',
  verifier_accepted: true,
  terms_hash: '9f2c1d7e4b8a6f30c5d2e9a1b7f4c8e03d6a9b2f5e8c1a4d7b0e3f6a9c2d5e8f',
  title: 'Jazz night',
  venue: 'Teatro Municipal',
  starts_at_ms: 1794700000000,
  ends_at_ms: 1794710800000,
  resolution_deadline_ms: 1794883600000,
  price: '1500000000000000000000000',
  capacity: 50,
  sold: 3,
  outcome: 'Unresolved',
  outcome_reason: null,
  resolved_at_ms: null,
  resolved_by: null,
  evidence_ref: null,
  created_at_ms: 1794600000000,
  phase: 'OnSale',
  now_ms: 1794650000000,
  currency: null,
};

const ticketView = {
  token_id: '1-3',
  event_id: 1,
  serial: 3,
  owner_id: 'luis.testnet',
  principal: '1500000000000000000000000',
  status: 'Active',
  claim: 'Reserved',
  pending_operation_id: null,
  currency: null,
};

const accountingView = {
  event_id: 1,
  principal_received: '4500000000000000000000000',
  principal_reserved: '4500000000000000000000000',
  refund_pending: '0',
  refunds_settled: '0',
  organizer_available: '0',
  organizer_pending: '0',
  organizer_settled: '0',
  operating_budget: '700000000000000000000000',
  currency: null,
};

const operationView = {
  operation_id: 7,
  kind: 'Refund',
  event_id: 1,
  token_id: '1-3',
  recipient_id: 'luis.testnet',
  amount: '1500000000000000000000000',
  started_at_ms: 1794900000000,
  currency: null,
};

const ticketHistory = {
  dropped: 0,
  entries: [
    { kind: 'Purchased', account_id: 'ana.testnet', at_ms: 1794650000000 },
    { kind: 'Transferred', account_id: 'luis.testnet', at_ms: 1794660000000 },
  ],
};

const config = {
  version: '2.0.0',
  max_capacity: 100,
  max_page: 50,
  max_title_bytes: 120,
  max_venue_bytes: 120,
  max_ref_bytes: 256,
  max_memo_bytes: 256,
  max_msg_bytes: 1024,
  history_cap: 16,
  storage_per_event: '50000000000000000000000',
  storage_per_ticket: '13000000000000000000000',
  fault_injection: false,
  tokens: [{ account_id: 'tusd.testnet', symbol: 'tUSD', decimals: 6 }],
};

describe('schemas', () => {
  it('accept the JSON examples of the frozen interface', () => {
    expect(EventTermsSchema.parse(eventTerms)).toEqual(eventTerms);
    expect(EventViewSchema.parse(eventView)).toEqual(eventView);
    expect(TicketViewSchema.parse(ticketView)).toEqual(ticketView);
    expect(AccountingViewSchema.parse(accountingView)).toEqual(accountingView);
    expect(OperationViewSchema.parse(operationView)).toEqual(operationView);
    expect(TicketHistorySchema.parse(ticketHistory)).toEqual(ticketHistory);
    expect(ConfigSchema.parse(config)).toEqual(config);
  });

  it('reject a number where an amount string is expected', () => {
    expect(EventTermsSchema.safeParse({ ...eventTerms, price: 1.5e24 }).success).toBe(false);
    expect(EventViewSchema.safeParse({ ...eventView, price: 1.5e24 }).success).toBe(false);
    expect(TicketViewSchema.safeParse({ ...ticketView, principal: 1.5e24 }).success).toBe(false);
    expect(
      AccountingViewSchema.safeParse({ ...accountingView, principal_reserved: 4.5e24 }).success,
    ).toBe(false);
    expect(OperationViewSchema.safeParse({ ...operationView, amount: 1.5e24 }).success).toBe(false);
    expect(ConfigSchema.safeParse({ ...config, storage_per_ticket: 1.3e22 }).success).toBe(false);
  });

  it('accept only canonical yoctoNEAR decimals that fit in a u128', () => {
    for (const good of ['0', '1', '1500000000000000000000000', ((1n << 128n) - 1n).toString()]) {
      expect(YoctoSchema.safeParse(good).success).toBe(true);
    }
    for (const bad of ['', '1.5', '-1', '01', '1e24', ' 1', (1n << 128n).toString()]) {
      expect(YoctoSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('require optional view fields to be present, as null when empty', () => {
    const { outcome_reason: _dropped, ...withoutReason } = eventView;
    expect(EventViewSchema.safeParse(withoutReason).success).toBe(false);
    const { pending_operation_id: _alsoDropped, ...withoutPending } = ticketView;
    expect(TicketViewSchema.safeParse(withoutPending).success).toBe(false);
  });

  it('reject enum values outside the frozen lists', () => {
    expect(EventViewSchema.safeParse({ ...eventView, phase: 'Paused' }).success).toBe(false);
    expect(EventViewSchema.safeParse({ ...eventView, outcome: 'Cancelled' }).success).toBe(false);
    expect(TicketViewSchema.safeParse({ ...ticketView, claim: 'Claimable' }).success).toBe(false);
    expect(OperationViewSchema.safeParse({ ...operationView, kind: 'Transfer' }).success).toBe(
      false,
    );
  });

  it('reject malformed ids and hashes', () => {
    expect(TicketViewSchema.safeParse({ ...ticketView, token_id: '1_3' }).success).toBe(false);
    expect(TicketViewSchema.safeParse({ ...ticketView, owner_id: 'Luis.testnet' }).success).toBe(
      false,
    );
    expect(EventViewSchema.safeParse({ ...eventView, terms_hash: '9f2c…' }).success).toBe(false);
    expect(EventViewSchema.safeParse({ ...eventView, event_id: 1.5 }).success).toBe(false);
  });

  it('are strict about the terms they send and tolerant of extra view fields', () => {
    expect(EventTermsSchema.safeParse({ ...eventTerms, organizer_id: 'org.testnet' }).success).toBe(
      false,
    );
    const parsed = EventViewSchema.parse({ ...eventView, added_later: 1 });
    expect(parsed).toEqual(eventView);
  });
});
