import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  base64Decode,
  base64Encode,
  baseDecode,
  baseEncode,
  type KeyPair,
  KeyPairEd25519,
  PublicKey,
} from 'near-api-js';
import { z } from 'zod';
import { AccountIdSchema, type TicketView, TokenIdSchema } from './schemas.js';

// An entry pass: a NEP-413 message signed by the holder's wallet, checked at the door against the
// chain. Nothing is sent to the chain or to a server (plan, "Entry pass").

/** A pass admits for five minutes after it is signed. */
export const PASS_TTL_MS = 300_000;
/** A pass dated up to a minute ahead of the checking device is accepted (clock drift). */
export const PASS_SKEW_MS = 60_000;

export type EntryPass = {
  v: 1;
  contract: string;
  ticket: string;
  account: string;
  /** `ed25519:<base58>`. */
  publicKey: string;
  /** Base64 (what wallets return) or `ed25519:<base58>` (what the NEAR CLI prints). */
  signature: string;
  /** Base64 of the 32-byte NEP-413 nonce. */
  nonce: string;
  issuedAtMs: number;
};

export type PassCheck = {
  id: 'signature' | 'key' | 'holder' | 'ticket' | 'fresh';
  ok: boolean;
  /** A sentence a door attendant can act on. */
  detail: string;
};

/** What the door reads from the chain. `createPassChain` is the live one. */
export type PassChain = {
  accessKey(accountId: string, publicKey: string): Promise<'full' | 'function-call' | 'missing'>;
  ticket(tokenId: string): Promise<TicketView | null>;
};

/** NEP-413's tag, 2^31 + 413, so a signed message can never be a valid transaction. */
const NEP413_TAG = 2_147_484_061;
const NONCE_BYTES = 32;
const TIME_BYTES = 8;
const RANDOM_BYTES = NONCE_BYTES - TIME_BYTES;
const SIGNATURE_BYTES = 64;
/** 9999-12-31T23:59:59.999Z: the last instant ISO 8601 writes with a four-digit year. */
const MAX_ISSUED_MS = 253_402_300_799_999;
const FINAL = { finality: 'final' } as const;

/** The four lines the holder signs. The NEP-413 recipient is the contract; no callback URL. */
export function passMessage(p: { contract: string; ticket: string; issuedAtMs: number }): string {
  return [
    'Entry pass',
    `Contract: ${p.contract}`,
    `Ticket: ${p.ticket}`,
    `Issued: ${new Date(p.issuedAtMs).toISOString()}`,
  ].join('\n');
}

/** 32 bytes: the time of issue as 8 bytes big-endian milliseconds, then 24 random bytes. */
export function passNonce(issuedAtMs: number, random: Uint8Array): Uint8Array {
  if (random.length !== RANDOM_BYTES) {
    throw new Error(`a pass nonce needs exactly ${RANDOM_BYTES} random bytes`);
  }
  const nonce = new Uint8Array(NONCE_BYTES);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(issuedAtMs));
  nonce.set(random, TIME_BYTES);
  return nonce;
}

/**
 * SHA-256 of the NEP-413 tag (u32 little-endian) followed by the Borsh encoding of
 * `{ message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> = None }`.
 */
export function nep413Hash(p: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
}): Uint8Array {
  if (p.nonce.length !== NONCE_BYTES) throw new Error('a NEP-413 nonce is exactly 32 bytes');
  const message = new TextEncoder().encode(p.message);
  const recipient = new TextEncoder().encode(p.recipient);
  const bytes = new Uint8Array(4 + 4 + message.length + NONCE_BYTES + 4 + recipient.length + 1);
  const view = new DataView(bytes.buffer);
  let at = 0;
  view.setUint32(at, NEP413_TAG, true);
  at += 4;
  view.setUint32(at, message.length, true);
  at += 4;
  bytes.set(message, at);
  at += message.length;
  bytes.set(p.nonce, at);
  at += NONCE_BYTES;
  view.setUint32(at, recipient.length, true);
  at += 4;
  bytes.set(recipient, at);
  // The last byte stays 0: Borsh's `None` for the callback URL.
  return sha256(bytes);
}

/** What a wallet is asked to sign for a pass, with the facts the pass repeats. */
export interface PassRequest {
  contract: string;
  ticket: string;
  issuedAtMs: number;
  message: string;
  nonce: Uint8Array;
  recipient: string;
}

/** A request for a fresh pass. `random` is for tests; by default 24 bytes from `crypto`. */
export function passRequest(p: {
  contract: string;
  ticket: string;
  issuedAtMs: number;
  random?: Uint8Array;
}): PassRequest {
  const random = p.random ?? crypto.getRandomValues(new Uint8Array(RANDOM_BYTES));
  return {
    contract: p.contract,
    ticket: p.ticket,
    issuedAtMs: p.issuedAtMs,
    message: passMessage(p),
    nonce: passNonce(p.issuedAtMs, random),
    recipient: p.contract,
  };
}

/** The pass from a signer's answer (a wallet's `signMessage`, or our own key). */
export function signedPass(
  request: PassRequest,
  signed: { accountId: string; publicKey: string; signature: string },
): EntryPass {
  return {
    v: 1,
    contract: request.contract,
    ticket: request.ticket,
    account: signed.accountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
    nonce: base64Encode(request.nonce),
    issuedAtMs: request.issuedAtMs,
  };
}

/** Signs a pass with a key held here: the agent's, or a demo key. */
export function signPassWithKey(request: PassRequest, accountId: string, key: KeyPair): EntryPass {
  const { signature } = key.sign(nep413Hash(request));
  return signedPass(request, {
    accountId,
    publicKey: key.getPublicKey().toString(),
    signature: base64Encode(signature),
  });
}

/**
 * The built-in key of a demo account (fixture mode only). Derived from the account name, so it is
 * the same on every device and controls nothing on any chain.
 */
export function demoPassKey(accountId: string): KeyPair {
  const seed = sha256(new TextEncoder().encode(`ticket-escrow demo pass key for ${accountId}`));
  return new KeyPairEd25519(baseEncode(seed));
}

const PassSchema = z.object({
  v: z.literal(1),
  contract: AccountIdSchema,
  ticket: TokenIdSchema,
  account: AccountIdSchema,
  publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  signature: z.string().min(1).max(200),
  nonce: z.string().min(1).max(100),
  issuedAtMs: z.int().min(0).max(MAX_ISSUED_MS),
});

const toBase64Url = (bytes: Uint8Array) =>
  base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Base64 or base64url, padded or not; null when it is neither. */
function fromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) return null;
  const plain = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (plain.length % 4 === 1) return null;
  try {
    return base64Decode(plain.padEnd(Math.ceil(plain.length / 4) * 4, '='));
  } catch {
    return null;
  }
}

/** Base64url of the pass's JSON: nothing in it needs escaping in a URL fragment. */
export function encodePass(pass: EntryPass): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(pass)));
}

/** A bare pass, or any URL carrying `#p=<pass>`; null for anything else. */
export function decodePass(text: string): EntryPass | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const hash = trimmed.indexOf('#');
  const encoded =
    hash === -1 ? trimmed : new URLSearchParams(trimmed.slice(hash + 1)).get('p')?.trim();
  if (!encoded) return null;
  const bytes = fromBase64(encoded);
  if (bytes === null) return null;
  try {
    const parsed = PassSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The door page's link for a pass: the pass travels in the fragment, which reaches no server. */
export function doorUrl(siteUrl: string, pass: EntryPass): string {
  return `${siteUrl.replace(/\/+$/, '')}/door#p=${encodePass(pass)}`;
}

/** A signature as wallets return it (base64) or as the NEAR CLI prints it (`ed25519:<base58>`). */
function signatureBytes(text: string): Uint8Array | null {
  if (text.startsWith('ed25519:')) {
    try {
      return baseDecode(text.slice('ed25519:'.length));
    } catch {
      return null;
    }
  }
  return fromBase64(text);
}

function publicKeyOf(text: string): PublicKey | null {
  if (!text.startsWith('ed25519:')) return null;
  try {
    return PublicKey.fromString(text);
  } catch {
    return null;
  }
}

const ASK_AGAIN = 'Ask the holder to sign a new pass.';
const DAMAGED = `This pass is damaged: part of it cannot be read. ${ASK_AGAIN}`;

function checkSignature(pass: EntryPass, contractId: string): PassCheck {
  const no = (detail: string): PassCheck => ({ id: 'signature', ok: false, detail });
  if (pass.contract !== contractId) {
    return no(`This pass is for ${pass.contract}, not ${contractId}: it does not admit here.`);
  }
  const nonce = fromBase64(pass.nonce);
  const signature = signatureBytes(pass.signature);
  const key = publicKeyOf(pass.publicKey);
  if (nonce?.length !== NONCE_BYTES || signature?.length !== SIGNATURE_BYTES || key === null) {
    return no(DAMAGED);
  }
  const issued = new DataView(nonce.buffer, nonce.byteOffset).getBigUint64(0);
  if (issued !== BigInt(pass.issuedAtMs)) {
    return no(
      `The time on this pass is not the time that was signed: it was altered. ${ASK_AGAIN}`,
    );
  }
  const hash = nep413Hash({ message: passMessage(pass), nonce, recipient: pass.contract });
  let verified = false;
  try {
    // RFC 8032 strict, not near-api-js's default (ZIP-215): ZIP-215 accepts small-order keys such
    // as the all-zero key of the implicit account 000…0, whose "signatures" need no private key.
    verified = ed25519.verify(signature, hash, key.data, { zip215: false });
  } catch {
    verified = false;
  }
  if (!verified) {
    return no(
      `The signature does not match this pass: it was altered or signed by another key. ${ASK_AGAIN}`,
    );
  }
  return {
    id: 'signature',
    ok: true,
    detail: `The pass names ${contractId} and its signature checks out.`,
  };
}

const UNREAD = 'The chain could not be read, so this was not checked. Try again.';

function checkKey(
  pass: EntryPass,
  key: PromiseSettledResult<'full' | 'function-call' | 'missing'>,
): PassCheck {
  const no = (detail: string): PassCheck => ({ id: 'key', ok: false, detail });
  if (key.status === 'rejected') return no(UNREAD);
  switch (key.value) {
    case 'full':
      return {
        id: 'key',
        ok: true,
        detail: `The signing key is a full-access key of ${pass.account}.`,
      };
    case 'function-call':
      return no(
        `The pass was signed with a limited key of ${pass.account} that apps can hold, not with a full-access key. Ask the holder to sign it from their wallet.`,
      );
    case 'missing':
      return no(
        `The key that signed this pass is not a key of ${pass.account} now: it was deleted or never belonged to it. ${ASK_AGAIN}`,
      );
  }
}

function checkHolder(
  pass: EntryPass,
  contractId: string,
  ticket: PromiseSettledResult<TicketView | null>,
): PassCheck {
  const no = (detail: string): PassCheck => ({ id: 'holder', ok: false, detail });
  if (ticket.status === 'rejected') return no(UNREAD);
  if (ticket.value === null) return no(`Ticket ${pass.ticket} does not exist on ${contractId}.`);
  if (ticket.value.owner_id !== pass.account) {
    return no(
      `${pass.account} signed this pass but no longer holds ticket ${pass.ticket}. The holder is ${ticket.value.owner_id}.`,
    );
  }
  return { id: 'holder', ok: true, detail: `${pass.account} holds ticket ${pass.ticket}.` };
}

function checkTicket(
  pass: EntryPass,
  contractId: string,
  ticket: PromiseSettledResult<TicketView | null>,
): PassCheck {
  const no = (detail: string): PassCheck => ({ id: 'ticket', ok: false, detail });
  if (ticket.status === 'rejected') return no(UNREAD);
  const t = ticket.value;
  const id = pass.ticket;
  if (t === null) return no(`Ticket ${id} does not exist on ${contractId}.`);
  if (t.status === 'Refunded' || t.claim === 'Refunded') {
    return no(`Ticket ${id} was refunded: it no longer admits anyone.`);
  }
  if (t.status === 'RefundPending')
    return no(`Ticket ${id} is being refunded: it no longer admits anyone.`);
  if (t.status === 'TransferPending') {
    return no(`Ticket ${id} is on its way to another account: it cannot admit until that ends.`);
  }
  return { id: 'ticket', ok: true, detail: `Ticket ${id} is active and has not been refunded.` };
}

/** "45 s", "4 min 30 s", "2 min". */
function span(ms: number): string {
  const seconds = Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function checkFresh(pass: EntryPass, nowMs: number): PassCheck {
  if (!Number.isFinite(nowMs)) {
    return {
      id: 'fresh',
      ok: false,
      detail: "This device's clock could not be read, so the time was not checked. Try again.",
    };
  }
  const age = nowMs - pass.issuedAtMs;
  if (age > PASS_TTL_MS) {
    return {
      id: 'fresh',
      ok: false,
      detail: `This pass expired ${span(age - PASS_TTL_MS)} ago: a pass admits for 5 minutes after it is signed. Ask the holder to sign a new one.`,
    };
  }
  if (age < -PASS_SKEW_MS) {
    return {
      id: 'fresh',
      ok: false,
      detail: `This pass is dated ${span(-age)} ahead of this device's clock. Check the clock here, or ask the holder to sign a new pass.`,
    };
  }
  const signed = age <= 0 ? 'Signed just now' : `Signed ${span(age)} ago`;
  return {
    id: 'fresh',
    ok: true,
    detail: `${signed}; it admits for ${span(PASS_TTL_MS - Math.max(age, 0))} more.`,
  };
}

const CHECK_IDS = ['signature', 'key', 'holder', 'ticket', 'fresh'] as const;

/**
 * The door's verdict: always the five checks, in this order. `admitted` is all five. A chain that
 * cannot be read fails the checks that need it, never admits. A pass that is not a pass (it did
 * not come through `decodePass`) fails all five without reading the chain.
 */
export async function checkPass(
  given: EntryPass,
  contractId: string,
  chain: PassChain,
  nowMs: number,
): Promise<{ admitted: boolean; checks: PassCheck[] }> {
  const valid = PassSchema.safeParse(given);
  if (!valid.success) {
    return { admitted: false, checks: CHECK_IDS.map((id) => ({ id, ok: false, detail: DAMAGED })) };
  }
  const pass = valid.data;
  const [key, ticket] = await Promise.allSettled([
    chain.accessKey(pass.account, pass.publicKey),
    chain.ticket(pass.ticket),
  ]);
  const checks: PassCheck[] = [
    checkSignature(pass, contractId),
    checkKey(pass, key),
    checkHolder(pass, contractId, ticket),
    checkTicket(pass, contractId, ticket),
    checkFresh(pass, nowMs),
  ];
  return { admitted: checks.every((c) => c.ok), checks };
}

/** The one RPC read the live chain needs besides the reader. `FailoverRpcProvider` satisfies it. */
export interface PassRpc {
  viewAccessKeyList(params: {
    accountId: string;
    finalityQuery: typeof FINAL;
    afterKey?: string;
  }): Promise<unknown>;
}

const AccessKeyListPageSchema = z.object({
  keys: z.array(
    z.object({ public_key: z.string(), access_key: z.object({ permission: z.unknown() }) }),
  ),
  last_key: z.string().nullish(),
});

/** Pages of keys read before giving up; the reader's account proof uses the same bound. */
const MAX_KEY_PAGES = 100;

/**
 * The demo chain (fixture mode): every account's only full-access key is its built-in demo key
 * (`demoPassKey`), and tickets come from the fixture reader. Demo passes work end to end.
 */
export function createFixturePassChain(reader: {
  getTicket(tokenId: string): Promise<TicketView | null>;
}): PassChain {
  return {
    accessKey: async (accountId, publicKey) =>
      demoPassKey(accountId).getPublicKey().toString() === publicKey ? 'full' : 'missing',
    ticket: (tokenId) => reader.getTicket(tokenId),
  };
}

/**
 * The live chain for `checkPass`: the access key and the ticket, both read at `final`.
 *
 * The key is looked up in the account's key list, not asked for by name: `view_access_key` answers
 * a missing key with an error, which near-api-js's failover takes for a broken endpoint (it logs
 * it and asks the next one), while a deleted key or a changed account is an ordinary answer at a
 * door. The list answers with a definite "not there", and on testnet an account that does not exist
 * reads as an empty list (both endpoints, 2026-11-13). A list read that fails still rejects, so the
 * check reads "the chain could not be read" (threat model E9).
 */
export function createPassChain(
  reader: { getTicket(tokenId: string): Promise<TicketView | null> },
  rpc: PassRpc,
): PassChain {
  return {
    async accessKey(accountId, publicKey) {
      let afterKey: string | undefined;
      for (let page = 0; page < MAX_KEY_PAGES; page += 1) {
        const list = AccessKeyListPageSchema.parse(
          await rpc.viewAccessKeyList(
            afterKey === undefined
              ? { accountId, finalityQuery: FINAL }
              : { accountId, finalityQuery: FINAL, afterKey },
          ),
        );
        const found = list.keys.find((key) => key.public_key === publicKey);
        if (found) return found.access_key.permission === 'FullAccess' ? 'full' : 'function-call';
        if (!list.last_key) return 'missing';
        afterKey = list.last_key;
      }
      throw new Error(`view_access_key_list did not end for ${accountId}`);
    },
    ticket: (tokenId) => reader.getTicket(tokenId),
  };
}
