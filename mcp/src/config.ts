import { AccountIdSchema, YoctoSchema } from '@ticket-escrow/client';
import { z } from 'zod';

// Configuration from the environment. It fails closed: testnet only, only `.testnet` account names, and
// a key is accepted only together with the agent account and both caps. The key itself is never
// part of the returned config (so it cannot end up in a log or a tool result); only the signer
// factory reads it, through `readAgentKey`.

export const DEFAULT_RPC_URLS = [
  'https://test.rpc.fastnear.com',
  'https://near-testnet.drpc.org',
] as const;

export interface Caps {
  /** Largest price of one ticket, in yoctoNEAR. */
  maxPriceYocto: string;
  /** Largest total principal of the tickets the agent holds, in yoctoNEAR. */
  maxExposureYocto: string;
}

export interface AgentConfig {
  network: 'testnet';
  /** The one contract the agent reads and calls. */
  contractId: string;
  rpcUrls: string[];
  /** The agent's own account, or null when the server only reads events and tickets. */
  agentAccountId: string | null;
  /** Null only when no key is configured. */
  caps: Caps | null;
  /** Whether `AGENT_PRIVATE_KEY` is set. Without it every write tool is denied. */
  hasKey: boolean;
}

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** A curve-prefixed base58 secret key, the form near-cli and near-api-js use. */
const SECRET_KEY = /^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{32,128}$/;

// https only: the RPC answers what the agent reads before it signs, so nobody on the path may
// change those answers.
const UrlSchema = z.url({ protocol: /^https$/ });

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw === undefined || raw === '' ? undefined : raw;
}

function account(env: Env, name: string): string | undefined {
  const raw = value(env, name);
  if (raw === undefined) return undefined;
  // The messages name the variable, never its value: a key pasted into the wrong variable must not
  // be printed back into a log.
  if (!AccountIdSchema.safeParse(raw).success) {
    throw new ConfigError(`${name} is not a NEAR account id (the value is not shown).`);
  }
  // Named testnet accounts only. A mainnet name is refused, and so is an implicit (64-hex) id: the
  // same key controls it on every network, so a signature for it could be valid elsewhere.
  if (!raw.endsWith('.testnet')) {
    throw new ConfigError(
      `${name} must be an account ending in .testnet: this server only runs on testnet (the value is not shown).`,
    );
  }
  return raw;
}

function yocto(env: Env, name: string): string | undefined {
  const raw = value(env, name);
  if (raw === undefined) return undefined;
  if (!YoctoSchema.safeParse(raw).success) {
    throw new ConfigError(
      `${name} must be a whole number of yoctoNEAR (1 NEAR is 1 followed by 24 zeros).`,
    );
  }
  return raw;
}

/** Reads and checks the configuration. Throws `ConfigError` with a sentence naming the variable. */
export function loadConfig(env: Env): AgentConfig {
  const network = value(env, 'NEAR_NETWORK') ?? 'testnet';
  if (network !== 'testnet') {
    throw new ConfigError(
      'NEAR_NETWORK must be testnet: this server never signs on another network.',
    );
  }

  const contractId = account(env, 'CONTRACT_ID');
  if (contractId === undefined) {
    throw new ConfigError('CONTRACT_ID is required: the account of the ticket contract.');
  }

  const rpcText = value(env, 'RPC_URLS');
  const rpcUrls =
    rpcText === undefined
      ? [...DEFAULT_RPC_URLS]
      : rpcText
          .split(',')
          .map((url) => url.trim())
          .filter((url) => url !== '');
  rpcUrls.forEach((url, index) => {
    // An RPC URL can carry an API key, so the message gives its position, not the URL.
    if (!UrlSchema.safeParse(url).success) {
      throw new ConfigError(
        `RPC_URLS entry ${index + 1} is not an https URL (the value is not shown).`,
      );
    }
  });

  const agentAccountId = account(env, 'AGENT_ACCOUNT_ID') ?? null;
  const maxPrice = yocto(env, 'MAX_PRICE_YOCTO');
  const maxExposure = yocto(env, 'MAX_EXPOSURE_YOCTO');
  const hasKey = readAgentKey(env) !== null;

  if (hasKey && agentAccountId === null) {
    throw new ConfigError('AGENT_ACCOUNT_ID is required when AGENT_PRIVATE_KEY is set.');
  }
  if (hasKey && (maxPrice === undefined || maxExposure === undefined)) {
    throw new ConfigError(
      'MAX_PRICE_YOCTO and MAX_EXPOSURE_YOCTO are required when AGENT_PRIVATE_KEY is set.',
    );
  }
  if ((maxPrice === undefined) !== (maxExposure === undefined)) {
    throw new ConfigError('Set both MAX_PRICE_YOCTO and MAX_EXPOSURE_YOCTO, or neither.');
  }
  const caps =
    maxPrice === undefined || maxExposure === undefined
      ? null
      : { maxPriceYocto: maxPrice, maxExposureYocto: maxExposure };

  return { network: 'testnet', contractId, rpcUrls, agentAccountId, caps, hasKey };
}

/**
 * The agent's secret key, or null when none is set. Only the signer factory calls this. A malformed
 * key throws without repeating its value.
 */
export function readAgentKey(env: Env): string | null {
  const key = value(env, 'AGENT_PRIVATE_KEY');
  if (key === undefined) return null;
  if (!SECRET_KEY.test(key)) {
    throw new ConfigError(
      'AGENT_PRIVATE_KEY must be a secret key like ed25519:<base58>; the value given is not one.',
    );
  }
  return key;
}
