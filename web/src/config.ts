// Runtime configuration from the build environment (plan, Track W: VITE_NETWORK, VITE_CONTRACT_ID,
// VITE_RPC_URLS, VITE_FIXTURES; interface v2 adds VITE_FAUCET_TOKENS).

export const DEFAULT_RPC_URLS = ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org'];

export interface AppConfig {
  network: 'testnet';
  /** Null in fixture mode. */
  contractId: string | null;
  rpcUrls: string[];
  /** The screens run on `@ticket-escrow/client` fixtures instead of the chain. */
  fixtureMode: boolean;
  /** Token accounts that have a test faucet; the buy panel offers it when a balance is short. */
  faucetTokens: string[];
}

export interface ConfigEnv {
  VITE_NETWORK?: string | undefined;
  VITE_CONTRACT_ID?: string | undefined;
  VITE_RPC_URLS?: string | undefined;
  VITE_FIXTURES?: string | undefined;
  VITE_FAUCET_TOKENS?: string | undefined;
}

/** Fixture mode when asked for, or when no contract is configured (the page then says so). */
export function readConfig(env: ConfigEnv): AppConfig {
  const network = env.VITE_NETWORK?.trim() || 'testnet';
  if (network !== 'testnet') {
    throw new Error(`VITE_NETWORK is "${network}"; this app only runs on testnet.`);
  }
  const contractId = env.VITE_CONTRACT_ID?.trim() || null;
  const rpcUrls = list(env.VITE_RPC_URLS);
  return {
    network,
    contractId,
    rpcUrls: rpcUrls.length > 0 ? rpcUrls : DEFAULT_RPC_URLS,
    fixtureMode: env.VITE_FIXTURES === '1' || contractId === null,
    faucetTokens: list(env.VITE_FAUCET_TOKENS),
  };
}

/** A comma-separated list, trimmed, without empty entries. */
function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
