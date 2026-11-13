import { FailoverRpcProvider } from 'near-api-js';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from './fixtures.js';
import { createReader, createRpc, type ReaderRpc } from './reader.js';
import type { TxStatusRpc } from './tx.js';

const CONTRACT = 'ticket-escrow.testnet';
const FINAL = { finality: 'final' };

interface Recorded {
  kind: 'callFunction' | 'viewAccount' | 'viewAccessKeyList';
  params: Record<string, unknown>;
}

/** A fake RPC that answers view calls from a table and records every request. */
function fakeRpc(
  views: Record<string, unknown>,
  keyPages: Array<{ keys: unknown[]; last_key?: string | null }> = [],
) {
  const calls: Recorded[] = [];
  let page = 0;
  const rpc: ReaderRpc = {
    async callFunction(params) {
      calls.push({ kind: 'callFunction', params });
      if (!(params.method in views)) throw new Error(`no fake for ${params.method}`);
      return views[params.method];
    },
    async viewAccount(params) {
      calls.push({ kind: 'viewAccount', params });
      return {
        amount: 12_345_000_000_000_000_000_000_000n,
        locked: 0n,
        code_hash: 'E8jZ1giWcVrps8PcV75ATauu6gFRkcwjNtKp7NKmipZG',
        storage_usage: 182_000,
        block_hash: '6Gz5r3dJmQz4sA9fYb2kT7wXc1vN8pLhR5eUoKj3MiDq',
        block_height: 190_000_123,
      };
    },
    async viewAccessKeyList(params) {
      calls.push({ kind: 'viewAccessKeyList', params });
      const next = keyPages[page] ?? { keys: [] };
      page += 1;
      return { ...next, block_hash: 'x', block_height: 190_000_124 };
    },
  };
  return { rpc, calls };
}

const event = FIXTURES.events[0];

describe('createReader', () => {
  it('reads every view of the contract at final finality and parses it', async () => {
    const { rpc, calls } = fakeRpc({
      get_config: FIXTURES.config,
      quote_event_budget: '700000000000000000000000',
      get_event: event,
      list_events: FIXTURES.events.slice(0, 2),
      get_accounting: FIXTURES.accounting[0],
      get_ticket: FIXTURES.tickets[0],
      list_tickets_for_owner: FIXTURES.tickets.slice(0, 1),
      get_ticket_history: FIXTURES.histories['1-3'],
      get_operation: FIXTURES.operations[0],
    });
    const reader = createReader({ contractId: CONTRACT, rpc });

    expect(reader.contractId).toBe(CONTRACT);
    expect(await reader.getConfig()).toEqual(FIXTURES.config);
    expect(await reader.quoteEventBudget(50)).toBe('700000000000000000000000');
    expect(await reader.getEvent(1)).toEqual(event);
    expect(await reader.listEvents(0, 2)).toEqual(FIXTURES.events.slice(0, 2));
    expect(await reader.getAccounting(1)).toEqual(FIXTURES.accounting[0]);
    expect(await reader.getTicket('1-1')).toEqual(FIXTURES.tickets[0]);
    expect(await reader.listTicketsForOwner('ana.testnet', 0, 50)).toEqual(
      FIXTURES.tickets.slice(0, 1),
    );
    expect(await reader.getTicketHistory('1-3')).toEqual(FIXTURES.histories['1-3']);
    expect(await reader.getOperation(7)).toEqual(FIXTURES.operations[0]);

    expect(calls.map((c) => [c.params.method, c.params.args])).toEqual([
      ['get_config', {}],
      ['quote_event_budget', { capacity: 50 }],
      ['get_event', { event_id: 1 }],
      ['list_events', { from_index: 0, limit: 2 }],
      ['get_accounting', { event_id: 1 }],
      ['get_ticket', { token_id: '1-1' }],
      ['list_tickets_for_owner', { account_id: 'ana.testnet', from_index: 0, limit: 50 }],
      ['get_ticket_history', { token_id: '1-3' }],
      ['get_operation', { operation_id: 7 }],
    ]);
    for (const call of calls) {
      expect(call.params.contractId).toBe(CONTRACT);
      expect(call.params.blockQuery).toEqual(FINAL);
    }
  });

  it('returns null for a missing record', async () => {
    const { rpc } = fakeRpc({ get_event: null, get_ticket: null, get_operation: null });
    const reader = createReader({ contractId: CONTRACT, rpc });
    expect(await reader.getEvent(999)).toBeNull();
    expect(await reader.getTicket('9-9')).toBeNull();
    expect(await reader.getOperation(9)).toBeNull();
  });

  it('refuses a response that does not match the frozen shape, naming the method', async () => {
    const { rpc } = fakeRpc({ get_event: { ...event, price: 1.5e24 }, list_events: undefined });
    const reader = createReader({ contractId: CONTRACT, rpc });
    await expect(reader.getEvent(1)).rejects.toThrow(/get_event/);
    await expect(reader.listEvents(0, 10)).rejects.toThrow(/list_events/);
  });

  it('reads the account proof at final finality and counts keys across pages', async () => {
    const { rpc, calls } = fakeRpc({}, [
      { keys: [{}, {}], last_key: 'ed25519:page-one-end' },
      { keys: [{}], last_key: null },
    ]);
    const reader = createReader({ contractId: CONTRACT, rpc });
    expect(await reader.getAccountProof(CONTRACT)).toEqual({
      balance: '12345000000000000000000000',
      codeHash: 'E8jZ1giWcVrps8PcV75ATauu6gFRkcwjNtKp7NKmipZG',
      accessKeys: 3,
      blockHeight: 190_000_123,
    });
    expect(calls).toEqual([
      { kind: 'viewAccount', params: { accountId: CONTRACT, blockQuery: FINAL } },
      { kind: 'viewAccessKeyList', params: { accountId: CONTRACT, finalityQuery: FINAL } },
      {
        kind: 'viewAccessKeyList',
        params: { accountId: CONTRACT, finalityQuery: FINAL, afterKey: 'ed25519:page-one-end' },
      },
    ]);
  });

  it('reports zero keys for a locked contract', async () => {
    const { rpc } = fakeRpc({}, [{ keys: [] }]);
    const reader = createReader({ contractId: CONTRACT, rpc });
    expect((await reader.getAccountProof(CONTRACT)).accessKeys).toBe(0);
  });
});

describe('createRpc', () => {
  it('builds a failover provider over the given endpoints, in order', () => {
    const rpc = createRpc(['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org']);
    expect(rpc).toBeInstanceOf(FailoverRpcProvider);
    expect(rpc.providers).toHaveLength(2);
  });

  it('gives one provider that both the reader and trackTransaction accept', () => {
    // Compile-time check: the typecheck fails if near-api-js stops matching either interface.
    const rpc: ReaderRpc & TxStatusRpc = createRpc(['https://test.rpc.fastnear.com']);
    expect(typeof rpc.viewTransactionStatusWithReceipts).toBe('function');
  });

  it('refuses an empty endpoint list', () => {
    expect(() => createRpc([])).toThrow(/at least one RPC URL/);
    expect(() => createReader({ contractId: CONTRACT, rpcUrls: [] })).toThrow(
      /at least one RPC URL/,
    );
  });
});
