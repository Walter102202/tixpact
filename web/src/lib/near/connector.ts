import { NearConnector, type NearWalletBase } from '@hot-labs/near-connect';
import {
  type MessageRequest,
  MessageSigningUnsupported,
  type SentTx,
  type SignedMessage,
  type WalletPort,
} from './wallet';
import { transactionFor, txHashFromOutcome } from './walletOutcome';

// The live wallet: NEAR Connect 0.12.0 without the function-call-key plugin (plan, Track W).
// Every payable call goes through the wallet's own approval.

export interface ConnectorOptions {
  contractId: string;
  rpcUrls: string[];
}

/**
 * The wallets the plan verified on testnet. The manifest also offers Ledger, Nightly, Ethereum
 * wallets and NEAR CLI there; a judge who picks one of those may reach a dead end.
 */
export const TESTNET_WALLETS = ['meteor-wallet', 'intear-wallet'] as const;

/**
 * Narrows the wallet selector to `ids`. near-connect 0.12.0 has only a deny list
 * (`excludedWallets`), which never removes hot-wallet and does not cover wallets a browser
 * extension injects later. Its selector lists the public `availableWallets` getter when it opens,
 * so the allow list is applied there, on top of near-connect's own network and feature filters.
 */
export function limitWallets(connector: NearConnector, ids: readonly string[]): void {
  const allowed = new Set(ids);
  const base = Object.getOwnPropertyDescriptor(NearConnector.prototype, 'availableWallets')?.get;
  if (!base) throw new Error('near-connect has no availableWallets getter; check its version.');
  Object.defineProperty(connector, 'availableWallets', {
    configurable: true,
    get: (): NearConnector['availableWallets'] =>
      (base.call(connector) as NearConnector['availableWallets']).filter((wallet) =>
        allowed.has(wallet.manifest.id),
      ),
  });
}

/**
 * Asks a near-connect wallet to sign a NEP-413 message for `signerId`. A wallet whose manifest
 * does not list `signMessage` is refused before it opens, so the page can say so in a sentence.
 */
export async function signMessageWith(
  wallet: Pick<NearWalletBase, 'manifest' | 'signMessage'>,
  signerId: string,
  { message, nonce, recipient }: MessageRequest,
): Promise<SignedMessage> {
  if (!wallet.manifest.features.signMessage) {
    throw new MessageSigningUnsupported(`${wallet.manifest.name} cannot sign messages.`);
  }
  const signed = await wallet.signMessage({
    message,
    nonce,
    recipient,
    network: 'testnet',
    signerId,
  });
  return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature };
}

export function createNearConnectWallet({ contractId, rpcUrls }: ConnectorOptions): WalletPort {
  const connector = new NearConnector({
    network: 'testnet',
    providers: { testnet: rpcUrls },
    features: { testnet: true, signAndSendTransaction: true },
  });
  limitWallets(connector, TESTNET_WALLETS);
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
      const outcome: unknown = await wallet.signAndSendTransaction(
        transactionFor(call, signerId, contractId),
      );
      // The wallet's outcome is not proof of anything; only its hash is used, to re-read the chain.
      return { txHash: txHashFromOutcome(outcome), signerId };
    },
    async signMessage(request): Promise<SignedMessage> {
      const signerId = accountId;
      if (signerId === null) throw new Error('Sign in first.');
      return signMessageWith(await connector.wallet(), signerId, request);
    },
  };
}
