import { baseDecode, KeyPairSigner, type KeyPairString, PublicKey } from 'near-api-js';
import { describe, expect, it } from 'vitest';
import { createFixtureReader } from './fixtures.js';
import {
  checkPass,
  createFixturePassChain,
  createPassChain,
  decodePass,
  demoPassKey,
  doorUrl,
  type EntryPass,
  encodePass,
  nep413Hash,
  PASS_SKEW_MS,
  PASS_TTL_MS,
  type PassChain,
  passMessage,
  passNonce,
  passRequest,
  signedPass,
  signPassWithKey,
} from './pass.js';
import type { TicketView } from './schemas.js';

// The known-answer vector of the plan ("Entry pass"), signed by near-cli-rs 0.31.1, not by this
// code. Its signature step must accept it: that is the evidence a real wallet's signature verifies.
const KAT = {
  contract: 'ticket-escrow.testnet',
  ticket: '1-1',
  issuedAtMs: Date.parse('2026-11-13T16:30:00.000Z'),
  message:
    'Entry pass\nContract: ticket-escrow.testnet\nTicket: 1-1\nIssued: 2026-11-13T16:30:00.000Z',
  nonce: 'AAABodW+l0AICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  account: 'te-d1-luis.testnet',
  publicKey: 'ed25519:DYoE7CvF7PtSBrCdmu96Y8yZPsWhnYYt3vP2ygTXH79S',
  signature:
    'ed25519:ZQFWWD6ZAFSE1TJ5oSKoHpSWMihvSRaXVrK71ctXj99uQwv4VFFrWw9o4RSab9pKXNULvnDEgLTAi9fJdQHXfmi',
};

const KAT_PASS: EntryPass = {
  v: 1,
  contract: KAT.contract,
  ticket: KAT.ticket,
  account: KAT.account,
  publicKey: KAT.publicKey,
  signature: KAT.signature,
  nonce: KAT.nonce,
  issuedAtMs: KAT.issuedAtMs,
};

function ticketView(overrides: Partial<TicketView> = {}): TicketView {
  return {
    token_id: '1-1',
    event_id: 1,
    serial: 1,
    owner_id: KAT.account,
    principal: '500000000000000000000000',
    status: 'Active',
    claim: 'Reserved',
    pending_operation_id: null,
    currency: null,
    ...overrides,
  };
}

/** A chain that answers from fixed values and records what it was asked. */
function fakeChain(
  key: 'full' | 'function-call' | 'missing',
  ticket: TicketView | null,
): PassChain & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async accessKey(accountId, publicKey) {
      asked.push(`key ${accountId} ${publicKey}`);
      return key;
    },
    async ticket(tokenId) {
      asked.push(`ticket ${tokenId}`);
      return ticket;
    },
  };
}

const ids = (checks: Array<{ id: string; ok: boolean }>) =>
  checks.map((c) => `${c.id}:${c.ok ? 'ok' : 'NO'}`);

const failed = (checks: Array<{ id: string; ok: boolean }>) =>
  checks.filter((c) => !c.ok).map((c) => c.id);

/** The wallet form of the same signature: its raw bytes in base64. */
const base64FromBase58Signature = (signature: string): string =>
  Buffer.from(baseDecode(signature.replace('ed25519:', ''))).toString('base64');

describe('the known-answer vector signed by near-cli-rs', () => {
  it('rebuilds the exact message and nonce that were signed', () => {
    expect(passMessage(KAT)).toBe(KAT.message);
    const random = Uint8Array.from({ length: 24 }, (_, i) => i + 8);
    expect(Buffer.from(passNonce(KAT.issuedAtMs, random)).toString('base64')).toBe(KAT.nonce);
  });

  it('admits the pass when the chain agrees', async () => {
    const chain = fakeChain('full', ticketView());
    const result = await checkPass(KAT_PASS, KAT.contract, chain, KAT.issuedAtMs + 10_000);
    expect(ids(result.checks)).toEqual([
      'signature:ok',
      'key:ok',
      'holder:ok',
      'ticket:ok',
      'fresh:ok',
    ]);
    expect(result.admitted).toBe(true);
    expect(chain.asked).toContain(`key ${KAT.account} ${KAT.publicKey}`);
    expect(chain.asked).toContain('ticket 1-1');
  });

  it('accepts the same signature in base64, the form wallets return', async () => {
    const pass = { ...KAT_PASS, signature: base64FromBase58Signature(KAT.signature) };
    const result = await checkPass(
      pass,
      KAT.contract,
      fakeChain('full', ticketView()),
      KAT.issuedAtMs,
    );
    expect(result.checks[0]).toMatchObject({ id: 'signature', ok: true });
  });

  it('fails the signature when the ticket in the message changes', async () => {
    const pass = { ...KAT_PASS, ticket: '1-2' };
    const chain = fakeChain('full', ticketView({ token_id: '1-2', serial: 2 }));
    const result = await checkPass(pass, KAT.contract, chain, KAT.issuedAtMs);
    expect(failed(result.checks)).toEqual(['signature']);
    expect(result.admitted).toBe(false);
    expect(result.checks[0]?.detail).toContain('Ask the holder to sign a new pass');
  });

  it('fails the signature when the time of issue changes', async () => {
    const pass = { ...KAT_PASS, issuedAtMs: KAT.issuedAtMs + 1_000 };
    const result = await checkPass(
      pass,
      KAT.contract,
      fakeChain('full', ticketView()),
      pass.issuedAtMs,
    );
    expect(failed(result.checks)).toEqual(['signature']);
  });

  it('fails the signature when the nonce changes', async () => {
    const bytes = Buffer.from(KAT.nonce, 'base64');
    bytes[31] = (bytes[31] ?? 0) ^ 1;
    const pass = { ...KAT_PASS, nonce: bytes.toString('base64') };
    const result = await checkPass(
      pass,
      KAT.contract,
      fakeChain('full', ticketView()),
      KAT.issuedAtMs,
    );
    expect(failed(result.checks)).toEqual(['signature']);
  });

  it('fails the signature when the recipient changes', async () => {
    const other = 'other-escrow.testnet';
    const pass = { ...KAT_PASS, contract: other };
    const result = await checkPass(pass, other, fakeChain('full', ticketView()), KAT.issuedAtMs);
    expect(failed(result.checks)).toEqual(['signature']);
  });

  it('fails the signature when the pass names another contract than the door checks', async () => {
    const result = await checkPass(
      KAT_PASS,
      'other-escrow.testnet',
      fakeChain('full', ticketView()),
      KAT.issuedAtMs,
    );
    expect(failed(result.checks)).toEqual(['signature']);
    expect(result.checks[0]?.detail).toBe(
      'This pass is for ticket-escrow.testnet, not other-escrow.testnet: it does not admit here.',
    );
  });

  it('fails the signature when the signature changes', async () => {
    const bytes = Buffer.from(base64FromBase58Signature(KAT.signature), 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const pass = { ...KAT_PASS, signature: bytes.toString('base64') };
    const result = await checkPass(
      pass,
      KAT.contract,
      fakeChain('full', ticketView()),
      KAT.issuedAtMs,
    );
    expect(failed(result.checks)).toEqual(['signature']);
  });

  it('fails the signature, without throwing, when the signature or key cannot be read', async () => {
    for (const pass of [
      { ...KAT_PASS, signature: 'not a signature' },
      { ...KAT_PASS, signature: Buffer.alloc(63).toString('base64') },
      { ...KAT_PASS, publicKey: 'ed25519:abc' },
      { ...KAT_PASS, nonce: Buffer.alloc(31).toString('base64') },
    ]) {
      const result = await checkPass(
        pass,
        KAT.contract,
        fakeChain('full', ticketView()),
        KAT.issuedAtMs,
      );
      expect(result.checks[0], pass.signature).toMatchObject({ id: 'signature', ok: false });
      expect(result.admitted).toBe(false);
    }
  });

  it('fails the key, not the signature, when the account changes: NEP-413 does not sign it', async () => {
    // The account is bound by the key check: the signing key must be a full-access key of it.
    const pass = { ...KAT_PASS, account: 'mallory.testnet' };
    const chain = fakeChain('missing', ticketView({ owner_id: 'mallory.testnet' }));
    const result = await checkPass(pass, KAT.contract, chain, KAT.issuedAtMs);
    expect(failed(result.checks)).toEqual(['key']);
    expect(result.admitted).toBe(false);
    expect(chain.asked).toContain(`key mallory.testnet ${KAT.publicKey}`);
  });
});

describe('nep413Hash', () => {
  it('is the hash near-api-js signs for a NEP-413 message', async () => {
    const signer = KeyPairSigner.fromSecretKey(
      demoPassKey('ana.testnet').toString() as KeyPairString,
    );
    const payload = {
      message: KAT.message,
      nonce: passNonce(KAT.issuedAtMs, new Uint8Array(24)),
      recipient: KAT.contract,
    };
    const signed = await signer.signNep413Message('ana.testnet', payload);
    expect(signed.publicKey.verify(nep413Hash(payload), signed.signature)).toBe(true);
  });
});

describe('passNonce and passMessage', () => {
  it('puts the time of issue in the first 8 bytes, big-endian, then the 24 random bytes', () => {
    const random = new Uint8Array(24).fill(7);
    const nonce = passNonce(258, random);
    expect(nonce.length).toBe(32);
    expect([...nonce.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 1, 2]);
    expect([...nonce.slice(8)]).toEqual([...random]);
  });

  it('refuses random bytes that are not exactly 24', () => {
    expect(() => passNonce(1, new Uint8Array(23))).toThrow('24 random bytes');
  });

  it('is four lines with the time in ISO 8601 UTC with milliseconds', () => {
    expect(
      passMessage({ contract: 'c.testnet', ticket: '5-1', issuedAtMs: 0 }).split('\n'),
    ).toEqual([
      'Entry pass',
      'Contract: c.testnet',
      'Ticket: 5-1',
      'Issued: 1970-01-01T00:00:00.000Z',
    ]);
  });
});

// The other four checks, one failing at a time, on passes signed in the test with a demo key.
const ANA = 'ana.testnet';
const LUIS = 'luis.testnet';
const CONTRACT = 'ticket-escrow.testnet';
const ISSUED = Date.parse('2026-11-13T21:00:00.000Z');

function anaPass(issuedAtMs = ISSUED): EntryPass {
  const request = passRequest({
    contract: CONTRACT,
    ticket: '5-1',
    issuedAtMs,
    random: new Uint8Array(24).fill(3),
  });
  return signPassWithKey(request, ANA, demoPassKey(ANA));
}

const anaTicket = (overrides: Partial<TicketView> = {}) =>
  ticketView({ token_id: '5-1', event_id: 5, owner_id: ANA, ...overrides });

describe('checkPass, one check failing at a time', () => {
  it('admits a pass signed with a full-access key by the holder of an active ticket', async () => {
    const result = await checkPass(
      anaPass(),
      CONTRACT,
      fakeChain('full', anaTicket()),
      ISSUED + 30_000,
    );
    expect(result.admitted).toBe(true);
    expect(result.checks.map((c) => c.detail)).toEqual([
      'The pass names ticket-escrow.testnet and its signature checks out.',
      'The signing key is a full-access key of ana.testnet.',
      'ana.testnet holds ticket 5-1.',
      'Ticket 5-1 is active and has not been refunded.',
      'Signed 30 s ago; it admits for 4 min 30 s more.',
    ]);
  });

  it('holder: the ticket was transferred after the pass was signed', async () => {
    const chain = fakeChain('full', anaTicket({ owner_id: LUIS }));
    const result = await checkPass(anaPass(), CONTRACT, chain, ISSUED);
    expect(failed(result.checks)).toEqual(['holder']);
    expect(result.checks[2]?.detail).toBe(
      'ana.testnet signed this pass but no longer holds ticket 5-1. The holder is luis.testnet.',
    );
  });

  it('key: a function-call key signed it', async () => {
    const result = await checkPass(
      anaPass(),
      CONTRACT,
      fakeChain('function-call', anaTicket()),
      ISSUED,
    );
    expect(failed(result.checks)).toEqual(['key']);
    expect(result.checks[1]?.detail).toBe(
      'The pass was signed with a limited key of ana.testnet that apps can hold, not with a full-access key. Ask the holder to sign it from their wallet.',
    );
  });

  it('key: the key was deleted after signing', async () => {
    const result = await checkPass(anaPass(), CONTRACT, fakeChain('missing', anaTicket()), ISSUED);
    expect(failed(result.checks)).toEqual(['key']);
    expect(result.checks[1]?.detail).toBe(
      'The key that signed this pass is not a key of ana.testnet now: it was deleted or never belonged to it. Ask the holder to sign a new pass.',
    );
  });

  it('ticket: the ticket was refunded', async () => {
    const chain = fakeChain('full', anaTicket({ status: 'Refunded', claim: 'Refunded' }));
    const result = await checkPass(anaPass(), CONTRACT, chain, ISSUED);
    expect(failed(result.checks)).toEqual(['ticket']);
    expect(result.checks[3]?.detail).toBe('Ticket 5-1 was refunded: it no longer admits anyone.');
  });

  it('ticket: a refund or a transfer to a contract is in flight', async () => {
    const refunding = await checkPass(
      anaPass(),
      CONTRACT,
      fakeChain(
        'full',
        anaTicket({ status: 'RefundPending', claim: 'RefundPending', pending_operation_id: 3 }),
      ),
      ISSUED,
    );
    expect(failed(refunding.checks)).toEqual(['ticket']);
    expect(refunding.checks[3]?.detail).toBe(
      'Ticket 5-1 is being refunded: it no longer admits anyone.',
    );
    const moving = await checkPass(
      anaPass(),
      CONTRACT,
      fakeChain('full', anaTicket({ status: 'TransferPending' })),
      ISSUED,
    );
    expect(failed(moving.checks)).toEqual(['ticket']);
  });

  it('fresh: a pass six minutes old', async () => {
    const result = await checkPass(
      anaPass(),
      CONTRACT,
      fakeChain('full', anaTicket()),
      ISSUED + 6 * 60_000,
    );
    expect(failed(result.checks)).toEqual(['fresh']);
    expect(result.checks[4]?.detail).toBe(
      'This pass expired 1 min ago: a pass admits for 5 minutes after it is signed. Ask the holder to sign a new one.',
    );
  });

  it('fresh: a pass dated two minutes ahead of this device', async () => {
    const result = await checkPass(
      anaPass(),
      CONTRACT,
      fakeChain('full', anaTicket()),
      ISSUED - 2 * 60_000,
    );
    expect(failed(result.checks)).toEqual(['fresh']);
    expect(result.checks[4]?.detail).toBe(
      "This pass is dated 2 min ahead of this device's clock. Check the clock here, or ask the holder to sign a new pass.",
    );
  });

  it('fresh: the edges are inclusive', async () => {
    const chain = fakeChain('full', anaTicket());
    const atTtl = await checkPass(anaPass(), CONTRACT, chain, ISSUED + PASS_TTL_MS);
    const atSkew = await checkPass(anaPass(), CONTRACT, chain, ISSUED - PASS_SKEW_MS);
    const pastTtl = await checkPass(anaPass(), CONTRACT, chain, ISSUED + PASS_TTL_MS + 1);
    const pastSkew = await checkPass(anaPass(), CONTRACT, chain, ISSUED - PASS_SKEW_MS - 1);
    expect([atTtl.admitted, atSkew.admitted, pastTtl.admitted, pastSkew.admitted]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('holder and ticket: a ticket that does not exist', async () => {
    const result = await checkPass(anaPass(), CONTRACT, fakeChain('full', null), ISSUED);
    expect(failed(result.checks)).toEqual(['holder', 'ticket']);
    expect(result.checks[2]?.detail).toBe('Ticket 5-1 does not exist on ticket-escrow.testnet.');
  });

  it('a chain that cannot be read fails the checks it answers, and still returns all five', async () => {
    const down: PassChain = {
      accessKey: async () => {
        throw new Error('rpc down');
      },
      ticket: async () => {
        throw new Error('rpc down');
      },
    };
    const result = await checkPass(anaPass(), CONTRACT, down, ISSUED);
    expect(ids(result.checks)).toEqual([
      'signature:ok',
      'key:NO',
      'holder:NO',
      'ticket:NO',
      'fresh:ok',
    ]);
    expect(result.checks[1]?.detail).toBe(
      'The chain could not be read, so this was not checked. Try again.',
    );
  });
});

describe('checkPass against forged and malformed input', () => {
  // The implicit account 000…0 exists for anyone to create; its key is the all-zero key, a point
  // of small order. Under ZIP-215 (near-api-js's default) this "signature" verifies with no key.
  const ZERO_ACCOUNT = '0'.repeat(64);
  const ZERO_KEY = `ed25519:${'1'.repeat(32)}`;
  const forged = (): EntryPass => {
    const nonce = passNonce(ISSUED, new Uint8Array(24));
    return {
      v: 1,
      contract: CONTRACT,
      ticket: '5-1',
      account: ZERO_ACCOUNT,
      publicKey: ZERO_KEY,
      signature: Buffer.from([1, ...new Uint8Array(63)]).toString('base64'),
      nonce: Buffer.from(nonce).toString('base64'),
      issuedAtMs: ISSUED,
    };
  };

  it('refuses a signature forged for a small-order key, which near-api-js would accept', async () => {
    const pass = forged();
    const hash = nep413Hash({
      message: passMessage(pass),
      nonce: Buffer.from(pass.nonce, 'base64'),
      recipient: CONTRACT,
    });
    // The attack is real: the library's own verify says yes.
    expect(PublicKey.fromString(ZERO_KEY).verify(hash, Buffer.from(pass.signature, 'base64'))).toBe(
      true,
    );
    const chain = fakeChain('full', anaTicket({ owner_id: ZERO_ACCOUNT }));
    const result = await checkPass(pass, CONTRACT, chain, ISSUED + 1_000);
    expect(ids(result.checks)).toEqual([
      'signature:NO',
      'key:ok',
      'holder:ok',
      'ticket:ok',
      'fresh:ok',
    ]);
    expect(result.admitted).toBe(false);
  });

  it('still admits the near-cli-rs vector and a pass signed in the test', async () => {
    const kat = await checkPass(
      KAT_PASS,
      KAT.contract,
      fakeChain('full', ticketView()),
      KAT.issuedAtMs,
    );
    expect(kat.admitted).toBe(true);
    const ana = await checkPass(anaPass(), CONTRACT, fakeChain('full', anaTicket()), ISSUED);
    expect(ana.admitted).toBe(true);
  });

  it('fails fresh when the time now is not a finite number', async () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = await checkPass(anaPass(), CONTRACT, fakeChain('full', anaTicket()), now);
      expect(failed(result.checks), String(now)).toEqual(['fresh']);
      expect(result.admitted).toBe(false);
    }
  });

  it('fails all five, without reading the chain or throwing, for a pass that is not a pass', async () => {
    const { nonce: _nonce, ...noNonce } = anaPass();
    const { signature: _signature, ...noSignature } = anaPass();
    for (const given of [
      { ...anaPass(), issuedAtMs: 1.5 },
      noNonce,
      noSignature,
      { ...anaPass(), ticket: 5 },
      { ...anaPass(), v: '1' },
      null,
      'a pass',
    ]) {
      const chain = fakeChain('full', anaTicket());
      const result = await checkPass(given as never, CONTRACT, chain, ISSUED);
      expect(ids(result.checks), JSON.stringify(given)).toEqual([
        'signature:NO',
        'key:NO',
        'holder:NO',
        'ticket:NO',
        'fresh:NO',
      ]);
      expect(new Set(result.checks.map((c) => c.detail))).toEqual(
        new Set([
          'This pass is damaged: part of it cannot be read. Ask the holder to sign a new pass.',
        ]),
      );
      expect(chain.asked).toEqual([]);
    }
  });
});

describe('encodePass and decodePass', () => {
  const pass = anaPass();

  it('round-trips a bare pass in base64url, with no characters a URL must escape', () => {
    const text = encodePass(pass);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePass(text)).toEqual(pass);
  });

  it('reads the pass from any URL that carries #p=<pass>', () => {
    const text = encodePass(pass);
    expect(decodePass(`https://tickets.example/door#p=${text}`)).toEqual(pass);
    expect(decodePass(`  http://localhost:5173/door#x=1&p=${text}  `)).toEqual(pass);
    expect(decodePass(doorUrl('https://tickets.example/', pass))).toEqual(pass);
    expect(doorUrl('https://tickets.example/', pass)).toBe(
      `https://tickets.example/door#p=${text}`,
    );
  });

  it('returns null on garbage', () => {
    const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const text of [
      '',
      'hello',
      'https://tickets.example/door',
      'https://tickets.example/door#p=',
      Buffer.from('not json').toString('base64url'),
      json({ ...pass, v: 2 }),
      json({ ...pass, ticket: 'five' }),
      json({ ...pass, issuedAtMs: -1 }),
      json({ ...pass, publicKey: 'secp256k1:abc' }),
      json([pass]),
      '%%%',
    ]) {
      expect(decodePass(text), text).toBeNull();
    }
  });

  it('returns null for anything that is not a string', () => {
    for (const value of [undefined, null, 42, {}, [encodePass(pass)]]) {
      expect(decodePass(value as never), String(value)).toBeNull();
    }
  });
});

describe('signedPass', () => {
  it('builds the pass from a wallet answer and keeps the signature as the wallet gave it', async () => {
    const request = passRequest({ contract: CONTRACT, ticket: '5-1', issuedAtMs: ISSUED });
    const key = demoPassKey(ANA);
    const signature = Buffer.from(key.sign(nep413Hash(request)).signature).toString('base64');
    const pass = signedPass(request, {
      accountId: ANA,
      publicKey: key.getPublicKey().toString(),
      signature,
    });
    expect(pass).toMatchObject({
      v: 1,
      contract: CONTRACT,
      ticket: '5-1',
      account: ANA,
      signature,
    });
    const result = await checkPass(pass, CONTRACT, fakeChain('full', anaTicket()), ISSUED);
    expect(result.admitted).toBe(true);
  });

  it('draws a fresh random nonce for every request', () => {
    const a = passRequest({ contract: CONTRACT, ticket: '5-1', issuedAtMs: ISSUED });
    const b = passRequest({ contract: CONTRACT, ticket: '5-1', issuedAtMs: ISSUED });
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect([...a.nonce.slice(0, 8)]).toEqual([...b.nonce.slice(0, 8)]);
  });
});

describe('createFixturePassChain', () => {
  it("lists each demo account's built-in key as its full-access key, and no other key", async () => {
    const chain = createFixturePassChain(createFixtureReader());
    expect(await chain.accessKey(ANA, demoPassKey(ANA).getPublicKey().toString())).toBe('full');
    expect(await chain.accessKey(LUIS, demoPassKey(ANA).getPublicKey().toString())).toBe('missing');
    expect(await chain.ticket('1-3')).toMatchObject({ owner_id: LUIS });
  });

  it('runs the demo end to end: a demo account signs, the fixture chain admits', async () => {
    const chain = createFixturePassChain(createFixtureReader());
    const request = passRequest({ contract: CONTRACT, ticket: '1-3', issuedAtMs: ISSUED });
    const pass = signPassWithKey(request, LUIS, demoPassKey(LUIS));
    expect((await checkPass(pass, CONTRACT, chain, ISSUED)).admitted).toBe(true);
  });
});

describe('createPassChain', () => {
  const ticket = anaTicket();
  const reader = { getTicket: async (id: string) => (id === '5-1' ? ticket : null) };

  const KEY = 'ed25519:DYoE7CvF7PtSBrCdmu96Y8yZPsWhnYYt3vP2ygTXH79S';
  const OTHER = 'ed25519:FnPCCZAmxbUcdzkyA43qrGtq7xR7Lwrzdwmr1AEqQ3Bm';
  const limitedKey = {
    nonce: 1,
    permission: { FunctionCall: { allowance: null, receiver_id: CONTRACT, method_names: [] } },
  };
  const entry = (
    public_key: string,
    access_key: unknown = { nonce: 1, permission: 'FullAccess' },
  ) => ({ public_key, access_key });

  /** An RPC whose key-list pages are given in order; it records every read and never throws. */
  function rpcListing(...pages: Array<{ keys: unknown[]; last_key?: string | null }>) {
    const asked: unknown[] = [];
    return {
      asked,
      rpc: {
        async viewAccessKeyList(params: unknown) {
          asked.push(params);
          const page = pages[asked.length - 1];
          if (page === undefined) throw new Error('read past the last page');
          return { block_hash: 'h', block_height: 1, ...page };
        },
      },
    };
  }

  it('reads the key list at final and tells a full-access key from a function-call key', async () => {
    const full = rpcListing({ keys: [entry(OTHER), entry(KEY)], last_key: null });
    const chain = createPassChain(reader, full.rpc);
    expect(await chain.accessKey(ANA, KEY)).toBe('full');
    expect(full.asked).toEqual([{ accountId: ANA, finalityQuery: { finality: 'final' } }]);
    const limited = rpcListing({ keys: [entry(KEY, limitedKey)] });
    expect(await createPassChain(reader, limited.rpc).accessKey(ANA, KEY)).toBe('function-call');
    expect(await chain.ticket('5-1')).toEqual(ticket);
  });

  it('reads a missing key as missing in exactly one read, with no error on the way', async () => {
    const other = rpcListing({ keys: [entry(OTHER)], last_key: null });
    expect(await createPassChain(reader, other.rpc).accessKey(ANA, KEY)).toBe('missing');
    expect(other.asked).toHaveLength(1);
    // An account that does not exist: testnet answers an empty list (both endpoints, 2026-11-13).
    const noAccount = rpcListing({ keys: [], last_key: null });
    expect(await createPassChain(reader, noAccount.rpc).accessKey(ANA, KEY)).toBe('missing');
    expect(noAccount.asked).toHaveLength(1);
  });

  it('follows the pages of a long key list', async () => {
    const paged = rpcListing(
      { keys: [entry(OTHER)], last_key: OTHER },
      { keys: [entry(KEY, limitedKey)], last_key: null },
    );
    expect(await createPassChain(reader, paged.rpc).accessKey(ANA, KEY)).toBe('function-call');
    expect(paged.asked).toEqual([
      { accountId: ANA, finalityQuery: { finality: 'final' } },
      { accountId: ANA, finalityQuery: { finality: 'final' }, afterKey: OTHER },
    ]);
  });

  it('rejects when the list cannot be read, so the door says the chain could not be read', async () => {
    const down = {
      viewAccessKeyList: async () => {
        throw new Error('fetch failed');
      },
    };
    await expect(createPassChain(reader, down).accessKey(ANA, KEY)).rejects.toThrow('fetch failed');
    const garbage = { viewAccessKeyList: async () => ({ keys: 'none' }) };
    await expect(createPassChain(reader, garbage).accessKey(ANA, KEY)).rejects.toThrow();
    const result = await checkPass(anaPass(), CONTRACT, createPassChain(reader, down), ISSUED);
    expect(result.checks[1]).toEqual({
      id: 'key',
      ok: false,
      detail: 'The chain could not be read, so this was not checked. Try again.',
    });
  });
});
