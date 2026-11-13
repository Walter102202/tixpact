import { useSyncExternalStore } from 'react';
import { useServices } from '../../services';

export interface WalletState {
  accountId: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useWallet(): WalletState {
  const { wallet } = useServices();
  const accountId = useSyncExternalStore(
    wallet.subscribe,
    wallet.getAccountId,
    wallet.getAccountId,
  );
  return {
    accountId,
    // Closing the wallet selector is a normal choice, not an error to show.
    signIn: () => wallet.signIn().catch(() => {}),
    signOut: () => wallet.signOut().catch(() => {}),
  };
}
