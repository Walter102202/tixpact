import { NearConnector, type WalletManifest } from '@hot-labs/near-connect';
import { describe, expect, it } from 'vitest';
import { limitWallets, TESTNET_WALLETS } from './connector';

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
