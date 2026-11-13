import { z } from 'zod';

// Zod schemas for every JSON shape of the frozen contract interface (plan, "Frozen interface (v1)").
// Amounts are decimal strings of yoctoNEAR, times and ids are JSON numbers, optional fields are
// always present and null when empty. Views tolerate extra fields (they are dropped); the terms we
// send are strict.

const U128_MAX = (1n << 128n) - 1n;
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/;

/** A yoctoNEAR amount: a canonical decimal string (no sign, no leading zeros) that fits a u128. */
export const YoctoSchema = z
  .string()
  // One refinement, pattern first: Zod 4 runs later checks even after a failed one, and BigInt
  // throws on anything that is not an integer.
  .refine(
    (value) => CANONICAL_DECIMAL.test(value) && BigInt(value) <= U128_MAX,
    'Expected a decimal string of yoctoNEAR that fits in a u128',
  );

/** A NEAR account id (named or implicit), as the protocol validates it. */
export const AccountIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, 'Expected a NEAR account id');

/** Unix milliseconds. */
export const TimestampMsSchema = z.int().min(0);

/** An event id (u32, starting at 1). */
export const EventIdSchema = z.uint32().min(1);

/** A ticket id: `"<event_id>-<serial>"`, both from 1. */
export const TokenIdSchema = z
  .string()
  .regex(/^[1-9][0-9]*-[1-9][0-9]*$/, 'Expected a ticket id like "3-17"');

/** Lowercase hex SHA-256 of the event terms, computed by the contract. */
export const TermsHashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lowercase hex hash');

export const OutcomeSchema = z.enum(['Unresolved', 'Completed', 'Refundable']);
export const OutcomeReasonSchema = z.enum(['Attested', 'Cancelled', 'Expired']);
export const PhaseSchema = z.enum([
  'AwaitingVerifier',
  'OnSale',
  'SoldOut',
  'InProgress',
  'AwaitingAttestation',
  'Expirable',
  'Completed',
  'Refundable',
]);
export const TicketStatusSchema = z.enum([
  'Active',
  'TransferPending',
  'RefundPending',
  'Refunded',
]);
export const ClaimSchema = z.enum([
  'Reserved',
  'Refundable',
  'RefundPending',
  'Refunded',
  'ReleasedToOrganizer',
]);
export const OperationKindSchema = z.enum(['Refund', 'Payout']);
export const HistoryKindSchema = z.enum([
  'Purchased',
  'Transferred',
  'TransferReturned',
  'RefundRequested',
  'RefundSettled',
  'RefundFailed',
]);

/**
 * The currency of an event and of every amount in its ledger (interface v2): `null` is NEAR (amounts
 * in yoctoNEAR), otherwise the account of one of the NEP-141 tokens in `Config.tokens` (amounts in
 * that token's smallest unit). The operating budget is in NEAR whatever the currency.
 */
export const CurrencySchema = AccountIdSchema.nullable();

/** A NEP-141 token a deployment accepts, fixed at `new` (interface v2). */
export const TokenSpecSchema = z.object({
  account_id: AccountIdSchema,
  /** 1 to 12 printable ASCII bytes (the contract checks 1 to 12 ASCII bytes). */
  symbol: z.string().regex(/^[ -~]{1,12}$/, 'Expected a token symbol of 1 to 12 ASCII bytes'),
  decimals: z.int().min(0).max(24),
});

/**
 * Input of `create_event`. `currency` may be left out and is then sent as `null` (NEAR), so the
 * call always names its currency.
 */
export const EventTermsSchema = z.strictObject({
  title: z.string(),
  venue: z.string(),
  starts_at_ms: TimestampMsSchema,
  ends_at_ms: TimestampMsSchema,
  resolution_deadline_ms: TimestampMsSchema,
  price: YoctoSchema,
  capacity: z.uint32(),
  verifier_id: AccountIdSchema,
  currency: CurrencySchema.default(null),
});

export const EventViewSchema = z.object({
  event_id: EventIdSchema,
  organizer_id: AccountIdSchema,
  verifier_id: AccountIdSchema,
  verifier_accepted: z.boolean(),
  terms_hash: TermsHashSchema,
  title: z.string(),
  venue: z.string(),
  starts_at_ms: TimestampMsSchema,
  ends_at_ms: TimestampMsSchema,
  resolution_deadline_ms: TimestampMsSchema,
  price: YoctoSchema,
  capacity: z.uint32(),
  sold: z.uint32(),
  outcome: OutcomeSchema,
  outcome_reason: OutcomeReasonSchema.nullable(),
  resolved_at_ms: TimestampMsSchema.nullable(),
  resolved_by: AccountIdSchema.nullable(),
  evidence_ref: z.string().nullable(),
  created_at_ms: TimestampMsSchema,
  phase: PhaseSchema,
  now_ms: TimestampMsSchema,
  currency: CurrencySchema,
});

export const TicketViewSchema = z.object({
  token_id: TokenIdSchema,
  event_id: EventIdSchema,
  serial: z.uint32().min(1),
  owner_id: AccountIdSchema,
  principal: YoctoSchema,
  status: TicketStatusSchema,
  claim: ClaimSchema,
  pending_operation_id: z.int().min(0).nullable(),
  currency: CurrencySchema,
});

export const AccountingViewSchema = z.object({
  event_id: EventIdSchema,
  principal_received: YoctoSchema,
  principal_reserved: YoctoSchema,
  refund_pending: YoctoSchema,
  refunds_settled: YoctoSchema,
  organizer_available: YoctoSchema,
  organizer_pending: YoctoSchema,
  organizer_settled: YoctoSchema,
  /** Always yoctoNEAR: the operating budget is in NEAR for every event. */
  operating_budget: YoctoSchema,
  /** The currency of every other amount in this row. */
  currency: CurrencySchema,
});

/** A settlement in flight. Exists only while pending; `token_id` is null for a payout. */
export const OperationViewSchema = z.object({
  operation_id: z.int().min(0),
  kind: OperationKindSchema,
  event_id: EventIdSchema,
  token_id: TokenIdSchema.nullable(),
  recipient_id: AccountIdSchema,
  amount: YoctoSchema,
  started_at_ms: TimestampMsSchema,
  currency: CurrencySchema,
});

export const HistoryEntrySchema = z.object({
  kind: HistoryKindSchema,
  account_id: AccountIdSchema,
  at_ms: TimestampMsSchema,
});

/** The first entry and the latest ones; `dropped` counts the entries in between. */
export const TicketHistorySchema = z.object({
  dropped: z.int().min(0),
  entries: z.array(HistoryEntrySchema),
});

export const ConfigSchema = z.object({
  version: z.string(),
  max_capacity: z.uint32(),
  max_page: z.uint32(),
  max_title_bytes: z.uint32(),
  max_venue_bytes: z.uint32(),
  max_ref_bytes: z.uint32(),
  max_memo_bytes: z.uint32(),
  max_msg_bytes: z.uint32(),
  history_cap: z.uint32(),
  storage_per_event: YoctoSchema,
  storage_per_ticket: YoctoSchema,
  fault_injection: z.boolean(),
  /** The tokens events may be priced in, besides NEAR. At most 4, fixed at deployment. */
  tokens: z.array(TokenSpecSchema).max(4),
});

export type Yocto = z.infer<typeof YoctoSchema>;
export type Currency = z.infer<typeof CurrencySchema>;
export type TokenSpec = z.infer<typeof TokenSpecSchema>;
export type AccountId = z.infer<typeof AccountIdSchema>;
export type TokenId = z.infer<typeof TokenIdSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type OutcomeReason = z.infer<typeof OutcomeReasonSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type OperationKind = z.infer<typeof OperationKindSchema>;
export type HistoryKind = z.infer<typeof HistoryKindSchema>;
/** What `createEvent` accepts: `currency` may be left out (NEAR). */
export type EventTerms = z.input<typeof EventTermsSchema>;
export type EventView = z.infer<typeof EventViewSchema>;
export type TicketView = z.infer<typeof TicketViewSchema>;
export type AccountingView = z.infer<typeof AccountingViewSchema>;
export type OperationView = z.infer<typeof OperationViewSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type TicketHistory = z.infer<typeof TicketHistorySchema>;
export type Config = z.infer<typeof ConfigSchema>;
