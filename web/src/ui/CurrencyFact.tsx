import type { Unit } from '@ticket-escrow/client';
import { useServices } from '../services';
import { AccountLink } from './AccountLink';

/** How every screen names a token with a test faucet, so nobody takes it for real money. */
export const TEST_DOLLAR = 'a test dollar with no value';

/** Whether `token` is one of this deployment's test tokens (those with a faucet). */
export function useIsTestToken(token: string | null): boolean {
  const { faucets } = useServices();
  return token !== null && faucets.includes(token);
}

/**
 * For an event priced in a token, the fact that names the token's contract, so a buyer can check
 * which token the price is in. Nothing for an event priced in NEAR.
 */
export function CurrencyFact({ currency, unit }: { currency: string | null; unit: Unit }) {
  const test = useIsTestToken(currency);
  if (currency === null) return null;
  return (
    <>
      <dt>Paid in</dt>
      <dd>
        {unit.symbol}, the token <AccountLink id={currency} />
        {test && `, ${TEST_DOLLAR}`}
      </dd>
    </>
  );
}
