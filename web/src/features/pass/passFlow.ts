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
 * Asks the wallet to sign a pass for `tokenId`. Call it straight from a click handler: it asks the
 * wallet before awaiting anything of its own. The answer must come from the signed-in account, and its
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

// Admissions are remembered per ticket on this device only (threat model, "Entry pass", item 2).

/** One admission: when, and which check recorded it (React runs a check twice in development). */
export interface Admission {
  at: number;
  check: string;
}

/** Demo and live runs keep separate records: a demo on this device must not mark a live ticket. */
export const admissionScope = (fixtureMode: boolean, contractId: string) =>
  `${fixtureMode ? 'demo' : 'live'}:${contractId}`;

const storageKey = (scope: string) => `ticket-escrow:admitted:${scope}`;

function isAdmission(value: unknown): value is Admission {
  if (value === null || typeof value !== 'object') return false;
  const { at, check } = value as Record<string, unknown>;
  return typeof at === 'number' && Number.isFinite(at) && typeof check === 'string';
}

function readAdmissions(scope: string): Record<string, Admission> {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, Admission] => isAdmission(entry[1])),
    );
  } catch {
    return {};
  }
}

function writeAdmissions(scope: string, admissions: Record<string, Admission>): boolean {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(admissions));
    return true;
  } catch {
    return false;
  }
}

/** The admission this device recorded for the ticket, or null. */
export function admissionOf(scope: string, tokenId: string): Admission | null {
  return readAdmissions(scope)[tokenId] ?? null;
}

/** Records the admission. Returns false when the browser would not store it. */
export function recordAdmission(scope: string, tokenId: string, admission: Admission): boolean {
  return writeAdmissions(scope, { ...readAdmissions(scope), [tokenId]: admission });
}

/** Forgets the ticket's admission if `check` recorded it (an "Undo" right after a mistaken scan). */
export function forgetAdmission(scope: string, tokenId: string, check: string): boolean {
  const { [tokenId]: current, ...rest } = readAdmissions(scope);
  if (current?.check !== check) return false;
  return writeAdmissions(scope, rest);
}

/** "21:03" in the viewer's zone, or "21:03:10" with seconds. */
export function clockTime(ms: number, timeZone: string, withSeconds = false): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds && { second: '2-digit' }),
    hourCycle: 'h23',
    timeZone,
  }).format(ms);
}

/** "4:59" for a span in milliseconds, rounded up to the second. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
