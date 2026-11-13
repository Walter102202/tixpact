import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  actions,
  type ContractCall,
  createFixtureReader,
  createFixtureRpc,
  FIXTURE_CONTRACT_ID,
  FIXTURES,
  type FixtureData,
  formatDateTime,
  PROMISE_TEXT,
  parseNear,
  type Reader,
  type RecordedTx,
  TX_FIXTURES,
} from '@ticket-escrow/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentConfig } from './config.js';
import { createServer } from './server.js';
import { type AgentSigner, SendError } from './signer.js';
import { TOOL_NAMES, type ToolDeps } from './tools.js';

const AGENT = 'luis.testnet';
const CAPS = { maxPriceYocto: parseNear('1.5'), maxExposureYocto: parseNear('10') };

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture is missing');
  return value;
}

// The fixture chain plus event 9: on sale at 2 NEAR, above the 1.5 NEAR per-ticket cap.
const event1 = must(FIXTURES.events.find((e) => e.event_id === 1));
const accounting1 = must(FIXTURES.accounting.find((a) => a.event_id === 1));
const DATA: FixtureData = {
  ...FIXTURES,
  events: [
    ...FIXTURES.events,
    { ...event1, event_id: 9, title: 'Late show', price: parseNear('2'), sold: 0 },
  ],
  accounting: [
    ...FIXTURES.accounting,
    { ...accounting1, event_id: 9, principal_received: '0', principal_reserved: '0' },
  ],
};

const b64 = (value: unknown) =>
  value === undefined ? '' : Buffer.from(JSON.stringify(value)).toString('base64');

/** A final status in which every receipt succeeded and the call returned `value`. */
function okTx(hash: string, value: unknown): RecordedTx {
  const receipt = `${hash}-receipt`;
  return {
    hash,
    signerId: AGENT,
    failedReceiptId: null,
    status: {
      final_execution_status: 'FINAL',
      status: { SuccessValue: b64(value) },
      transaction_outcome: {
        id: hash,
        outcome: {
          executor_id: AGENT,
          logs: [],
          receipt_ids: [receipt],
          status: { SuccessReceiptId: receipt },
        },
      },
      receipts_outcome: [
        {
          id: receipt,
          outcome: {
            executor_id: FIXTURE_CONTRACT_ID,
            logs: [],
            receipt_ids: [],
            status: { SuccessValue: b64(value) },
          },
        },
      ],
    },
  };
}

const TRANSFER_HASH = 'TransferOkHash1111111111111111111111111111111';
const EXPIRE_HASH = 'ExpireOkHash11111111111111111111111111111111';
const TXS: Record<string, RecordedTx> = {
  ...TX_FIXTURES,
  transferOk: okTx(TRANSFER_HASH, undefined),
  expireOk: okTx(EXPIRE_HASH, 'Refundable'),
};

const HASHES: Record<string, string> = {
  buy_ticket: TX_FIXTURES.buySucceeded.hash,
  nft_transfer: TRANSFER_HASH,
  expire_event: EXPIRE_HASH,
  claim_refund: TX_FIXTURES.refundSettled.hash,
};

interface Recorded {
  receiverId: string;
  call: ContractCall;
}

function recordingSigner(hashes: Record<string, string> = HASHES) {
  const calls: Recorded[] = [];
  const signer: AgentSigner = {
    accountId: AGENT,
    async signAndSend(receiverId, call) {
      calls.push({ receiverId, call });
      const hash = hashes[call.methodName];
      if (hash === undefined) throw new Error(`no recorded transaction for ${call.methodName}`);
      return hash;
    },
  };
  return { signer, calls };
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    network: 'testnet',
    contractId: FIXTURE_CONTRACT_ID,
    rpcUrls: ['https://rpc.invalid'],
    agentAccountId: AGENT,
    caps: CAPS,
    hasKey: true,
    ...overrides,
  };
}

function deps(signer: AgentSigner | null, overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    config: config(signer === null ? { hasKey: false } : {}),
    reader: createFixtureReader(DATA),
    txRpc: createFixtureRpc(TXS),
    signer,
    track: { attempts: 2, intervalMs: 0, sleep: async () => {} },
    ...overrides,
  };
}

const open: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((close) => close()));
});

async function connect(toolDeps: ToolDeps): Promise<Client> {
  const server = createServer(toolDeps);
  const client = new Client({ name: 'tools-test', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  open.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

interface ToolResult {
  text: string;
  isError: boolean;
  data: Record<string, unknown>;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return {
    text: content.map((c) => c.text ?? '').join('\n'),
    isError: result.isError === true,
    data: (result.structuredContent ?? {}) as Record<string, unknown>,
  };
}

/** A reader that fails the test if anything reads the chain. */
const unreachableReader: Reader = new Proxy({} as Reader, {
  get(_target, property) {
    if (property === 'contractId') return FIXTURE_CONTRACT_ID;
    return () => {
      throw new Error(`the chain was read (${String(property)}) before the key check`);
    };
  },
});

describe('the tool list', () => {
  it('has exactly the ten tools of the plan', async () => {
    const client = await connect(deps(recordingSigner().signer));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_events',
      'get_event',
      'get_ticket',
      'list_my_tickets',
      'get_wallet',
      'verify_contract',
      'buy_ticket',
      'transfer_ticket',
      'expire_event',
      'claim_refund',
    ]);
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('gives every tool a strict input schema, an output schema and honest hints', async () => {
    const client = await connect(deps(recordingSigner().signer));
    const { tools } = await client.listTools();
    const writes = new Set(['buy_ticket', 'transfer_ticket', 'expire_event', 'claim_refund']);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(tool.outputSchema?.additionalProperties, tool.name).toBe(false);
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(!writes.has(tool.name));
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(40);
    }
  });

  it('rejects an unknown argument instead of ignoring it', async () => {
    const client = await connect(deps(recordingSigner().signer));
    const result = await call(client, 'get_event', { event_id: 1, price: '1' });
    expect(result.isError).toBe(true);
  });
});

describe('read tools', () => {
  it('get_event names the verifier, the deadline and what triggers a refund', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'get_event', { event_id: 1 });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('teatro.testnet');
    expect(result.text).toContain(formatDateTime(event1.resolution_deadline_ms, 'UTC'));
    expect(result.text).toContain('the deadline passes without');
    expect(result.text).toContain(PROMISE_TEXT);
    expect(result.data).toMatchObject({ event: { event_id: 1, verifier_id: 'teatro.testnet' } });
  });

  it('get_event says when the verifier has not accepted yet', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'get_event', { event_id: 2 });
    expect(result.text).toContain('teatro.testnet has not accepted the terms yet');
  });

  it('get_event on a missing event is a tool error with a plain message', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'get_event', { event_id: 99 });
    expect(result).toMatchObject({ isError: true, text: 'Event 99 does not exist.' });
  });

  it('list_events lists every event with its phase and price', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'list_events');
    expect((result.data.events as unknown[]).length).toBe(9);
    expect(result.data.next_from_index).toBeNull();
    expect(result.text).toContain('Jazz night');
    expect(result.text).toContain('1.5 NEAR');
    expect(result.text).toContain('On sale');
  });

  it('list_events pages with from_index and limit', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'list_events', { from_index: 2, limit: 3 });
    const ids = (result.data.events as Array<{ event_id: number }>).map((e) => e.event_id);
    expect(ids).toEqual([3, 4, 5]);
    expect(result.data.next_from_index).toBe(5);
  });

  it('get_ticket shows the holder, the principal, the claim word and the history', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'get_ticket', { token_id: '8-1' });
    expect(result.text).toContain('luis.testnet');
    expect(result.text).toContain('1.5 NEAR');
    expect(result.text).toContain('Claimable');
    expect(result.data).toMatchObject({ ticket: { token_id: '8-1' }, event: { event_id: 8 } });
    expect(result.data.history).toMatchObject({ dropped: 0 });
  });

  it('list_my_tickets lists the agent tickets and the exposure the caps count', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'list_my_tickets');
    expect((result.data.tickets as unknown[]).length).toBe(8);
    expect(result.data).toMatchObject({ account_id: AGENT, exposure: parseNear('8.5') });
    expect(result.text).toContain('8.5 NEAR');
  });

  it('get_wallet shows the balance, both caps, the exposure and what is left', async () => {
    const client = await connect(deps(recordingSigner().signer));
    const result = await call(client, 'get_wallet');
    expect(result.data).toMatchObject({
      account_id: AGENT,
      network: 'testnet',
      contract_id: FIXTURE_CONTRACT_ID,
      can_sign: true,
      max_price: parseNear('1.5'),
      max_exposure: parseNear('10'),
      exposure: parseNear('8.5'),
      headroom: parseNear('1.5'),
    });
    expect(result.text).toContain('Per-ticket cap: 1.5 NEAR');
  });

  it('read tools that need the agent account say so when it is not set', async () => {
    const client = await connect(
      deps(null, { config: config({ agentAccountId: null, caps: null, hasKey: false }) }),
    );
    for (const name of ['list_my_tickets', 'get_wallet']) {
      const result = await call(client, name);
      expect(result, name).toMatchObject({
        isError: true,
        text: 'AGENT_ACCOUNT_ID is not set: this server does not know which account is the agent.',
      });
    }
  });

  it('verify_contract compares the balance with the money the contract holds for events', async () => {
    const client = await connect(deps(null));
    const result = await call(client, 'verify_contract');
    // The contract's `total_held`: reserved principal plus organizer payouts not yet sent.
    const held = DATA.accounting.reduce(
      (sum, a) => sum + BigInt(a.principal_reserved) + BigInt(a.organizer_available),
      0n,
    );
    expect(result.data).toMatchObject({
      contract_id: FIXTURE_CONTRACT_ID,
      code_hash: FIXTURES.accountProof.codeHash,
      access_keys: 0,
      balance: FIXTURES.accountProof.balance,
      held: held.toString(),
      balance_covers_held: true,
      events_counted: 9,
    });
    expect(result.text).toContain('0 access keys: nobody can change this contract');
  });
});

describe('buy_ticket', () => {
  it('above the per-ticket cap is denied with both amounts, and nothing is signed', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'buy_ticket', { event_id: 9 });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      status: 'denied',
      reason: 'price_above_cap',
      message: 'Price 2 NEAR is above the per-ticket cap of 1.5 NEAR',
      tx_hash: null,
    });
    expect(result.text).toBe(
      'Denied: Price 2 NEAR is above the per-ticket cap of 1.5 NEAR. Nothing was signed.',
    );
    expect(calls).toEqual([]);
  });

  it('within the caps signs exactly the call the client builds, once', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'buy_ticket', { event_id: 1 });
    expect(calls).toEqual([
      { receiverId: FIXTURE_CONTRACT_ID, call: actions.buyTicket(1, parseNear('1.5')) },
    ]);
    expect(result.data).toMatchObject({
      status: 'succeeded',
      tx_hash: TX_FIXTURES.buySucceeded.hash,
      explorer_url: `https://testnet.nearblocks.io/txns/${TX_FIXTURES.buySucceeded.hash}`,
      value: '1-4',
      failed_receipt: null,
    });
    expect(result.text).toContain('Bought ticket 1-4 for 1.5 NEAR');
  });

  it('above the exposure cap is denied, and nothing is signed', async () => {
    const { signer, calls } = recordingSigner();
    const tight = config({ caps: { ...CAPS, maxExposureYocto: parseNear('9.99') } });
    const client = await connect(deps(signer, { config: tight }));
    const result = await call(client, 'buy_ticket', { event_id: 1 });
    expect(result.data).toMatchObject({
      status: 'denied',
      reason: 'exposure_above_cap',
      message:
        'Exposure would be 10 NEAR (8.5 NEAR in tickets held plus 1.5 NEAR for this one), above the cap of 9.99 NEAR',
    });
    expect(calls).toEqual([]);
  });

  it('for an event that is not on sale is not sent', async () => {
    const { signer, calls } = recordingSigner();
    const roomy = config({
      caps: { maxPriceYocto: parseNear('5'), maxExposureYocto: parseNear('50') },
    });
    const client = await connect(deps(signer, { config: roomy }));
    const result = await call(client, 'buy_ticket', { event_id: 3 });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'not_on_sale' });
    expect(result.text).toContain('Sold out');
    expect(calls).toEqual([]);
  });

  it('for an event that does not exist is not sent', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'buy_ticket', { event_id: 99 });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'not_found' });
    expect(calls).toEqual([]);
  });
});

describe('the exposure cap over several purchases', () => {
  const buy = (client: Client) => call(client, 'buy_ticket', { event_id: 1 });

  it('two purchases asked for at once cannot both pass it', async () => {
    // 8.5 NEAR held, a 10 NEAR cap and 1.5 NEAR tickets: one more fits, two do not.
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const results = await Promise.all([buy(client), buy(client)]);
    expect(results.map((r) => r.data.status).sort()).toEqual(['denied', 'succeeded']);
    expect(calls).toHaveLength(1);
  });

  it('counts a purchase once it shows up in the ticket list, not twice', async () => {
    // A chain that mints: each signed purchase adds the next ticket to the agent's list.
    const data = structuredClone(DATA);
    const minted: Record<string, RecordedTx> = {};
    let serial = 4;
    const calls: Recorded[] = [];
    const signer: AgentSigner = {
      accountId: AGENT,
      async signAndSend(receiverId, sent) {
        calls.push({ receiverId, call: sent });
        serial += 1;
        const tokenId = `1-${serial}`;
        data.tickets.push({
          token_id: tokenId,
          event_id: 1,
          serial,
          owner_id: AGENT,
          principal: parseNear('1.5'),
          status: 'Active',
          claim: 'Reserved',
          pending_operation_id: null,
        });
        const hash = `MintHash${serial}11111111111111111111111111111111111`;
        minted[hash] = okTx(hash, tokenId);
        return hash;
      },
    };
    const roomy = config({ caps: { ...CAPS, maxExposureYocto: parseNear('11.5') } });
    const client = await connect(
      deps(signer, {
        config: roomy,
        reader: createFixtureReader(data),
        // The fixture RPC looks the hash up when asked, so it sees what the signer adds later.
        txRpc: createFixtureRpc(minted),
      }),
    );
    expect((await buy(client)).data.status).toBe('succeeded');
    expect((await buy(client)).data.status).toBe('succeeded');
    const third = await buy(client);
    expect(third.data).toMatchObject({
      status: 'denied',
      message:
        'Exposure would be 13 NEAR (11.5 NEAR in tickets held plus 1.5 NEAR for this one), above the cap of 11.5 NEAR',
    });
    expect(calls).toHaveLength(2);
  });

  it('keeps counting a purchase whose result never arrived', async () => {
    const { signer, calls } = recordingSigner({
      buy_ticket: 'UnknownHash1111111111111111111111111111111',
    });
    const client = await connect(deps(signer));
    expect((await buy(client)).data.status).toBe('unconfirmed');
    const second = await buy(client);
    expect(second.data).toMatchObject({
      status: 'denied',
      reason: 'exposure_above_cap',
      message:
        'Exposure would be 11.5 NEAR (10 NEAR in tickets held plus 1.5 NEAR for this one), above the cap of 10 NEAR',
    });
    expect(calls).toHaveLength(1);
  });

  it('stops counting a purchase that failed', async () => {
    const { signer, calls } = recordingSigner({ buy_ticket: TX_FIXTURES.buyRejected.hash });
    const client = await connect(deps(signer));
    expect((await buy(client)).data.status).toBe('failed');
    expect((await buy(client)).data.status).toBe('failed');
    expect(calls).toHaveLength(2);
  });
});

describe('without a key', () => {
  it('every write tool is denied before anything is read or signed', async () => {
    const client = await connect(deps(null, { reader: unreachableReader }));
    const writes: Array<[string, Record<string, unknown>]> = [
      ['buy_ticket', { event_id: 1 }],
      ['transfer_ticket', { token_id: '1-3', receiver_id: 'ana.testnet' }],
      ['expire_event', { event_id: 6 }],
      ['claim_refund', { token_id: '8-1' }],
    ];
    for (const [name, args] of writes) {
      const result = await call(client, name, args);
      expect(result.data, name).toMatchObject({ status: 'denied', reason: 'no_key', call: null });
      expect(result.data.message, name).toContain('no key configured');
      expect(result.text, name).toMatch(/^Denied: no key configured/);
    }
  });

  it('read tools still work', async () => {
    const client = await connect(deps(null));
    expect((await call(client, 'get_event', { event_id: 1 })).isError).toBe(false);
  });
});

describe('transfer_ticket', () => {
  it('signs the client transfer for a ticket the agent holds', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'transfer_ticket', {
      token_id: '1-3',
      receiver_id: 'ana.testnet',
    });
    expect(calls).toEqual([
      { receiverId: FIXTURE_CONTRACT_ID, call: actions.transferTicket('1-3', 'ana.testnet') },
    ]);
    expect(result.data).toMatchObject({ status: 'succeeded', tx_hash: TRANSFER_HASH });
    expect(result.text).toContain('the right to its 1.5 NEAR refund');
  });

  it('passes the memo through', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    await call(client, 'transfer_ticket', {
      token_id: '1-3',
      receiver_id: 'ana.testnet',
      memo: 'for the concert',
    });
    expect(calls[0]?.call).toEqual(actions.transferTicket('1-3', 'ana.testnet', 'for the concert'));
  });

  it('is not sent for a ticket someone else holds', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'transfer_ticket', {
      token_id: '1-1',
      receiver_id: 'luis.testnet',
    });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'not_holder' });
    expect(result.text).toContain('ana.testnet');
    expect(calls).toEqual([]);
  });

  it('is not sent to the agent itself', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'transfer_ticket', { token_id: '1-3', receiver_id: AGENT });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'same_account' });
    expect(calls).toEqual([]);
  });

  it('is not sent for a ticket with a refund in progress', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'transfer_ticket', {
      token_id: '8-2',
      receiver_id: 'ana.testnet',
    });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'not_transferable' });
    expect(calls).toEqual([]);
  });

  it('rejects a memo longer than the contract allows', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'transfer_ticket', {
      token_id: '1-3',
      receiver_id: 'ana.testnet',
      memo: 'é'.repeat(129),
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('expire_event', () => {
  it('signs the expiry of an event past its deadline', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'expire_event', { event_id: 6 });
    expect(calls).toEqual([{ receiverId: FIXTURE_CONTRACT_ID, call: actions.expireEvent(6) }]);
    expect(result.data).toMatchObject({ status: 'succeeded', value: 'Refundable' });
  });

  it('is not sent before the deadline', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'expire_event', { event_id: 1 });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'too_early' });
    expect(result.text).toContain(formatDateTime(event1.resolution_deadline_ms, 'UTC'));
    expect(calls).toEqual([]);
  });

  it('is not sent for an event that already has its outcome', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'expire_event', { event_id: 7 });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'already_resolved' });
    expect(calls).toEqual([]);
  });
});

describe('claim_refund', () => {
  it('signs the claim of a claimable ticket and reports the money moved', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'claim_refund', { token_id: '8-1' });
    expect(calls).toEqual([{ receiverId: FIXTURE_CONTRACT_ID, call: actions.claimRefund('8-1') }]);
    expect(result.data).toMatchObject({ status: 'succeeded', value: true });
    expect(result.text).toContain('Refunded 1.5 NEAR to luis.testnet');
  });

  it('signs the claim when the deadline passed without confirmation (the contract expires first)', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    await call(client, 'claim_refund', { token_id: '6-1' });
    expect(calls).toEqual([{ receiverId: FIXTURE_CONTRACT_ID, call: actions.claimRefund('6-1') }]);
  });

  it('is not sent while the event is unresolved and inside its deadline', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'claim_refund', { token_id: '1-3' });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'not_claimable' });
    expect(calls).toEqual([]);
  });

  it('is not sent for a refund already being sent, or already refunded', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    for (const tokenId of ['8-2', '8-3', '7-1']) {
      const result = await call(client, 'claim_refund', { token_id: tokenId });
      expect(result.data, tokenId).toMatchObject({ status: 'not_sent', reason: 'not_claimable' });
    }
    expect(calls).toEqual([]);
  });

  it('is not sent for a ticket the agent does not hold', async () => {
    const { signer, calls } = recordingSigner();
    const client = await connect(deps(signer));
    const result = await call(client, 'claim_refund', { token_id: '8-4' });
    expect(result.data).toMatchObject({ status: 'not_sent', reason: 'not_holder' });
    expect(calls).toEqual([]);
  });

  it('reports a failed callback as failed with the failed step, never as refunded', async () => {
    const { signer } = recordingSigner({ claim_refund: TX_FIXTURES.refundCallbackFailed.hash });
    const client = await connect(deps(signer));
    const result = await call(client, 'claim_refund', { token_id: '8-1' });
    expect(result.data).toMatchObject({
      status: 'failed',
      failed_receipt: { receipt_id: TX_FIXTURES.refundCallbackFailed.failedReceiptId },
    });
    expect(result.text).not.toContain('Refunded');
    expect(result.text).toContain('did not complete');
  });
});

describe('sending', () => {
  it('a transaction the node refused is failed, and is not tracked', async () => {
    const signer: AgentSigner = {
      accountId: AGENT,
      async signAndSend() {
        throw new SendError('The account does not have enough NEAR for this.', null, false);
      },
    };
    const client = await connect(deps(signer, { txRpc: unreachableTxRpc() }));
    const result = await call(client, 'buy_ticket', { event_id: 1 });
    expect(result.data).toMatchObject({ status: 'failed', tx_hash: null });
    expect(result.text).toContain('The account does not have enough NEAR for this.');
  });

  it('a transaction with no final status in time is unconfirmed, with its hash', async () => {
    const { signer } = recordingSigner({
      buy_ticket: 'UnknownHash1111111111111111111111111111111',
    });
    const client = await connect(deps(signer));
    const result = await call(client, 'buy_ticket', { event_id: 1 });
    expect(result.data).toMatchObject({
      status: 'unconfirmed',
      tx_hash: 'UnknownHash1111111111111111111111111111111',
    });
    expect(result.text).toContain('https://testnet.nearblocks.io/txns/UnknownHash');
  });

  it('a send that may have reached the node is tracked by its hash', async () => {
    const signer: AgentSigner = {
      accountId: AGENT,
      async signAndSend() {
        throw new SendError('timed out', TX_FIXTURES.buySucceeded.hash, true);
      },
    };
    const client = await connect(deps(signer));
    const result = await call(client, 'buy_ticket', { event_id: 1 });
    expect(result.data).toMatchObject({ status: 'succeeded', value: '1-4' });
  });
});

function unreachableTxRpc() {
  return {
    async viewTransactionStatusWithReceipts(): Promise<unknown> {
      throw new Error('a refused transaction must not be tracked');
    },
  };
}
