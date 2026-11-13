import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type AgentDeps, createAgent } from './agent.js';
import { near } from './format.js';
import { registerTools } from './tools.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export const SERVER_NAME = 'ticket-escrow-agent';

function instructions(deps: AgentDeps): string {
  const { config } = deps;
  const caps =
    config.caps === null
      ? 'No caps are configured, so it cannot sign.'
      : `Caps: at most ${near(config.caps.maxPriceYocto)} per ticket and ${near(config.caps.maxExposureYocto)} of exposure in total.`;
  return [
    `Event tickets on NEAR ${config.network}, from the contract ${config.contractId}. Each ticket keeps its price reserved in the contract: the organizer is paid only after the agreed verifier confirms the event, and if the event is cancelled or the deadline passes without confirmation, whoever holds the ticket can claim the price back.`,
    deps.signer === null
      ? 'This server is read-only: no key is configured, so buy_ticket, transfer_ticket, expire_event and claim_refund are denied.'
      : `The agent signs from its own account ${deps.signer.accountId}, and only buy_ticket, nft_transfer, expire_event and claim_refund on ${config.contractId}. ${caps} A call outside these limits is denied before anything is signed.`,
    'Start with list_events and get_event; get_wallet shows the caps and how much is left under them.',
  ].join('\n\n');
}

/** A server bound to one agent configuration. Connect it to a transport (stdio in production). */
export function createServer(deps: AgentDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version },
    { instructions: instructions(deps) },
  );
  registerTools(server, createAgent(deps));
  return server;
}
