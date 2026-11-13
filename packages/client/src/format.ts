import type { Claim, Config, Phase } from './schemas.js';

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

/** How an amount is written: the symbol after it and how many decimals its smallest unit has. */
export type Unit = { symbol: string; decimals: number };

/** NEAR, whose smallest unit is the yoctoNEAR (10^-24). */
export const NEAR_UNIT: Unit = { symbol: 'NEAR', decimals: 24 };

/**
 * The unit of an event's amounts: NEAR for `null`, otherwise the token in `config.tokens`. Throws
 * for a token the deployment does not list: the contract never prices an event in one.
 */
export function unitOf(config: Config, currency: string | null): Unit {
  if (currency === null) return NEAR_UNIT;
  const token = config.tokens.find((t) => t.account_id === currency);
  if (token === undefined) {
    throw new RangeError(`${currency} is not one of the tokens this contract accepts.`);
  }
  return { symbol: token.symbol, decimals: token.decimals };
}

function checkUnit(unit: Unit): void {
  if (!Number.isInteger(unit.decimals) || unit.decimals < 0 || unit.decimals > NEAR_DECIMALS) {
    throw new RangeError(`A unit has 0 to ${NEAR_DECIMALS} decimals, not ${unit.decimals}`);
  }
}

/**
 * Writes an amount given in the unit's smallest units the way the contract does (interface v2):
 * the whole part, then a point and the fraction only when there is one, no trailing zeros, then
 * the symbol: `formatAmount('500000000000000000000000', NEAR_UNIT) === '0.5 NEAR'`,
 * `formatAmount('10000000', tUSD) === '10 tUSD'`. Exact by default; with `maxDecimals` it rounds
 * toward zero and writes a non-zero amount too small to show as `<0.0001 NEAR`, never `0 NEAR`.
 */
export function formatAmount(amount: string, unit: Unit, maxDecimals = unit.decimals): string {
  if (!YOCTO_PATTERN.test(amount)) throw new RangeError(`Not an amount: "${amount}"`);
  checkUnit(unit);
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0) {
    throw new RangeError('maxDecimals must be a whole number from 0');
  }
  const value = BigInt(amount);
  const scale = 10n ** BigInt(unit.decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(unit.decimals, '0')
    .slice(0, maxDecimals)
    .replace(/0+$/, '');
  if (whole === 0n && fraction === '' && value > 0n) {
    const shown = Math.min(maxDecimals, unit.decimals);
    return `<${shown === 0 ? '1' : `0.${'0'.repeat(shown - 1)}1`} ${unit.symbol}`;
  }
  return `${fraction === '' ? whole : `${whole}.${fraction}`} ${unit.symbol}`;
}

/**
 * Reads an amount typed in the unit (digits, optionally a point and at most `unit.decimals`
 * decimals; no symbol) into its smallest units: `parseAmount('10', tUSD) === '10000000'`. Returns
 * null for anything else, including more decimals than the unit has and amounts above a u128.
 */
export function parseAmount(text: string, unit: Unit): string | null {
  checkUnit(unit);
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text.trim());
  const whole = match?.[1];
  const fraction = match?.[2] ?? '';
  if (whole === undefined || fraction.length > unit.decimals) return null;
  const value =
    BigInt(whole) * 10n ** BigInt(unit.decimals) + BigInt(fraction.padEnd(unit.decimals, '0') || 0);
  return value > U128_MAX ? null : value.toString();
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
