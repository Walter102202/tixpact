import { createReader, createRpc } from '@ticket-escrow/client';
import type { AgentDeps } from './agent.js';
import { type Env, loadConfig, readAgentKey } from './config.js';
import { createNearSigner } from './signer.js';

/**
 * Everything the server and the watcher need, built from the environment: one failover RPC for
 * reads, transaction tracking and signing, and a signer only when a key is configured. Makes no
 * network call; the signer checks the chain id before its first signature.
 */
export function depsFromEnv(env: Env): AgentDeps {
  const config = loadConfig(env);
  const rpc = createRpc(config.rpcUrls);
  const key = readAgentKey(env);
  // loadConfig refuses a key without an account, so both are set or the signer stays off.
  const signer =
    key === null || config.agentAccountId === null
      ? null
      : createNearSigner({ accountId: config.agentAccountId, secretKey: key, provider: rpc });
  return {
    config,
    reader: createReader({ contractId: config.contractId, rpc }),
    txRpc: rpc,
    signer,
  };
}
