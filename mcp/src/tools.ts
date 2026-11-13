import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Agent } from './agent.js';
import {
  describeError,
  formatContractProof,
  formatEvent,
  formatEvents,
  formatMyTickets,
  formatTicket,
  formatWallet,
  formatWrite,
} from './format.js';
import { formatEntryPass } from './pass.js';
import { type Redact, redactDeep } from './redact.js';
import { INPUT, OUTPUT, TOOL_NAMES, type ToolName } from './schemas.js';

export type { AgentDeps as ToolDeps } from './agent.js';
export { TOOL_NAMES };

type ToolMeta = { title: string; description: string; readOnly: boolean; destructive: boolean };

const TOOL_META: Record<ToolName, ToolMeta> = {
  list_events: {
    title: 'List events',
    description:
      'List the events of the ticket contract with their phase, price, tickets sold, start time and verifier. Paged: from_index and limit (at most 50).',
    readOnly: true,
    destructive: false,
  },
  get_event: {
    title: 'Get event',
    description:
      'Read one event: terms, who confirms it (the verifier), the confirmation deadline, what triggers a refund, the outcome so far and how much ticket money the contract holds for it.',
    readOnly: true,
    destructive: false,
  },
  get_ticket: {
    title: 'Get ticket',
    description:
      'Read one ticket (each ticket is an NFT, NEP-171): its holder, the price it keeps reserved, whether it can be claimed now, and its history.',
    readOnly: true,
    destructive: false,
  },
  list_my_tickets: {
    title: 'List my tickets',
    description:
      "List the tickets the agent's own account holds, and the exposure the cap counts: the price of every ticket still reserved, claimable or being refunded.",
    readOnly: true,
    destructive: false,
  },
  get_wallet: {
    title: 'Get wallet',
    description:
      "Read the agent's account: balance, the per-ticket cap, the exposure cap, the exposure now and what is left under it, and whether signing is on.",
    readOnly: true,
    destructive: false,
  },
  verify_contract: {
    title: 'Verify contract',
    description:
      'Check the ticket contract itself: its code hash, how many access keys it has (zero means nobody can change it), and whether its balances cover what it owes ticket holders and organizers, in NEAR and in each token it accepts.',
    readOnly: true,
    destructive: false,
  },
  buy_ticket: {
    title: 'Buy ticket',
    description:
      "Buy one ticket for an event priced in NEAR that is on sale, paying exactly its price from the agent's own account. Denied without signing when the event is priced in a token (the caps are in NEAR), when the price is above the per-ticket cap, or when the purchase would take the exposure above its cap.",
    readOnly: false,
    destructive: false,
  },
  transfer_ticket: {
    title: 'Transfer ticket',
    description:
      'Give a ticket the agent holds to another account, before the event starts. The right to the refund goes with the ticket: the agent can no longer claim it.',
    readOnly: false,
    destructive: true,
  },
  expire_event: {
    title: 'Expire event',
    description:
      'Switch an event to refunds once its confirmation deadline has passed without an outcome. Anyone may do it; it costs only gas.',
    readOnly: false,
    destructive: false,
  },
  claim_refund: {
    title: 'Claim refund',
    description:
      'Claim back the price of a ticket the agent holds, once its event is cancelled or its deadline passed without confirmation. Reports a refund only when the money actually moved.',
    readOnly: false,
    destructive: false,
  },
  show_entry_pass: {
    title: 'Show entry pass',
    description:
      "Sign a five-minute entry pass for a ticket the agent holds, to show at the door: a NEP-413 message signed with the agent's key, plus the door link when SITE_URL is set. It signs no transaction and sends nothing to the chain. Refused for a ticket the agent does not hold or that was refunded.",
    readOnly: true,
    destructive: false,
  },
};

/** Generic in the name, so the SDK infers each tool's own argument type from its schema. */
function meta<N extends ToolName>(name: N) {
  const { title, description, readOnly, destructive } = TOOL_META[name];
  const inputSchema: (typeof INPUT)[N] = INPUT[name];
  const outputSchema: (typeof OUTPUT)[N] = OUTPUT[name];
  return {
    title,
    description,
    inputSchema,
    outputSchema,
    annotations: {
      title,
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      idempotentHint: readOnly,
      // The tools read and write a public blockchain, not a closed local system.
      openWorldHint: true,
    },
  };
}

/** Registers the eleven tools, in `TOOL_NAMES` order, over one agent. */
export function registerTools(
  server: McpServer,
  agent: Agent,
  redact: Redact = (text) => text,
): void {
  // The output boundary: everything a tool returns passes through `redact` (no RPC URL leaves).
  const result = <T extends Record<string, unknown>>(text: string, structuredContent: T) => ({
    content: [{ type: 'text' as const, text: redact(text) }],
    structuredContent: redactDeep(structuredContent, redact),
  });

  /** Turns an unexpected failure (an RPC down, a missing event) into a tool error with one sentence. */
  async function guarded<R>(
    run: () => Promise<R>,
  ): Promise<R | { isError: true; content: Array<{ type: 'text'; text: string }> }> {
    try {
      return await run();
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: redact(describeError(error)) }] };
    }
  }

  server.registerTool('list_events', meta('list_events'), async (input) =>
    guarded(async () => {
      const output = await agent.listEvents(input);
      return result(formatEvents(output, input.from_index), output);
    }),
  );
  server.registerTool('get_event', meta('get_event'), async (input) =>
    guarded(async () => {
      const output = await agent.getEvent(input);
      return result(formatEvent(output), output);
    }),
  );
  server.registerTool('get_ticket', meta('get_ticket'), async (input) =>
    guarded(async () => {
      const output = await agent.getTicket(input);
      return result(formatTicket(output), output);
    }),
  );
  server.registerTool('list_my_tickets', meta('list_my_tickets'), async () =>
    guarded(async () => {
      const output = await agent.listMyTickets();
      return result(formatMyTickets(output), output);
    }),
  );
  server.registerTool('get_wallet', meta('get_wallet'), async () =>
    guarded(async () => {
      const output = await agent.getWallet();
      return result(formatWallet(output), output);
    }),
  );
  server.registerTool('verify_contract', meta('verify_contract'), async () =>
    guarded(async () => {
      const output = await agent.verifyContract();
      return result(formatContractProof(output), output);
    }),
  );
  server.registerTool('buy_ticket', meta('buy_ticket'), async (input) =>
    guarded(async () => {
      const output = await agent.buyTicket(input);
      return result(formatWrite(output), output);
    }),
  );
  server.registerTool('transfer_ticket', meta('transfer_ticket'), async (input) =>
    guarded(async () => {
      const output = await agent.transferTicket(input);
      return result(formatWrite(output), output);
    }),
  );
  server.registerTool('expire_event', meta('expire_event'), async (input) =>
    guarded(async () => {
      const output = await agent.expireEvent(input);
      return result(formatWrite(output), output);
    }),
  );
  server.registerTool('claim_refund', meta('claim_refund'), async (input) =>
    guarded(async () => {
      const output = await agent.claimRefund(input);
      return result(formatWrite(output), output);
    }),
  );
  server.registerTool('show_entry_pass', meta('show_entry_pass'), async (input) =>
    guarded(async () => {
      const output = await agent.showEntryPass(input);
      return result(formatEntryPass(output), output);
    }),
  );
}
