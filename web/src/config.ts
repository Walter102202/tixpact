// Runtime configuration from the build environment (plan, Track W: VITE_NETWORK, VITE_CONTRACT_ID,
// VITE_RPC_URLS, VITE_FIXTURES).

export const DEFAULT_RPC_URLS = ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org'];

export interface AppConfig {
  network: 'testnet';
  /** Null in fixture mode. */
  contractId: string | null;
  rpcUrls: string[];
  /** The screens run on `@ticket-escrow/client` fixtures instead of the chain. */
  fixtureMode: boolean;
}

export interface ConfigEnv {
  VITE_NETWORK?: string | undefined;
  VITE_CONTRACT_ID?: string | undefined;
  VITE_RPC_URLS?: string | undefined;
  VITE_FIXTURES?: string | undefined;
}

/** Fixture mode when asked for, or when no contract is configured (the page then says so). */
export function readConfig(env: ConfigEnv): AppConfig {
  const network = env.VITE_NETWORK?.trim() || 'testnet';
  if (network !== 'testnet') {
    throw new Error(`VITE_NETWORK is "${network}"; this app only runs on testnet.`);
  }
  const contractId = env.VITE_CONTRACT_ID?.trim() || null;
  const rpcUrls = (env.VITE_RPC_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  return {
    network,
    contractId,
    rpcUrls: rpcUrls.length > 0 ? rpcUrls : DEFAULT_RPC_URLS,
    fixtureMode: env.VITE_FIXTURES === '1' || contractId === null,
  };
}
