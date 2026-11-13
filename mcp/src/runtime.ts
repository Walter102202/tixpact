import { createReader, createRpc } from '@ticket-escrow/client';
import type { AgentDeps } from './agent.js';
import { type Env, loadConfig, readAgentKey } from './config.js';
import { createNearSigner } from './signer.js';

/** The only network this server signs on. */
const NETWORK = 'testnet';

export interface RuntimeOptions {
  /** Reads one endpoint's chain id. Tests replace it; the default asks that endpoint's status. */
  chainIdOf?: (url: string) => Promise<string | undefined>;
  /** Told which endpoints the signer will send through (tests use it). */
  onSigningRpc?: (urls: readonly string[]) => void;
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
 * every network.
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
  options.onSigningRpc?.(verified);
  const signer = createNearSigner({
    accountId: config.agentAccountId,
    secretKey: key,
    provider: createRpc(verified),
    chainId: NETWORK,
  });
  return { ...base, signer, signingOffReason: null };
}
