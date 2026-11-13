// The refund watcher: `pnpm --filter @ticket-escrow/mcp agent:watch` (after `pnpm build`).
// A plain loop that expires and claims the agent's tickets every 30 s, until Ctrl+C.

import { createAgent } from '../agent.js';
import { ConfigError, loadConfig } from '../config.js';
import { createRedactor, quietConsole, type Redact } from '../redact.js';
import { depsFromEnv } from '../runtime.js';
import { WATCH_INTERVAL_MS, watch } from '../watch.js';

let redact: Redact = (text) => text;

async function main(): Promise<void> {
  // Before anything touches the RPC: near-api-js prints every failed endpoint with console.error.
  redact = createRedactor(loadConfig(process.env).rpcUrls);
  quietConsole(redact);
  const deps = await depsFromEnv(process.env);
  if (deps.signer === null && deps.signingOffReason) {
    throw new ConfigError(
      `The watcher signs expiries and claims, but signing is off: ${deps.signingOffReason}.`,
    );
  }
  if (deps.signer === null) {
    throw new ConfigError(
      'The watcher signs expiries and claims, so it needs AGENT_PRIVATE_KEY with AGENT_ACCOUNT_ID and both caps.',
    );
  }
  // The first Ctrl+C stops before the next call; the round in progress sends nothing more.
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  await watch({
    agent: createAgent(deps),
    intervalMs: WATCH_INTERVAL_MS,
    signal: controller.signal,
    redact,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${redact(error instanceof ConfigError ? message : `Watcher stopped: ${message}`)}\n`,
  );
  process.exit(1);
});
