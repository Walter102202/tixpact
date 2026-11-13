// Smoke test of the MCP server over stdio, against a deployed contract (plan, Task M2):
//
//   pnpm build
//   CONTRACT_ID=<contract>.testnet pnpm --filter @ticket-escrow/mcp smoke
//
// It starts the built server as a child process, exactly as an MCP client does, lists the tools and
// calls list_events and verify_contract. With AGENT_PRIVATE_KEY (plus AGENT_ACCOUNT_ID and both
// caps) it also buys one ticket within the caps and prints the transaction link: the first event
// on sale at or below the per-ticket cap, or SMOKE_EVENT_ID. Exits non-zero on any failure.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const EXPECTED_TOOLS = 10;
const PASSED_ON = [
  'NEAR_NETWORK',
  'CONTRACT_ID',
  'RPC_URLS',
  'AGENT_ACCOUNT_ID',
  'AGENT_PRIVATE_KEY',
  'MAX_PRICE_YOCTO',
  'MAX_EXPOSURE_YOCTO',
];

const entry = fileURLToPath(new URL('../dist/bin/serve.js', import.meta.url));
if (!existsSync(entry)) {
  console.error(`${entry} is missing: run pnpm build first.`);
  process.exit(1);
}

// The child gets the SDK's safe defaults plus our variables, nothing else from this shell.
const env = getDefaultEnvironment();
for (const name of PASSED_ON) {
  const value = process.env[name];
  if (value) env[name] = value;
}
const signing = Boolean(env.AGENT_PRIVATE_KEY);

const client = new Client({ name: 'ticket-escrow-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env,
  stderr: 'inherit',
});

async function tool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  console.log(`\n## ${name} ${JSON.stringify(args)}\n${text}`);
  if (result.isError) throw new Error(`${name} returned an error`);
  return result.structuredContent;
}

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`Tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
  if (tools.length !== EXPECTED_TOOLS) throw new Error(`expected ${EXPECTED_TOOLS} tools`);

  const { events } = await tool('list_events');
  await tool('verify_contract');

  if (!signing) {
    console.log('\nNo AGENT_PRIVATE_KEY: read-only run, nothing bought.');
  } else {
    const wallet = await tool('get_wallet');
    const eventId = process.env.SMOKE_EVENT_ID
      ? Number(process.env.SMOKE_EVENT_ID)
      : events.find((e) => e.phase === 'OnSale' && BigInt(e.price) <= BigInt(wallet.max_price))
          ?.event_id;
    if (eventId === undefined) {
      throw new Error(
        'No event is on sale within the per-ticket cap: create one or set SMOKE_EVENT_ID.',
      );
    }
    const bought = await tool('buy_ticket', { event_id: eventId });
    if (bought.status !== 'succeeded') throw new Error(`buy_ticket ended ${bought.status}`);
    console.log(`\nBought ticket ${bought.value}: ${bought.explorer_url}`);
  }
  console.log('\nSmoke passed.');
} catch (error) {
  console.error(`\nSmoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
