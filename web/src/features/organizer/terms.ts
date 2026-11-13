import { type Config, type EventTerms, parseAmount, type Unit } from '@ticket-escrow/client';
import { testnetAccountError } from '../../lib/accounts';
import { tooLong } from '../../lib/text';

export const FIELDS = [
  'Title',
  'Venue',
  'Starts',
  'Ends',
  'Confirmation deadline',
  'Price',
  'Capacity',
  'Verifier account',
] as const;

export type Field = (typeof FIELDS)[number];
export type FormValues = Record<Field, string>;
export type FieldErrors = Partial<Record<Field, string>>;

/** Decimals a price may have: what the facts show (`money`), so no price is paid unseen. */
const PRICE_DECIMALS = 4;

export const EMPTY_FORM: FormValues = Object.fromEntries(FIELDS.map((f) => [f, ''])) as FormValues;

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** How far `timeZone`'s wall clock is ahead of UTC at the instant `utcMs` (Santiago in November: -3 h). */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - (utcMs - (utcMs % 1000));
}

/**
 * A `datetime-local` value ("2026-11-20T20:00") read as a wall-clock time in `timeZone`, the zone
 * the form names, never the process's. Null when empty or not a real date and time. Near a
 * daylight-saving change, an hour that is skipped or repeated maps to an instant next to it.
 */
export function parseLocalTime(value: string, timeZone: string): number | null {
  const match = LOCAL_TIME.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((n) => Number(n ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const read = new Date(wall);
  // Date.UTC rolls 30 February over to March; a real date reads back as itself.
  const real =
    read.getUTCFullYear() === year &&
    read.getUTCMonth() === month - 1 &&
    read.getUTCDate() === day &&
    read.getUTCHours() === hour &&
    read.getUTCMinutes() === minute &&
    read.getUTCSeconds() === second;
  if (!real) return null;
  // The offset at a first guess, then at the answer, which differ only across a change of offset.
  const guess = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(guess, timeZone);
}

/** The capacity as a whole number inside the contract's limit, or null. */
export function parseCapacity(value: string, config: Config): number | null {
  if (!/^[0-9]+$/.test(value.trim())) return null;
  const capacity = Number(value.trim());
  return capacity >= 1 && capacity <= config.max_capacity ? capacity : null;
}

/** What the checks need besides the form. */
export interface TermsContext {
  config: Config;
  organizer: string;
  /** The contract, which the contract refuses as verifier. */
  contractId: string;
  nowMs: number;
  /** The zone the form's times are read in. */
  timeZone: string;
  /** The event's currency: null for NEAR, else a token the contract accepts. */
  currency: string | null;
  /** The unit of that currency, which the price is typed in. */
  unit: Unit;
}

/**
 * The checks `create_event` makes, run before the wallet opens so a mistake costs no fee
 * (plan, "Rules" and "Limits"). The contract checks them again at its own clock.
 */
export function checkTerms(
  values: FormValues,
  { config, organizer, contractId, nowMs, timeZone, currency, unit }: TermsContext,
): { errors: FieldErrors; terms: EventTerms | null } {
  const errors: FieldErrors = {};
  const title = values.Title.trim();
  const venue = values.Venue.trim();
  if (title === '') errors.Title = 'Give the event a title.';
  else {
    const long = tooLong('title', title, config.max_title_bytes);
    if (long) errors.Title = long;
  }
  if (venue === '') errors.Venue = 'Say where the event takes place.';
  else {
    const long = tooLong('venue', venue, config.max_venue_bytes);
    if (long) errors.Venue = long;
  }

  const starts = parseLocalTime(values.Starts, timeZone);
  const ends = parseLocalTime(values.Ends, timeZone);
  const deadline = parseLocalTime(values['Confirmation deadline'], timeZone);
  if (starts === null) errors.Starts = 'Pick when the event starts.';
  else if (starts <= nowMs) errors.Starts = 'The start must be in the future.';
  if (ends === null) errors.Ends = 'Pick when the event ends.';
  else if (starts !== null && ends <= starts) errors.Ends = 'The end must be after the start.';
  if (deadline === null) errors['Confirmation deadline'] = 'Pick the confirmation deadline.';
  else if (ends !== null && deadline <= ends) {
    errors['Confirmation deadline'] = 'The deadline must be after the end.';
  }

  const typed = values.Price.trim();
  const price = parseAmount(typed, unit);
  const decimals = Math.min(PRICE_DECIMALS, unit.decimals);
  const step = 10n ** BigInt(unit.decimals - decimals);
  const fraction = /^[0-9]+\.([0-9]+)$/.exec(typed)?.[1] ?? '';
  if (price === null && fraction.length > unit.decimals) {
    // A number with more decimals than the currency has: say so, not that it is not a number.
    errors.Price = decimals === 0 ? 'Use a whole number.' : `Use at most ${decimals} decimals.`;
  } else if (price === null) {
    errors.Price = `Enter a price in ${unit.symbol}, like 1.5.`;
  } else if (BigInt(price) === 0n) {
    errors.Price = `The price must be above 0 ${unit.symbol}.`;
  } else if (BigInt(price) % step !== 0n) {
    // Amounts are shown to 4 decimals; a finer price would be accepted and paid unseen.
    errors.Price = decimals === 0 ? 'Use a whole number.' : `Use at most ${decimals} decimals.`;
  }

  const capacity = parseCapacity(values.Capacity, config);
  if (capacity === null) {
    errors.Capacity = `Capacity must be a whole number from 1 to ${config.max_capacity}.`;
  }

  const verifier = values['Verifier account'].trim();
  const invalidVerifier = testnetAccountError(verifier);
  if (invalidVerifier !== null) {
    errors['Verifier account'] = invalidVerifier;
  } else if (verifier === organizer) {
    errors['Verifier account'] = 'The verifier must be another account, not you.';
  } else if (verifier === contractId) {
    errors['Verifier account'] = 'The verifier must be another account than the contract.';
  }

  if (
    Object.keys(errors).length > 0 ||
    starts === null ||
    ends === null ||
    deadline === null ||
    price === null ||
    capacity === null
  ) {
    return { errors, terms: null };
  }
  return {
    errors,
    terms: {
      title,
      venue,
      starts_at_ms: starts,
      ends_at_ms: ends,
      resolution_deadline_ms: deadline,
      price,
      capacity,
      verifier_id: verifier,
      currency,
    },
  };
}
