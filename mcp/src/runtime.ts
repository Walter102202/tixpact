import { createReader, createRpc } from '@ticket-escrow/client';
import { FailoverRpcError } from 'near-api-js';
import { AccessKeyDoesNotExistError, AccountDoesNotExistError } from 'near-api-js/rpc-errors';
import type { AgentDeps } from './agent.js';
import { type Env, loadConfig, readAgentKey } from './config.js';
import { createNearSigner, publicKeyOf } from './signer.js';

/** The only network this server signs on. */
const NETWORK = 'testnet';

export interface RuntimeOptions {
  /** Reads one endpoint's chain id. Tests replace it; the default asks that endpoint's status. */
  chainIdOf?: (url: string) => Promise<string | undefined>;
  /** Reads what the key may do on the agent account. Tests replace it. */
  accessKeyOf?: (
    accountId: string,
    publicKey: string,
    urls: readonly string[],
  ) => Promise<KeyStanding>;
  /** Told which endpoints the signer will send through (tests use it). */
  onSigningRpc?: (urls: readonly string[]) => void;
}

/** What a public key is on an account: a full-access key, a function-call key, or not a key. */
export type KeyStanding = 'full_access' | 'function_call' | 'missing';

async function accessKeyOfUrls(
  accountId: string,
  publicKey: string,
  urls: readonly string[],
): Promise<KeyStanding> {
  try {
    const key = await createRpc(urls).viewAccessKey({ accountId, publicKey });
    return key.permission === 'FullAccess' ? 'full_access' : 'function_call';
  } catch (error) {
    const errors = error instanceof FailoverRpcError ? [...error.errors] : [error];
    const missing = (e: unknown) =>
      e instanceof AccessKeyDoesNotExistError || e instanceof AccountDoesNotExistError;
    if (errors.length > 0 && errors.every(missing)) return 'missing';
    throw error;
  }
}

const chainIdOfUrl = async (url: string): Promise<string | undefined> =>
  (await createRpc([url]).viewNodeStatus()).chain_id;

/** A chain id worth comparing, or null: a failed read and an answer without one confirm nothing. */
const chainOf = (answer: unknown): string | null =>
  typeof answer === 'string' && answer !== '' ? answer : null;

/** A chain id as a node reported it, shown only when it looks like one. */
const shown = (chain: string) => (/^[\w.-]{1,40}$/.test(chain) ? chain : 'with an unreadable id');

/**
 * Everything the server and the watcher need, built from the environment: one failover RPC for
 * reads and transaction tracking, and a signer only when a key is configured and the network is
 * confirmed. Before the signer exists, every endpoint is asked its chain id: one that answers
 * another network turns signing off, and the signer sends only through endpoints that answered
 * testnet; a failed read or an answer without a chain id confirms nothing. No endpoint confirming
 * turns signing off too. The signer checks again before every signature (signer.ts). That stops a
 * misconfigured endpoint; one that lies about its chain id could still feed it another chain's
 * block, which is why only named `.testnet` accounts are accepted (config.ts): a signature then
 * spends only from that `.testnet` name, never from the implicit account the same key controls on
 * every network. Last, the key's public key is read on AGENT_ACCOUNT_ID: signing stays off unless it
 * is a full-access key there.
 */
export async function depsFromEnv(env: Env, options: RuntimeOptions = {}): Promise<AgentDeps> {
  const config = loadConfig(env);
  const rpc = createRpc(config.rpcUrls);
  const base = {
    config,
    reader: createReader({ contractId: config.contractId, rpc }),
    txRpc: rpc,
  };
  const key = readAgentKey(env);
  // loadConfig refuses a key without an account, so both are set or the signer stays off.
  if (key === null || config.agentAccountId === null) {
    return { ...base, signer: null, signingOffReason: null };
  }
  const off = (reason: string): AgentDeps => ({ ...base, signer: null, signingOffReason: reason });

  const chainIdOf = options.chainIdOf ?? chainIdOfUrl;
  const answers = await Promise.all(
    config.rpcUrls.map((url) => chainIdOf(url).then(chainOf, () => null)),
  );
  // Any endpoint naming another chain turns signing off, wherever it sits in the list.
  for (const [index, chain] of answers.entries()) {
    if (chain !== null && chain !== NETWORK) {
      return off(`RPC_URLS entry ${index + 1} reports chain ${shown(chain)}, not ${NETWORK}`);
    }
  }
  const verified = config.rpcUrls.filter((_, index) => answers[index] === NETWORK);
  if (verified.length === 0) {
    return off(
      `no RPC endpoint answered, so the network could not be confirmed as ${NETWORK}; restart once one does`,
    );
  }

  const accessKeyOf = options.accessKeyOf ?? accessKeyOfUrls;
  const publicKey = publicKeyOf(key);
  let standing: KeyStanding;
  try {
    standing = await accessKeyOf(config.agentAccountId, publicKey, verified);
  } catch {
    return off(
      'the access key of AGENT_ACCOUNT_ID could not be read, so the key could not be checked; restart once the RPC answers',
    );
  }
  if (standing === 'missing') {
    return off('the key in AGENT_PRIVATE_KEY is not an access key of AGENT_ACCOUNT_ID');
  }
  if (standing === 'function_call') {
    return off(
      'the key in AGENT_PRIVATE_KEY is a function-call key of AGENT_ACCOUNT_ID, which cannot attach the deposits buy_ticket and claim_refund need; use a full-access key',
    );
  }

  options.onSigningRpc?.(verified);
  const signer = createNearSigner({
    accountId: config.agentAccountId,
    secretKey: key,
    provider: createRpc(verified),
    chainId: NETWORK,
  });
  return { ...base, signer, signingOffReason: null };
}
