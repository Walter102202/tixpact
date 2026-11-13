import { parseNear } from '@ticket-escrow/client';
import { KeyPair } from 'near-api-js';
import { describe, expect, it } from 'vitest';
import { depsFromEnv } from './runtime.js';

// A key made for this test run; it controls no account.
const SECRET = KeyPair.fromRandom('ed25519').toString();

describe('depsFromEnv', () => {
  it('without a key builds a read-only agent', () => {
    const deps = depsFromEnv({ CONTRACT_ID: 'ticket-escrow.testnet' });
    expect(deps.signer).toBeNull();
    expect(deps.reader.contractId).toBe('ticket-escrow.testnet');
    expect(deps.config.hasKey).toBe(false);
  });

  it('with a key builds a signer for the agent account, and the key stays out of the config', () => {
    const deps = depsFromEnv({
      CONTRACT_ID: 'ticket-escrow.testnet',
      AGENT_ACCOUNT_ID: 'te-d1-agent.testnet',
      AGENT_PRIVATE_KEY: SECRET,
      MAX_PRICE_YOCTO: parseNear('1.5'),
      MAX_EXPOSURE_YOCTO: parseNear('5'),
    });
    expect(deps.signer?.accountId).toBe('te-d1-agent.testnet');
    expect(JSON.stringify(deps.config)).not.toContain(SECRET.slice(8));
  });
});
