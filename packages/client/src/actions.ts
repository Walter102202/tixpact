import {
  AccountIdSchema,
  EventIdSchema,
  type EventTerms,
  EventTermsSchema,
  TermsHashSchema,
  TokenIdSchema,
  YoctoSchema,
} from './schemas.js';

// Pure builders for every change call the web and the agent make. Each returns the exact
// function call to sign; amounts and gas are decimal strings. Inputs are validated, so a
// malformed amount or id throws here instead of reaching a wallet.

/** Client-side gas per method, in Tgas. The one source (plan, "Gas"). */
export const GAS_TGAS = {
  create_event: 30,
  accept_verification: 30,
  buy_ticket: 50,
  cancel_event: 30,
  attest_completed: 30,
  expire_event: 30,
  claim_refund: 100,
  claim_payout: 100,
  nft_transfer: 30,
  nft_transfer_call: 150,
} as const;

export type ContractMethod = keyof typeof GAS_TGAS;

/** A function call ready for a wallet or a signer. */
export interface ContractCall {
  methodName: ContractMethod;
  args: Record<string, unknown>;
  /** yoctoNEAR, decimal string. */
  deposit: string;
  /** Gas units, decimal string. */
  gas: string;
}

/** The deposit of calls that only need the wallet's explicit confirmation. */
export const ONE_YOCTO = '1';

const TGAS = 10n ** 12n;

function call(
  methodName: ContractMethod,
  args: Record<string, unknown>,
  deposit: string,
): ContractCall {
  return { methodName, args, deposit, gas: (BigInt(GAS_TGAS[methodName]) * TGAS).toString() };
}

/** Organizer: create an event. `budget` is exactly `quoteEventBudget(terms.capacity)`. */
export function createEvent(terms: EventTerms, budget: string): ContractCall {
  return call('create_event', { terms: EventTermsSchema.parse(terms) }, YoctoSchema.parse(budget));
}

/** Verifier: accept the exact terms, echoing `EventView.terms_hash`. */
export function acceptVerification(eventId: number, termsHash: string): ContractCall {
  return call(
    'accept_verification',
    { event_id: EventIdSchema.parse(eventId), terms_hash: TermsHashSchema.parse(termsHash) },
    ONE_YOCTO,
  );
}

/** Buyer: pay exactly the ticket price. */
export function buyTicket(eventId: number, price: string): ContractCall {
  return call('buy_ticket', { event_id: EventIdSchema.parse(eventId) }, YoctoSchema.parse(price));
}

/** Organizer or verifier: cancel before the resolution deadline. */
export function cancelEvent(eventId: number, reasonRef: string | null = null): ContractCall {
  return call(
    'cancel_event',
    { event_id: EventIdSchema.parse(eventId), reason_ref: reasonRef },
    ONE_YOCTO,
  );
}

/** Verifier: confirm the event took place, inside the attestation window. */
export function attestCompleted(eventId: number, evidenceRef: string | null = null): ContractCall {
  return call(
    'attest_completed',
    { event_id: EventIdSchema.parse(eventId), evidence_ref: evidenceRef },
    ONE_YOCTO,
  );
}

/** Anyone: switch an unresolved event to refunds once its deadline has passed. */
export function expireEvent(eventId: number): ContractCall {
  return call('expire_event', { event_id: EventIdSchema.parse(eventId) }, '0');
}

/** Holder: claim the ticket's principal back. */
export function claimRefund(tokenId: string): ContractCall {
  return call('claim_refund', { token_id: TokenIdSchema.parse(tokenId) }, ONE_YOCTO);
}

/** Organizer: collect everything available after the event was confirmed. */
export function claimPayout(eventId: number): ContractCall {
  return call('claim_payout', { event_id: EventIdSchema.parse(eventId) }, ONE_YOCTO);
}

/** Holder: give the ticket, and with it the right to the refund, to another account. */
export function transferTicket(
  tokenId: string,
  receiverId: string,
  memo: string | null = null,
): ContractCall {
  return call(
    'nft_transfer',
    {
      receiver_id: AccountIdSchema.parse(receiverId),
      token_id: TokenIdSchema.parse(tokenId),
      approval_id: null,
      memo,
    },
    ONE_YOCTO,
  );
}
