import type { Claim, Phase } from './schemas.js';

// Money is bigint only: no floating point touches an amount (plan, "Global Constraints").

const NEAR_DECIMALS = 24;
const YOCTO_PER_NEAR = 10n ** BigInt(NEAR_DECIMALS);
const U128_MAX = (1n << 128n) - 1n;
const YOCTO_PATTERN = /^(0|[1-9][0-9]*)$/;
const NEAR_PATTERN = /^([0-9]+)(?:\.([0-9]{1,24}))?$/;

/**
 * Formats a yoctoNEAR amount as NEAR, rounding toward zero at `maxDecimals` and dropping trailing
 * zeros: `formatNear('1500000000000000000000000') === '1.5'`. A non-zero amount too small to show
 * becomes `'<0.0001'` (for the default precision), never `'0'`.
 */
export function formatNear(yocto: string, maxDecimals = 4): string {
  if (!YOCTO_PATTERN.test(yocto)) throw new RangeError(`Not a yoctoNEAR amount: "${yocto}"`);
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > NEAR_DECIMALS) {
    throw new RangeError(`maxDecimals must be an integer from 0 to ${NEAR_DECIMALS}`);
  }
  const amount = BigInt(yocto);
  const whole = amount / YOCTO_PER_NEAR;
  const fraction = (amount % YOCTO_PER_NEAR)
    .toString()
    .padStart(NEAR_DECIMALS, '0')
    .slice(0, maxDecimals)
    .replace(/0+$/, '');
  if (whole === 0n && fraction === '' && amount > 0n) {
    return maxDecimals === 0 ? '<1' : `<0.${'0'.repeat(maxDecimals - 1)}1`;
  }
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/**
 * Parses an amount typed in NEAR (digits, optionally a dot and up to 24 decimals) into a yoctoNEAR
 * decimal string: `parseNear('1.5') === '1500000000000000000000000'`.
 */
export function parseNear(text: string): string {
  const match = NEAR_PATTERN.exec(text.trim());
  const whole = match?.[1];
  if (whole === undefined) {
    throw new RangeError(
      `"${text}" is not an amount in NEAR. Use digits and at most one dot, like 1.5.`,
    );
  }
  const fraction = (match?.[2] ?? '').padEnd(NEAR_DECIMALS, '0');
  const amount = BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction);
  if (amount > U128_MAX) throw new RangeError(`"${text}" is larger than any NEAR amount.`);
  return amount.toString();
}

/**
 * Formats Unix milliseconds in the given IANA time zone, 24-hour clock, with the zone name:
 * `'Nov 14, 2026, 17:00 GMT-3'`. Built from parts so the output does not depend on ICU spacing.
 */
export function formatDateTime(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('month')} ${part('day')}, ${part('year')}, ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

/** Display word for each event phase. */
export const PHASE_LABELS: Readonly<Record<Phase, string>> = {
  AwaitingVerifier: 'Awaiting verifier',
  OnSale: 'On sale',
  SoldOut: 'Sold out',
  InProgress: 'In progress',
  AwaitingAttestation: 'Awaiting confirmation',
  Expirable: 'Deadline passed',
  Completed: 'Completed',
  Refundable: 'Refunds open',
};

/** Display word for each ticket claim state (plan, Track W: one meaning per word). */
export const CLAIM_LABELS: Readonly<Record<Claim, string>> = {
  Reserved: 'Reserved',
  Refundable: 'Claimable',
  RefundPending: 'Sending',
  Refunded: 'Refunded',
  ReleasedToOrganizer: 'Released to the organizer',
};
