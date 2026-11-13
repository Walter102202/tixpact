// Starts the MCP server over stdio: `node mcp/dist/bin/serve.js` (after `pnpm build`).
// Configuration comes from the environment (docs/mcp.md). Logs go to stderr; stdout is the protocol.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from '../config.js';
import { createRedactor, quietConsole, type Redact } from '../redact.js';
import { depsFromEnv } from '../runtime.js';
import { createServer, SERVER_NAME } from '../server.js';

let redact: Redact = (text) => text;

async function main(): Promise<void> {
  // Before anything touches the RPC: near-api-js prints every failed endpoint with console.error.
  redact = createRedactor(loadConfig(process.env).rpcUrls);
  quietConsole(redact);
  const deps = await depsFromEnv(process.env);
  await createServer(deps).connect(new StdioServerTransport());
  const mode =
    deps.signer !== null
      ? `signing as ${deps.signer.accountId}`
      : `read-only (${deps.signingOffReason ?? 'no key configured'})`;
  process.stderr.write(
    `${redact(`${SERVER_NAME} on ${deps.config.network}: contract ${deps.config.contractId}, ${mode}.`)}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${redact(error instanceof ConfigError ? message : `Could not start: ${message}`)}\n`,
  );
  process.exit(1);
});
