import { NearConnector } from '@hot-labs/near-connect';
import type { SentTx, WalletPort } from './wallet';
import { toConnectorAction, txHashFromOutcome } from './walletOutcome';

// The live wallet: NEAR Connect 0.12.0 without the function-call-key plugin (plan, Track W).
// Every payable call goes through the wallet's own approval.

export interface ConnectorOptions {
  contractId: string;
  rpcUrls: string[];
}

export function createNearConnectWallet({ contractId, rpcUrls }: ConnectorOptions): WalletPort {
  const connector = new NearConnector({
    network: 'testnet',
    providers: { testnet: rpcUrls },
    features: { testnet: true, signAndSendTransaction: true },
  });
  let accountId: string | null = null;
  const listeners = new Set<() => void>();
  const setAccount = (next: string | null) => {
    accountId = next;
    for (const listener of listeners) listener();
  };

  connector.on('wallet:signIn', (event) => setAccount(event.accounts[0]?.accountId ?? null));
  connector.on('wallet:signOut', () => setAccount(null));
  connector
    .getConnectedWallet()
    .then(({ accounts }) => setAccount(accounts[0]?.accountId ?? null))
    .catch(() => setAccount(null));

  return {
    getAccountId: () => accountId,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async signIn() {
      await connector.connect();
    },
    async signOut() {
      await connector.disconnect();
      setAccount(null);
    },
    async send(call): Promise<SentTx> {
      const signerId = accountId;
      if (signerId === null) throw new Error('Sign in first.');
      const wallet = await connector.wallet();
      const outcome: unknown = await wallet.signAndSendTransaction({
        signerId,
        receiverId: contractId,
        actions: [toConnectorAction(call)],
      });
      // The wallet's outcome is not proof of anything; only its hash is used, to re-read the chain.
      return { txHash: txHashFromOutcome(outcome), signerId };
    },
  };
}
