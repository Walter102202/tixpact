import {
  actions,
  type Claim,
  type ContractCall,
  type ContractMethod,
  formatNear,
  type TicketView,
} from '@ticket-escrow/client';

// The agent's spending rules: a pure function over the exact call about to be signed. The checks
// run in a fixed order and the first failure wins. The account balance is the hard cap the chain
// enforces; these caps sit on top of it (plan, Track M).

/** The only methods the agent may call, and only on `Policy.contractId`. */
export const ALLOWED_METHODS = [
  'buy_ticket',
  'nft_transfer',
  'expire_event',
  'claim_refund',
] as const satisfies readonly ContractMethod[];

export type AllowedMethod = (typeof ALLOWED_METHODS)[number];

export interface Policy {
  /** The one contract the agent may call. */
  contractId: string;
  /** Largest deposit of a single `buy_ticket`, in yoctoNEAR. */
  maxPriceYocto: string;
  /** Largest total principal of the tickets the agent holds after a purchase, in yoctoNEAR. */
  maxExposureYocto: string;
}

/** What the policy needs from the chain, read right before each decision. */
export interface AgentState {
  /** `exposureOf` the agent's tickets, in yoctoNEAR. */
  exposureYocto: string;
}

/** The exact function call the agent is about to sign. */
export interface Intent {
  receiverId: string;
  call: ContractCall;
}

export type DenyReason =
  | 'contract_not_allowed'
  | 'method_not_allowed'
  | 'gas_above_table'
  | 'deposit_not_allowed'
  | 'price_above_cap'
  | 'exposure_above_cap';

export type Decision =
  | { outcome: 'allow' }
  | { outcome: 'deny'; reason: DenyReason; message: string };

const ALLOWED: ReadonlySet<string> = new Set(ALLOWED_METHODS);
const TGAS = 10n ** 12n;
const ONE_YOCTO = 1n;

/** Claims whose principal is still inside the contract (docs/decisions, agent exposure). */
const EXPOSED: ReadonlySet<Claim> = new Set(['Reserved', 'Refundable', 'RefundPending']);

/** Exact NEAR, never rounded: a cap message must not make an amount look smaller than it is. */
const near = (yocto: bigint | string) => `${formatNear(yocto.toString(), 24)} NEAR`;
/** Exact Tgas: formatNear divides by 10^24, so gas units scaled by 10^12 come out in Tgas. */
const tgas = (gas: bigint) => formatNear((gas * TGAS).toString(), 24);

/**
 * The principal of the tickets whose money is still held by the contract: reserved, claimable, or
 * on its way back. Refunded tickets returned their money; released ones paid for an event that took
 * place. Returns yoctoNEAR.
 */
/** Whether a ticket in this claim state still has its price inside the contract for its holder. */
export function isExposedClaim(claim: Claim): boolean {
  return EXPOSED.has(claim);
}

export function exposureOf(tickets: readonly TicketView[]): string {
  return tickets
    .filter((ticket) => isExposedClaim(ticket.claim))
    .reduce((sum, ticket) => sum + BigInt(ticket.principal), 0n)
    .toString();
}

/**
 * Decides whether the agent may sign `intent`. Order: the contract, the method, the gas, then the
 * deposit (only `buy_ticket` may attach more than 1 yoctoNEAR), then for a purchase the per-ticket
 * cap and the exposure cap. A malformed amount throws, so nothing is signed.
 */
export function evaluate(policy: Policy, state: AgentState, intent: Intent): Decision {
  const { receiverId, call } = intent;
  const deny = (reason: DenyReason, message: string): Decision => ({
    outcome: 'deny',
    reason,
    message,
  });

  if (receiverId !== policy.contractId) {
    return deny(
      'contract_not_allowed',
      `Contract ${receiverId} is not allowed: this agent only calls ${policy.contractId}`,
    );
  }
  if (!ALLOWED.has(call.methodName)) {
    return deny(
      'method_not_allowed',
      `Method ${call.methodName} is not allowed: this agent only calls buy_ticket, nft_transfer, expire_event and claim_refund`,
    );
  }

  const gasLimit = BigInt(actions.GAS_TGAS[call.methodName]) * TGAS;
  const gas = BigInt(call.gas);
  if (gas > gasLimit) {
    return deny(
      'gas_above_table',
      `${call.methodName} asks for ${tgas(gas)} Tgas, above the ${actions.GAS_TGAS[call.methodName]} Tgas the client gives it`,
    );
  }

  const deposit = BigInt(call.deposit);
  if (call.methodName !== 'buy_ticket') {
    if (deposit > ONE_YOCTO) {
      return deny(
        'deposit_not_allowed',
        `${call.methodName} would attach ${near(deposit)}; only buy_ticket may attach more than 1 yoctoNEAR`,
      );
    }
    return { outcome: 'allow' };
  }

  const maxPrice = BigInt(policy.maxPriceYocto);
  if (deposit > maxPrice) {
    return deny(
      'price_above_cap',
      `Price ${near(deposit)} is above the per-ticket cap of ${near(maxPrice)}`,
    );
  }
  const held = BigInt(state.exposureYocto);
  const after = held + deposit;
  const maxExposure = BigInt(policy.maxExposureYocto);
  if (after > maxExposure) {
    return deny(
      'exposure_above_cap',
      `Exposure would be ${near(after)} (${near(held)} in tickets held plus ${near(deposit)} for this one), above the cap of ${near(maxExposure)}`,
    );
  }
  return { outcome: 'allow' };
}
