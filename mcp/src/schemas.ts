import {
  AccountIdSchema,
  AccountingViewSchema,
  EventIdSchema,
  EventViewSchema,
  TicketHistorySchema,
  TicketViewSchema,
  TokenIdSchema,
  YoctoSchema,
} from '@ticket-escrow/client';
import { z } from 'zod';

// Inputs and outputs of the ten tools. Every one is a strict object: an unknown argument is an
// error, not something silently ignored. Amounts are yoctoNEAR decimal strings, as in the contract.

export const TOOL_NAMES = [
  'list_events',
  'get_event',
  'get_ticket',
  'list_my_tickets',
  'get_wallet',
  'verify_contract',
  'buy_ticket',
  'transfer_ticket',
  'expire_event',
  'claim_refund',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** The contract's page limit (plan, "Limits"). */
export const MAX_PAGE = 50;
/** The contract's `max_memo_bytes`. */
const MAX_MEMO_BYTES = 256;

const eventId = EventIdSchema.describe('Event id, a number from 1 (see list_events).');
const tokenId = TokenIdSchema.describe('Ticket id like "3-17": ticket 17 of event 3.');
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

export const INPUT = {
  list_events: z.strictObject({
    from_index: z
      .int()
      .min(0)
      .default(0)
      .describe('Position of the first event to list, 0 for the oldest.'),
    limit: z
      .int()
      .min(1)
      .max(MAX_PAGE)
      .default(MAX_PAGE)
      .describe(`How many events to list, at most ${MAX_PAGE}.`),
  }),
  get_event: z.strictObject({ event_id: eventId }),
  get_ticket: z.strictObject({ token_id: tokenId }),
  list_my_tickets: z.strictObject({}),
  get_wallet: z.strictObject({}),
  verify_contract: z.strictObject({}),
  buy_ticket: z.strictObject({ event_id: eventId }),
  transfer_ticket: z.strictObject({
    token_id: tokenId,
    receiver_id: AccountIdSchema.describe(
      'Account that receives the ticket, and with it the right to its refund.',
    ),
    memo: z
      .string()
      .refine((memo) => utf8Bytes(memo) <= MAX_MEMO_BYTES, {
        message: `memo is longer than ${MAX_MEMO_BYTES} bytes`,
      })
      .optional()
      .describe(`Optional note stored with the transfer, at most ${MAX_MEMO_BYTES} bytes.`),
  }),
  expire_event: z.strictObject({ event_id: eventId }),
  claim_refund: z.strictObject({ token_id: tokenId }),
} as const satisfies Record<ToolName, z.ZodType>;

const CallSchema = z.strictObject({
  contract_id: z.string(),
  method_name: z.string(),
  args: z.record(z.string(), z.unknown()),
  deposit: YoctoSchema,
  gas: z.string(),
});

/**
 * - `denied`: this server's rules refused it (no key, the allowlist, a cap). Nothing was signed.
 * - `not_sent`: the chain says the contract would reject it (not on sale, not the holder, too
 *   early). Nothing was signed.
 * - `succeeded` / `failed`: signed, and judged on the final status with every receipt.
 * - `unconfirmed`: signed, but no final status arrived in time; check `tx_hash` before retrying.
 */
export const WriteStatusSchema = z.enum([
  'denied',
  'not_sent',
  'succeeded',
  'failed',
  'unconfirmed',
]);

export const WriteResultSchema = z.strictObject({
  status: WriteStatusSchema,
  /** A short code: the deny or not-sent reason, or the contract error code of a failure. */
  reason: z.string().nullable(),
  message: z.string(),
  /** The call that was (or would have been) signed; null when nothing was built. */
  call: CallSchema.nullable(),
  tx_hash: z.string().nullable(),
  explorer_url: z.string().nullable(),
  failed_receipt: z
    .strictObject({
      receipt_id: z.string(),
      executor_id: z.string(),
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
  /** The decoded return value of the call (a ticket id, an outcome, a refund flag), or null. */
  value: z.unknown(),
});

export const OUTPUT = {
  list_events: z.strictObject({
    events: z.array(EventViewSchema),
    /** Pass as `from_index` to read the next page; null when this page is the last one. */
    next_from_index: z.int().min(0).nullable(),
  }),
  get_event: z.strictObject({
    event: EventViewSchema,
    accounting: AccountingViewSchema.nullable(),
  }),
  get_ticket: z.strictObject({
    ticket: TicketViewSchema,
    event: EventViewSchema.nullable(),
    history: TicketHistorySchema.nullable(),
  }),
  list_my_tickets: z.strictObject({
    account_id: z.string(),
    tickets: z.array(TicketViewSchema),
    /** Principal still inside the contract for these tickets: what the exposure cap counts. */
    exposure: YoctoSchema,
  }),
  get_wallet: z.strictObject({
    account_id: z.string(),
    network: z.literal('testnet'),
    contract_id: z.string(),
    balance: YoctoSchema,
    can_sign: z.boolean(),
    max_price: YoctoSchema.nullable(),
    max_exposure: YoctoSchema.nullable(),
    exposure: YoctoSchema,
    /** How much more principal the exposure cap allows; null without caps. */
    headroom: YoctoSchema.nullable(),
  }),
  verify_contract: z.strictObject({
    contract_id: z.string(),
    code_hash: z.string(),
    access_keys: z.int().min(0),
    balance: YoctoSchema,
    /** What the contract owes: reserved principal plus organizer payouts available. */
    held: YoctoSchema,
    reserved_principal: YoctoSchema,
    balance_covers_held: z.boolean(),
    events_counted: z.int().min(0),
    block_height: z.int().min(0),
  }),
  buy_ticket: WriteResultSchema,
  transfer_ticket: WriteResultSchema,
  expire_event: WriteResultSchema,
  claim_refund: WriteResultSchema,
} as const satisfies Record<ToolName, z.ZodType>;

export type ToolInput<N extends ToolName> = z.output<(typeof INPUT)[N]>;
export type ToolOutput<N extends ToolName> = z.output<(typeof OUTPUT)[N]>;
export type WriteStatus = z.infer<typeof WriteStatusSchema>;
export type WriteResult = z.infer<typeof WriteResultSchema>;
