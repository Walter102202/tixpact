import type { Unit } from '@ticket-escrow/client';
import { AccountLink } from './AccountLink';

/**
 * For an event priced in a token, the fact that names the token's contract, so a buyer can check
 * which token the price is in. Nothing for an event priced in NEAR.
 */
export function CurrencyFact({ currency, unit }: { currency: string | null; unit: Unit }) {
  if (currency === null) return null;
  return (
    <>
      <dt>Paid in</dt>
      <dd>
        {unit.symbol}, the token <AccountLink id={currency} />
      </dd>
    </>
  );
}
