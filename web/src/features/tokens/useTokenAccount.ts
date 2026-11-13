import { useCallback } from 'react';
import type { Refresh } from '../../lib/near/useTx';
import { type Load, useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';

/** What a token knows about one account. */
export interface TokenAccount {
  token: string;
  accountId: string;
  /** Whether the token keeps a balance for the account (NEP-145 storage registration). */
  registered: boolean;
  /** The storage deposit, in yoctoNEAR, that registers an account with this token. */
  minDeposit: string;
  /** In the token's smallest unit; null when the caller did not ask for it. */
  balance: string | null;
}

export interface TokenAccountLoad {
  load: Load<TokenAccount | null>;
  /** How a registration or a faucet transaction reads this account again afterwards. */
  refresh: (before: TokenAccount) => Refresh<TokenAccount | null>;
}

/**
 * Reads `accountId`'s registration (and, with `withBalance`, its balance) at `token`. Null while
 * there is nothing to read: a NEAR amount (`token` null) or nobody signed in.
 */
export function useTokenAccount(
  token: string | null,
  accountId: string | null,
  withBalance = false,
): TokenAccountLoad {
  const { reader } = useServices();
  const read = useCallback(async (): Promise<TokenAccount | null> => {
    if (token === null || accountId === null) return null;
    const [registration, balance] = await Promise.all([
      reader.tokenRegistration(token, accountId),
      withBalance ? reader.tokenBalance(token, accountId) : Promise.resolve(null),
    ]);
    return { token, accountId, ...registration, balance };
  }, [reader, token, accountId, withBalance]);
  const load = useLoad(`token-account:${token ?? ''}:${accountId ?? ''}:${withBalance}`, read);
  const refresh = (before: TokenAccount): Refresh<TokenAccount | null> => ({
    before,
    read,
    apply: load.set,
    // What a registration or a faucet changes.
    key: (value) => [value?.registered, value?.balance],
  });
  return { load, refresh };
}
