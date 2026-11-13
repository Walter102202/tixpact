// Contract error codes (plan, "Error codes", plus the two of interface v2) and the one plain-English sentence shown for each.
// Every contract panic message starts with a code, then `: ` and a sentence of its own.

export const ERROR_CODES = [
  'ERR_NOT_FOUND',
  'ERR_UNAUTHORIZED',
  'ERR_ONE_YOCTO',
  'ERR_WRONG_DEPOSIT',
  'ERR_INVALID_TERMS',
  'ERR_LIMIT',
  'ERR_TERMS_MISMATCH',
  'ERR_NOT_ACCEPTED',
  'ERR_SOLD_OUT',
  'ERR_TOO_EARLY',
  'ERR_TOO_LATE',
  'ERR_ALREADY_RESOLVED',
  'ERR_NOT_REFUNDABLE',
  'ERR_NOT_COMPLETED',
  'ERR_TICKET_LOCKED',
  'ERR_ALREADY_REFUNDED',
  'ERR_NOTHING_TO_PAY',
  'ERR_PAYOUT_PENDING',
  'ERR_INSUFFICIENT_LIQUIDITY',
  'ERR_INSUFFICIENT_GAS',
  'ERR_APPROVALS_DISABLED',
  // Interface v2: purchases in a token.
  'ERR_WRONG_CURRENCY',
  'ERR_BAD_MESSAGE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ERR_NOT_FOUND: 'That event or ticket does not exist.',
  ERR_UNAUTHORIZED: 'This account is not allowed to do that.',
  ERR_ONE_YOCTO:
    'This action must be confirmed in your wallet with a deposit of exactly 1 yoctoNEAR, the smallest unit of NEAR.',
  ERR_WRONG_DEPOSIT: 'The amount sent does not match the amount this action requires.',
  ERR_INVALID_TERMS: 'The event terms are not valid.',
  ERR_LIMIT: 'A value is longer or larger than the contract allows.',
  ERR_TERMS_MISMATCH: 'The terms you accepted are not the terms of this event.',
  ERR_NOT_ACCEPTED: 'Tickets are not on sale until the verifier accepts the event terms.',
  ERR_SOLD_OUT: 'This event is sold out.',
  ERR_TOO_EARLY: 'It is too early for this action.',
  ERR_TOO_LATE: 'It is too late for this action.',
  ERR_ALREADY_RESOLVED: 'This event already has its final outcome.',
  ERR_NOT_REFUNDABLE: 'This ticket cannot be claimed: the event is not open for refunds.',
  ERR_NOT_COMPLETED: 'The organizer can be paid only after the verifier confirms the event.',
  ERR_TICKET_LOCKED: 'This ticket has a payment or transfer in progress. Wait until it finishes.',
  ERR_ALREADY_REFUNDED: 'This ticket was already refunded.',
  ERR_NOTHING_TO_PAY: 'There is nothing to pay out.',
  ERR_PAYOUT_PENDING: 'A payout to the organizer is already being sent.',
  ERR_INSUFFICIENT_LIQUIDITY:
    'The contract cannot send this payment yet without using money reserved for others. Try again in a moment.',
  ERR_INSUFFICIENT_GAS: 'The transaction did not attach enough gas to finish safely. Try again.',
  ERR_APPROVALS_DISABLED: 'Ticket approvals are not supported.',
  ERR_WRONG_CURRENCY:
    'This event is priced in another currency. Pay in the currency the event names; any amount sent was returned.',
  ERR_BAD_MESSAGE: 'The payment did not say which event it was for, so the token returned it.',
};

export interface ContractError {
  code: ErrorCode | 'UNKNOWN';
  message: string;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);
const CODE_PATTERN = /\bERR_[A-Z_]+\b/g;
const PANIC_PREFIX = 'Smart contract panicked: ';
const MAX_DEPTH = 8;
const MAX_DETAIL = 200;

/**
 * Reads a contract error out of anything a failed call can produce: a panic string, an `Error`
 * (with its `cause` and, for a failover provider, its `errors`), or a receipt `Failure` object.
 * Returns the first known code with its sentence, or `UNKNOWN` with the plainest description found.
 */
export function parseContractError(raw: unknown): ContractError {
  const texts: string[] = [];
  const missingAccounts: string[] = [];
  collect(raw, 0, new Set(), texts, missingAccounts);

  for (const text of texts) {
    for (const match of text.matchAll(CODE_PATTERN)) {
      const code = match[0];
      if (KNOWN_CODES.has(code)) {
        return { code: code as ErrorCode, message: ERROR_MESSAGES[code as ErrorCode] };
      }
    }
  }
  return { code: 'UNKNOWN', message: describeUnknown(texts, missingAccounts) };
}

function describeUnknown(texts: string[], missingAccounts: string[]): string {
  const missing = missingAccounts[0];
  if (missing !== undefined) return `Account ${missing} does not exist.`;
  const all = texts.join('\n');
  if (/Exceeded the prepaid gas|GasExceeded|GasLimitExceeded/.test(all)) {
    return 'The call ran out of gas before it finished.';
  }
  if (/NotEnoughBalance|LackBalanceForState|not enough balance/i.test(all)) {
    return 'The account does not have enough NEAR for this.';
  }
  const panic = texts.find((text) => text.includes(PANIC_PREFIX));
  if (panic !== undefined) {
    const detail = panic.slice(panic.indexOf(PANIC_PREFIX) + PANIC_PREFIX.length).trim();
    return `The contract rejected the call: ${detail.slice(0, MAX_DETAIL)}`;
  }
  return 'The transaction failed for a reason the app does not recognize.';
}

function collect(
  value: unknown,
  depth: number,
  seen: Set<object>,
  texts: string[],
  missingAccounts: string[],
): void {
  if (typeof value === 'string') {
    texts.push(value);
    return;
  }
  if (typeof value !== 'object' || value === null || depth > MAX_DEPTH || seen.has(value)) return;
  seen.add(value);

  if (value instanceof Error) {
    texts.push(value.message);
    collect(value.cause, depth + 1, seen, texts, missingAccounts);
  }
  const record = value as Record<string, unknown>;
  // Chain error kinds arrive as keys (`{ InvalidTxError: { NotEnoughBalance: {...} } }`).
  if (!Array.isArray(value)) texts.push(...Object.keys(record));
  const missing = record.AccountDoesNotExist;
  if (typeof missing === 'object' && missing !== null) {
    const accountId = (missing as Record<string, unknown>).account_id;
    if (typeof accountId === 'string') missingAccounts.push(accountId);
  }
  for (const child of Object.values(record)) {
    collect(child, depth + 1, seen, texts, missingAccounts);
  }
}
