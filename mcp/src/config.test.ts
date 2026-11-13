import { parseNear } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_RPC_URLS, loadConfig, readAgentKey } from './config.js';

// A well-formed ed25519 secret key made up for these tests; it controls no account.
const FAKE_KEY = `ed25519:${'3'.repeat(88)}`;

const readOnly = { CONTRACT_ID: 'ticket-escrow.testnet' };
const signing = {
  CONTRACT_ID: 'ticket-escrow.testnet',
  AGENT_ACCOUNT_ID: 'agent.testnet',
  AGENT_PRIVATE_KEY: FAKE_KEY,
  MAX_PRICE_YOCTO: parseNear('1.5'),
  MAX_EXPOSURE_YOCTO: parseNear('5'),
};

function configError(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('runs read-only with only the contract, on testnet and the default endpoints', () => {
    expect(loadConfig(readOnly)).toEqual({
      network: 'testnet',
      contractId: 'ticket-escrow.testnet',
      rpcUrls: [...DEFAULT_RPC_URLS],
      agentAccountId: null,
      caps: null,
      hasKey: false,
      siteUrl: null,
    });
  });

  it('reads the account, the caps and whether a key is set, but never keeps the key', () => {
    const config = loadConfig({ ...signing, RPC_URLS: 'https://a.example, https://b.example' });
    expect(config).toEqual({
      network: 'testnet',
      contractId: 'ticket-escrow.testnet',
      rpcUrls: ['https://a.example', 'https://b.example'],
      agentAccountId: 'agent.testnet',
      caps: { maxPriceYocto: parseNear('1.5'), maxExposureYocto: parseNear('5') },
      hasKey: true,
      siteUrl: null,
    });
    expect(JSON.stringify(config)).not.toContain(FAKE_KEY);
  });

  it('treats empty variables as unset', () => {
    expect(
      loadConfig({ ...readOnly, NEAR_NETWORK: '', RPC_URLS: '', AGENT_PRIVATE_KEY: '' }),
    ).toMatchObject({ network: 'testnet', rpcUrls: [...DEFAULT_RPC_URLS], hasKey: false });
  });

  it('refuses any network but testnet', () => {
    expect(configError({ ...readOnly, NEAR_NETWORK: 'mainnet' }).message).toBe(
      'NEAR_NETWORK must be testnet: this server never signs on another network.',
    );
  });

  it('accepts only .testnet accounts, naming the variable but not its value', () => {
    const notTestnet = (name: string) =>
      `${name} must be an account ending in .testnet: this server only runs on testnet (the value is not shown).`;
    expect(configError({ CONTRACT_ID: 'tickets.near' }).message).toBe(notTestnet('CONTRACT_ID'));
    const agent = configError({ ...signing, AGENT_ACCOUNT_ID: 'agent.near' }).message;
    expect(agent).toBe(notTestnet('AGENT_ACCOUNT_ID'));
    expect(agent).not.toContain('agent.near');
    // An implicit account is the same account on every network, so it is refused too.
    const implicit = 'a'.repeat(64);
    expect(configError({ ...signing, AGENT_ACCOUNT_ID: implicit }).message).toBe(
      notTestnet('AGENT_ACCOUNT_ID'),
    );
    expect(configError({ CONTRACT_ID: implicit }).message).toBe(notTestnet('CONTRACT_ID'));
    expect(configError({ CONTRACT_ID: 'escrow.testnet.near' }).message).toBe(
      notTestnet('CONTRACT_ID'),
    );
    expect(loadConfig({ CONTRACT_ID: 'te-d3-escrow.testnet' }).contractId).toBe(
      'te-d3-escrow.testnet',
    );
  });

  it('never repeats a value it refuses, even one shaped like a key', () => {
    // Someone pasting the key into the wrong variable must not see it printed back in a log.
    const misplaced = configError({ ...signing, AGENT_ACCOUNT_ID: FAKE_KEY }).message;
    expect(misplaced).toBe('AGENT_ACCOUNT_ID is not a NEAR account id (the value is not shown).');
    expect(misplaced).not.toContain(FAKE_KEY.slice(8, 20));
    const secretUrl = 'https://rpc.example/?apikey=s3cr3t-token';
    const rpc = configError({ ...readOnly, RPC_URLS: 'https://a.example,ftp://x.example' }).message;
    expect(rpc).toBe('RPC_URLS entry 2 is not an https URL (the value is not shown).');
    const plain = configError({ ...readOnly, RPC_URLS: secretUrl.replace('https', 'http') });
    expect(plain.message).toBe('RPC_URLS entry 1 is not an https URL (the value is not shown).');
    expect(plain.message).not.toContain('s3cr3t');
  });

  it('needs a contract id', () => {
    expect(configError({}).message).toContain('CONTRACT_ID');
  });

  it('with a key, needs the account and both caps (it never signs without limits)', () => {
    expect(configError({ ...signing, AGENT_ACCOUNT_ID: undefined }).message).toBe(
      'AGENT_ACCOUNT_ID is required when AGENT_PRIVATE_KEY is set.',
    );
    expect(configError({ ...signing, MAX_PRICE_YOCTO: undefined }).message).toBe(
      'MAX_PRICE_YOCTO and MAX_EXPOSURE_YOCTO are required when AGENT_PRIVATE_KEY is set.',
    );
    expect(configError({ ...signing, MAX_EXPOSURE_YOCTO: '' }).message).toBe(
      'MAX_PRICE_YOCTO and MAX_EXPOSURE_YOCTO are required when AGENT_PRIVATE_KEY is set.',
    );
  });

  it('wants caps as yoctoNEAR decimal strings', () => {
    expect(configError({ ...signing, MAX_PRICE_YOCTO: '1.5' }).message).toContain(
      'MAX_PRICE_YOCTO',
    );
  });

  it('needs both caps or neither', () => {
    expect(configError({ ...readOnly, MAX_PRICE_YOCTO: '1' }).message).toBe(
      'Set both MAX_PRICE_YOCTO and MAX_EXPOSURE_YOCTO, or neither.',
    );
  });

  it('rejects a malformed key without repeating it', () => {
    const badKey = 'ed25519:not-base58-0OIl';
    const error = configError({ ...signing, AGENT_PRIVATE_KEY: badKey });
    expect(error.message).toBe(
      'AGENT_PRIVATE_KEY must be a secret key like ed25519:<base58>; the value given is not one.',
    );
    expect(error.message).not.toContain(badKey);
  });

  it('accepts only https RPC URLs', () => {
    expect(configError({ ...readOnly, RPC_URLS: 'ftp://x.example' }).message).toContain('RPC_URLS');
    expect(configError({ ...readOnly, RPC_URLS: 'http://rpc.testnet.near.org' }).message).toContain(
      'not an https URL',
    );
  });
});

describe('SITE_URL', () => {
  it('is where the door links of entry passes point, https or a local address', () => {
    expect(loadConfig({ ...readOnly, SITE_URL: 'https://tickets.example/' }).siteUrl).toBe(
      'https://tickets.example/',
    );
    expect(loadConfig({ ...readOnly, SITE_URL: 'http://localhost:5173' }).siteUrl).toBe(
      'http://localhost:5173',
    );
    expect(loadConfig({ ...readOnly, SITE_URL: ' ' }).siteUrl).toBeNull();
  });

  it('refuses anything else, naming the variable', () => {
    for (const url of ['http://tickets.example', 'javascript:alert(1)', 'tickets.example']) {
      expect(configError({ ...readOnly, SITE_URL: url }).message, url).toBe(
        'SITE_URL must be an https URL (or http://localhost) where the web app is served.',
      );
    }
  });
});

describe('readAgentKey', () => {
  it('returns the key only to the caller that builds the signer', () => {
    expect(readAgentKey(signing)).toBe(FAKE_KEY);
    expect(readAgentKey(readOnly)).toBeNull();
  });
});
