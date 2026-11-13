// The refund watcher: `pnpm --filter @ticket-escrow/mcp agent:watch` (after `pnpm build`).
// A plain loop that expires and claims the agent's tickets every 30 s, until Ctrl+C.

import { createAgent } from '../agent.js';
import { ConfigError } from '../config.js';
import { depsFromEnv } from '../runtime.js';
import { WATCH_INTERVAL_MS, watch } from '../watch.js';

async function main(): Promise<void> {
  const deps = depsFromEnv(process.env);
  if (deps.signer === null) {
    throw new ConfigError(
      'The watcher signs expiries and claims, so it needs AGENT_PRIVATE_KEY with AGENT_ACCOUNT_ID and both caps.',
    );
  }
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  await watch({
    agent: createAgent(deps),
    intervalMs: WATCH_INTERVAL_MS,
    signal: controller.signal,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error instanceof ConfigError ? message : `Watcher stopped: ${message}`);
  process.exit(1);
});
