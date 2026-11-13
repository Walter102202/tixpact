import {
  checkPass,
  decodePass,
  type EntryPass,
  encodePass,
  type PassChain,
  passRequest,
  signedPass,
  type TicketView,
} from '@ticket-escrow/client';
import { MessageSigningUnsupported, type WalletPort } from '../../lib/near/wallet';

// The entry pass in the web app (plan, Task P2): the holder's wallet signs a NEP-413 message, the
// pass travels in the URL fragment (it reaches no server), and the door checks it against the chain.

export const ONLY_HOLDER = 'Only the holder can show the entry pass for this ticket.';
export const CANNOT_SIGN =
  'This wallet cannot sign messages, so it cannot show an entry pass. Sign in with a wallet that can.';

/** Why the holder cannot show a pass for this ticket, or null when they can (the door's rule). */
export function passBlockedReason(ticket: TicketView): string | null {
  if (ticket.status === 'Refunded' || ticket.claim === 'Refunded') {
    return 'This ticket was refunded, so it has no entry pass.';
  }
  if (ticket.status === 'RefundPending') {
    return 'This ticket is being refunded, so it has no entry pass.';
  }
  if (ticket.status === 'TransferPending') {
    return 'This ticket is on its way to another account, so it has no entry pass until that ends.';
  }
  return null;
}

/** The address of the holder's pass page, with the pass in the fragment. */
export const passPagePath = (pass: EntryPass) =>
  `/tickets/${pass.ticket}/pass#p=${encodePass(pass)}`;

/** A chain that agrees with everything: used to check only the signature, before showing a pass. */
const SIGNATURE_ONLY: PassChain = { accessKey: async () => 'full', ticket: async () => null };

export type SignOutcome = { ok: true; pass: EntryPass } | { ok: false; message: string };

/**
 * Asks the wallet to sign a pass for `tokenId`. Call it straight from a click handler: the wallet
 * opens before the first `await`. The answer must come from the signed-in account, and its
 * signature must verify here, so a wallet that signs another form is caught before the door.
 */
export async function signEntryPass(
  wallet: WalletPort,
  contractId: string,
  tokenId: string,
  nowMs: number,
): Promise<SignOutcome> {
  const accountId = wallet.getAccountId();
  if (accountId === null) {
    return { ok: false, message: 'Sign in with the account that holds this ticket.' };
  }
  if (wallet.signMessage === undefined) return { ok: false, message: CANNOT_SIGN };
  const request = passRequest({ contract: contractId, ticket: tokenId, issuedAtMs: nowMs });
  let signed: Awaited<ReturnType<NonNullable<WalletPort['signMessage']>>>;
  try {
    signed = await wallet.signMessage(request);
  } catch (error) {
    if (error instanceof MessageSigningUnsupported) return { ok: false, message: CANNOT_SIGN };
    return {
      ok: false,
      message: 'The wallet did not sign the pass, so nothing is shown. Try again.',
    };
  }
  if (signed.accountId !== accountId) {
    return {
      ok: false,
      message: `The wallet signed as ${signed.accountId}, but ${accountId} is signed in here. Sign the pass with ${accountId}.`,
    };
  }
  const pass = decodePass(encodePass(signedPass(request, signed)));
  const signature =
    pass === null ? null : (await checkPass(pass, contractId, SIGNATURE_ONLY, nowMs)).checks[0];
  if (pass === null || !signature?.ok) {
    return {
      ok: false,
      message:
        "The wallet's answer is not a signature the door can check, so nothing is shown. Try another wallet.",
    };
  }
  return { ok: true, pass };
}

// Admissions are remembered on this device only (threat model, "Entry pass", limit 2).

const storageKey = (contractId: string) => `ticket-escrow:admitted:${contractId}`;

function readAdmissions(contractId: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(storageKey(contractId));
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] =>
        Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

/** When this device marked the ticket as admitted, or null. */
export function admittedAt(contractId: string, tokenId: string): number | null {
  return readAdmissions(contractId)[tokenId] ?? null;
}

/** Records the admission on this device. Returns false when the browser would not store it. */
export function markAdmitted(contractId: string, tokenId: string, atMs: number): boolean {
  try {
    const next = { ...readAdmissions(contractId), [tokenId]: atMs };
    window.localStorage.setItem(storageKey(contractId), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** "21:03" in the viewer's zone. */
export function clockTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(ms);
}

/** "4:59" for a span in milliseconds, rounded up to the second. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
