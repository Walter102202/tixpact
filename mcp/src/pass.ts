import {
  doorUrl,
  encodePass,
  PASS_TTL_MS,
  passRequest,
  type Reader,
  signedPass,
} from '@ticket-escrow/client';
import type { AgentConfig } from './config.js';
import { when } from './format.js';
import type { ToolInput, ToolOutput } from './schemas.js';
import type { AgentSigner } from './signer.js';

// `show_entry_pass`: the agent signs a NEP-413 entry pass for a ticket it holds. Nothing is sent to
// the chain; the door checks the pass against the chain (plan, "Entry pass").

export interface PassDeps {
  config: AgentConfig;
  reader: Reader;
  signer: AgentSigner | null;
  signingOffReason?: string | null;
  /** The clock the pass is dated with (tests fix it). */
  now?: () => number;
}

const NOTHING_SIGNED = 'Nothing was signed.';

/**
 * Refuses, with a sentence, when the agent cannot sign or does not hold an active ticket; the
 * refusal is thrown and becomes a tool error. Otherwise signs and returns the pass.
 */
export async function showEntryPass(
  deps: PassDeps,
  { token_id }: ToolInput<'show_entry_pass'>,
): Promise<ToolOutput<'show_entry_pass'>> {
  const { signer, config } = deps;
  if (signer === null) {
    const off = deps.signingOffReason ?? null;
    throw new Error(
      off === null
        ? 'No key configured: set AGENT_PRIVATE_KEY with AGENT_ACCOUNT_ID to let the agent show entry passes.'
        : `Signing is off: ${off}. ${NOTHING_SIGNED}`,
    );
  }
  if (signer.signMessage === undefined) {
    throw new Error(
      `This signer cannot sign messages, so it cannot show entry passes. ${NOTHING_SIGNED}`,
    );
  }
  const agent = signer.accountId;
  const ticket = await deps.reader.getTicket(token_id);
  if (ticket === null) throw new Error(`Ticket ${token_id} does not exist.`);
  if (ticket.owner_id !== agent) {
    throw new Error(
      `Ticket ${token_id} is held by ${ticket.owner_id}, not by ${agent}: only its holder can show its entry pass. ${NOTHING_SIGNED}`,
    );
  }
  // The same rule the door applies: a pass for such a ticket would never admit anyone.
  if (ticket.status === 'Refunded' || ticket.claim === 'Refunded') {
    throw new Error(
      `Ticket ${token_id} was refunded: it no longer admits anyone. ${NOTHING_SIGNED}`,
    );
  }
  if (ticket.status === 'RefundPending') {
    throw new Error(
      `Ticket ${token_id} is being refunded: it no longer admits anyone. ${NOTHING_SIGNED}`,
    );
  }
  if (ticket.status === 'TransferPending') {
    throw new Error(
      `Ticket ${token_id} is on its way to another account: it cannot admit until that ends. ${NOTHING_SIGNED}`,
    );
  }

  const request = passRequest({
    contract: config.contractId,
    ticket: token_id,
    issuedAtMs: (deps.now ?? Date.now)(),
  });
  const signed = await signer.signMessage(request);
  const pass = signedPass(request, { accountId: agent, ...signed });
  const site = config.siteUrl ?? null;
  return {
    pass,
    encoded: encodePass(pass),
    door_url: site === null ? null : doorUrl(site, pass),
    expires_at_ms: pass.issuedAtMs + PASS_TTL_MS,
  };
}

export function formatEntryPass(output: ToolOutput<'show_entry_pass'>): string {
  const { pass, encoded, door_url, expires_at_ms } = output;
  return [
    `# Entry pass for ticket ${pass.ticket}`,
    '',
    `Signed by ${pass.account} at ${when(pass.issuedAtMs)}. It admits until ${when(expires_at_ms)} (five minutes); after that, ask for a new one.`,
    door_url === null
      ? `Pass: ${encoded}`
      : `Door link (open it, or show it as a QR code, at the entrance): ${door_url}`,
    `Anyone can check it against the chain with \`node scripts/pass.mjs verify <pass>\`${door_url === null ? '' : ' or by opening the link'}. It is valid only while ${pass.account} still holds the ticket and the key that signed it.`,
    'Nothing was sent to the chain.',
  ].join('\n');
}
