import { NearConnector, type WalletManifest } from '@hot-labs/near-connect';
import { describe, expect, it } from 'vitest';
import { limitWallets, signMessageWith, TESTNET_WALLETS } from './connector';
import { MessageSigningUnsupported } from './wallet';

/** A sandbox wallet as the near-connect manifest lists it, with only what the selector reads. */
function wallet(id: string, testnet = true): WalletManifest {
  return {
    id,
    platform: ['web'],
    name: id,
    icon: '',
    description: '',
    website: '',
    version: '1.0.0',
    executor: `https://example.invalid/${id}.js`,
    type: 'sandbox',
    permissions: {},
    features: {
      signMessage: false,
      signTransaction: false,
      signAndSendTransaction: true,
      signAndSendTransactions: false,
      signInWithoutAddKey: false,
      signInAndSignMessage: false,
      signInWithFunctionCallKey: false,
      signDelegateActions: false,
      mainnet: true,
      testnet,
    },
  } as WalletManifest;
}

/** The real connector, over an inline manifest shaped like near-connect's (no network). */
async function connectorWith(wallets: WalletManifest[]): Promise<NearConnector> {
  const connector = new NearConnector({
    network: 'testnet',
    features: { testnet: true, signAndSendTransaction: true },
    manifest: { version: '1.1.0', wallets },
    autoConnect: false,
  });
  await connector.whenManifestLoaded;
  // Registration runs right after the manifest promise settles.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return connector;
}

const ids = (connector: NearConnector) => connector.availableWallets.map((w) => w.manifest.id);

describe('the wallet selector offers only the wallets verified on testnet', () => {
  it('names Meteor and Intear', () => {
    expect(TESTNET_WALLETS).toEqual(['meteor-wallet', 'intear-wallet']);
  });

  it('drops every other testnet wallet in the manifest', async () => {
    const connector = await connectorWith(
      [
        'meteor-wallet',
        'intear-wallet',
        'ledger',
        'nightly-wallet',
        'ethereum-wallets',
        'near-cli',
      ].map((id) => wallet(id)),
    );
    expect(ids(connector)).toEqual([
      'meteor-wallet',
      'intear-wallet',
      'ledger',
      'nightly-wallet',
      'ethereum-wallets',
      'near-cli',
    ]);
    limitWallets(connector, TESTNET_WALLETS);
    expect(ids(connector)).toEqual(['meteor-wallet', 'intear-wallet']);
  });

  it('also drops a wallet a browser extension injects later, which excludedWallets would not', async () => {
    const connector = await connectorWith([wallet('meteor-wallet')]);
    limitWallets(connector, TESTNET_WALLETS);
    window.dispatchEvent(
      new CustomEvent('near-wallet-injected', { detail: { manifest: wallet('some-extension') } }),
    );
    expect(connector.wallets.map((w) => w.manifest.id)).toContain('some-extension');
    expect(ids(connector)).toEqual(['meteor-wallet']);
  });

  it('keeps near-connect’s own testnet filter', async () => {
    const connector = await connectorWith([
      wallet('meteor-wallet', false),
      wallet('intear-wallet'),
    ]);
    limitWallets(connector, TESTNET_WALLETS);
    expect(ids(connector)).toEqual(['intear-wallet']);
  });
});

describe('signing a message through near-connect', () => {
  const request = {
    message: 'Entry pass',
    nonce: new Uint8Array(32),
    recipient: 'ticket-escrow.testnet',
  };

  function fakeWallet(signMessage: boolean) {
    const asked: unknown[] = [];
    const manifest = wallet('meteor-wallet');
    manifest.features.signMessage = signMessage;
    return {
      asked,
      wallet: {
        manifest,
        async signMessage(params: unknown) {
          asked.push(params);
          return { accountId: 'luis.testnet', publicKey: 'ed25519:k', signature: 'c2ln' };
        },
      },
    };
  }

  it('asks the wallet for the signed-in account on testnet and returns its answer as given', async () => {
    const { wallet: w, asked } = fakeWallet(true);
    const signed = await signMessageWith(w, 'luis.testnet', request);
    expect(signed).toEqual({
      accountId: 'luis.testnet',
      publicKey: 'ed25519:k',
      signature: 'c2ln',
    });
    expect(asked).toEqual([{ ...request, network: 'testnet', signerId: 'luis.testnet' }]);
  });

  it('refuses before opening a wallet whose manifest cannot sign messages', async () => {
    const { wallet: w, asked } = fakeWallet(false);
    await expect(signMessageWith(w, 'luis.testnet', request)).rejects.toBeInstanceOf(
      MessageSigningUnsupported,
    );
    expect(asked).toEqual([]);
  });
});
