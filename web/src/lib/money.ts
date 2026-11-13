import {
  type Config,
  formatAmount,
  NEAR_UNIT,
  type Reader,
  type Unit,
  unitOf,
} from '@ticket-escrow/client';

// Every amount on every page is written by `formatAmount` in the unit of its event's currency:
// NEAR, or one of the tokens the contract accepts (plan 2026-11-13, "Currencies").

export { NEAR_UNIT };

/** Decimals a rounded amount keeps: what the NEAR facts always showed. */
const SHOWN_DECIMALS = 4;

/**
 * Rounded toward zero to 4 decimals: for lists, facts and summaries. A non-zero amount too small to
 * show reads `<0.0001`, never 0.
 */
export function money(amount: string, unit: Unit): string {
  return formatAmount(amount, unit, SHOWN_DECIMALS);
}

/** Every digit: for a button that moves money, so it names exactly what the wallet sends. */
export function moneyExact(amount: string, unit: Unit): string {
  return formatAmount(amount, unit);
}

// A deployment's token list is fixed at `new` and nobody can add one, so it is read once per reader.
const configs = new WeakMap<Reader, Promise<Config>>();

/** The contract's config, read once per reader; a failed read is not kept. */
export function readConfigOnce(reader: Reader): Promise<Config> {
  const known = configs.get(reader);
  if (known) return known;
  const read = reader.getConfig();
  configs.set(reader, read);
  read.catch(() => configs.delete(reader));
  return read;
}

/** The unit of `currency`; a NEAR amount needs no read. */
export async function unitFor(reader: Reader, currency: string | null): Promise<Unit> {
  if (currency === null) return NEAR_UNIT;
  return unitOf(await readConfigOnce(reader), currency);
}
