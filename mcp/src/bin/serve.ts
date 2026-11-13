// Starts the MCP server over stdio: `node mcp/dist/bin/serve.js` (after `pnpm build`).
// Configuration comes from the environment (docs/mcp.md). Logs go to stderr; stdout is the protocol.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError } from '../config.js';
import { depsFromEnv } from '../runtime.js';
import { createServer, SERVER_NAME } from '../server.js';

async function main(): Promise<void> {
  const deps = depsFromEnv(process.env);
  await createServer(deps).connect(new StdioServerTransport());
  const mode =
    deps.signer === null ? 'read-only (no key configured)' : `signing as ${deps.signer.accountId}`;
  console.error(
    `${SERVER_NAME} on ${deps.config.network}: contract ${deps.config.contractId}, ${mode}.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error instanceof ConfigError ? message : `Could not start: ${message}`);
  process.exit(1);
});
