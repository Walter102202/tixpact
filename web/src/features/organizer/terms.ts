import { AccountIdSchema, type Config, type EventTerms, parseNear } from '@ticket-escrow/client';
import { tooLong } from '../../lib/text';

export const FIELDS = [
  'Title',
  'Venue',
  'Starts',
  'Ends',
  'Confirmation deadline',
  'Price in NEAR',
  'Capacity',
  'Verifier account',
] as const;

export type Field = (typeof FIELDS)[number];
export type FormValues = Record<Field, string>;
export type FieldErrors = Partial<Record<Field, string>>;

export const EMPTY_FORM: FormValues = Object.fromEntries(FIELDS.map((f) => [f, ''])) as FormValues;

/** A `datetime-local` value read in the viewer's zone, or null when it is empty or invalid. */
export function parseLocalTime(value: string): number | null {
  if (value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** The capacity as a whole number inside the contract's limit, or null. */
export function parseCapacity(value: string, config: Config): number | null {
  if (!/^[0-9]+$/.test(value.trim())) return null;
  const capacity = Number(value.trim());
  return capacity >= 1 && capacity <= config.max_capacity ? capacity : null;
}

/**
 * The checks `create_event` makes, run before the wallet opens so a mistake costs no fee
 * (plan, "Rules" and "Limits"). The contract checks them again at its own clock.
 */
export function checkTerms(
  values: FormValues,
  config: Config,
  organizer: string,
  nowMs: number,
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

  const starts = parseLocalTime(values.Starts);
  const ends = parseLocalTime(values.Ends);
  const deadline = parseLocalTime(values['Confirmation deadline']);
  if (starts === null) errors.Starts = 'Pick when the event starts.';
  else if (starts <= nowMs) errors.Starts = 'The start must be in the future.';
  if (ends === null) errors.Ends = 'Pick when the event ends.';
  else if (starts !== null && ends <= starts) errors.Ends = 'The end must be after the start.';
  if (deadline === null) errors['Confirmation deadline'] = 'Pick the confirmation deadline.';
  else if (ends !== null && deadline <= ends) {
    errors['Confirmation deadline'] = 'The deadline must be after the end.';
  }

  let price: string | null = null;
  try {
    price = parseNear(values['Price in NEAR'].trim());
  } catch {
    errors['Price in NEAR'] = 'Enter a price in NEAR, like 1.5.';
  }
  if (price !== null && BigInt(price) === 0n) {
    errors['Price in NEAR'] = 'The price must be above 0 NEAR.';
  }

  const capacity = parseCapacity(values.Capacity, config);
  if (capacity === null) {
    errors.Capacity = `Capacity must be a whole number from 1 to ${config.max_capacity}.`;
  }

  const verifier = values['Verifier account'].trim();
  if (!AccountIdSchema.safeParse(verifier).success) {
    errors['Verifier account'] = 'That is not a valid NEAR account id.';
  } else if (verifier === organizer) {
    errors['Verifier account'] = 'The verifier must be another account, not you.';
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
    },
  };
}
