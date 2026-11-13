import { parseNear } from '@ticket-escrow/client';
import { KeyPair } from 'near-api-js';
import { describe, expect, it } from 'vitest';
import { depsFromEnv } from './runtime.js';

// A key made for this test run; it controls no account.
const SECRET = KeyPair.fromRandom('ed25519').toString();

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

const signing = {
  CONTRACT_ID: 'ticket-escrow.testnet',
  AGENT_ACCOUNT_ID: 'te-d1-agent.testnet',
  AGENT_PRIVATE_KEY: SECRET,
  MAX_PRICE_YOCTO: parseNear('1.5'),
  MAX_EXPOSURE_YOCTO: parseNear('5'),
  RPC_URLS: `${A},${B}`,
};

/**
 * Each endpoint answers its chain id, or fails when it is not in the map. An entry set to undefined
 * is an endpoint that answers its status without a chain id.
 */
function chains(answers: Record<string, string | undefined>) {
  const asked: string[] = [];
  const signingUrls: string[][] = [];
  return {
    asked,
    signingUrls,
    options: {
      chainIdOf: async (url: string) => {
        asked.push(url);
        if (!(url in answers)) throw new Error(`${url} did not answer`);
        return answers[url];
      },
      onSigningRpc: (urls: readonly string[]) => {
        signingUrls.push([...urls]);
      },
    },
  };
}

describe('depsFromEnv', () => {
  it('without a key builds a read-only agent and asks no endpoint anything', async () => {
    const check = chains({});
    const deps = await depsFromEnv({ CONTRACT_ID: 'ticket-escrow.testnet' }, check.options);
    expect(deps.signer).toBeNull();
    expect(deps.signingOffReason ?? null).toBeNull();
    expect(deps.reader.contractId).toBe('ticket-escrow.testnet');
    expect(deps.config.hasKey).toBe(false);
    expect(check.asked).toEqual([]);
  });

  it('with a key and every endpoint on testnet builds a signer, and the key stays out of the config', async () => {
    const check = chains({ [A]: 'testnet', [B]: 'testnet' });
    const deps = await depsFromEnv(signing, check.options);
    expect(deps.signer?.accountId).toBe('te-d1-agent.testnet');
    expect(deps.signingOffReason).toBeNull();
    expect(check.asked.sort()).toEqual([A, B]);
    expect(check.signingUrls).toEqual([[A, B]]);
    expect(JSON.stringify(deps.config)).not.toContain(SECRET.slice(8));
  });

  it('runs read-only when an endpoint is on another network, whatever the environment says', async () => {
    const check = chains({ [A]: 'testnet', [B]: 'mainnet' });
    const deps = await depsFromEnv(signing, check.options);
    expect(deps.signer).toBeNull();
    expect(deps.signingOffReason).toBe('RPC_URLS entry 2 reports chain mainnet, not testnet');
    expect(check.signingUrls).toEqual([]);
  });

  it('runs read-only when no endpoint answers, since the network cannot be confirmed', async () => {
    const check = chains({});
    const deps = await depsFromEnv(signing, check.options);
    expect(deps.signer).toBeNull();
    expect(deps.signingOffReason).toBe(
      'no RPC endpoint answered, so the network could not be confirmed as testnet; restart once one does',
    );
  });

  it('an endpoint that answers without a chain id is not confirmed, and hides no later wrong one', async () => {
    const check = chains({ [A]: undefined, [B]: 'mainnet', [C]: 'testnet' });
    const deps = await depsFromEnv({ ...signing, RPC_URLS: `${A},${B},${C}` }, check.options);
    expect(deps.signer).toBeNull();
    expect(deps.signingOffReason).toBe('RPC_URLS entry 2 reports chain mainnet, not testnet');
  });

  it('a failed read hides no later wrong one either', async () => {
    const check = chains({ [B]: 'mainnet' });
    const deps = await depsFromEnv(signing, check.options);
    expect(deps.signer).toBeNull();
    expect(deps.signingOffReason).toBe('RPC_URLS entry 2 reports chain mainnet, not testnet');
  });

  it('leaves out of signing an endpoint that answered without a chain id', async () => {
    const check = chains({ [A]: undefined, [B]: 'testnet' });
    const deps = await depsFromEnv(signing, check.options);
    expect(deps.signer?.accountId).toBe('te-d1-agent.testnet');
    expect(check.signingUrls).toEqual([[B]]);
  });

  it('signs only through the endpoints that confirmed testnet', async () => {
    const check = chains({ [B]: 'testnet' });
    const deps = await depsFromEnv(signing, check.options);
    expect(deps.signer?.accountId).toBe('te-d1-agent.testnet');
    expect(check.signingUrls).toEqual([[B]]);
  });
});
