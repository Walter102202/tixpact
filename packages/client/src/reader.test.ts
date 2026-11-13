import { FailoverRpcError, FailoverRpcProvider } from 'near-api-js';
import { AccountDoesNotExistError } from 'near-api-js/rpc-errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixtureReader, FIXTURES, FIXTURES_WITH_TOKENS } from './fixtures.js';
import { createReader, createRpc, groupVerifierOf, type ReaderRpc } from './reader.js';
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

describe('accountExists', () => {
  const missing = () => new AccountDoesNotExistError('teatro-typo.testnet', 'x', 190_000_123);
  const readerWith = (viewAccount: ReaderRpc['viewAccount']) => {
    const { rpc } = fakeRpc({});
    return createReader({ contractId: CONTRACT, rpc: { ...rpc, viewAccount } });
  };

  it('is true for an account the node shows, read at final finality', async () => {
    const { rpc, calls } = fakeRpc({});
    const reader = createReader({ contractId: CONTRACT, rpc });
    expect(await reader.accountExists?.('teatro.testnet')).toBe(true);
    expect(calls).toEqual([
      { kind: 'viewAccount', params: { accountId: 'teatro.testnet', blockQuery: FINAL } },
    ]);
  });

  it('is false when the node says the account does not exist', async () => {
    const reader = readerWith(() => Promise.reject(missing()));
    expect(await reader.accountExists?.('teatro-typo.testnet')).toBe(false);
  });

  it('is false when one endpoint of the failover says so and another timed out', async () => {
    const failed = new FailoverRpcError(2, [new Error('timed out'), missing()]);
    const reader = readerWith(() => Promise.reject(failed));
    expect(await reader.accountExists?.('teatro-typo.testnet')).toBe(false);
  });

  it('throws when no endpoint answered, so a caller never reads "missing" from an outage', async () => {
    const failed = new FailoverRpcError(2, [new Error('timed out'), new Error('fetch failed')]);
    const reader = readerWith(() => Promise.reject(failed));
    await expect(reader.accountExists?.('teatro.testnet')).rejects.toBe(failed);
  });

  it('knows the fixture accounts in fixture mode', async () => {
    const reader = createFixtureReader();
    for (const id of ['org.testnet', 'teatro.testnet', 'luis.testnet', 'ana.testnet', CONTRACT]) {
      expect(await reader.accountExists?.(id), id).toBe(true);
    }
    expect(await reader.accountExists?.('teatro-typo.testnet')).toBe(false);
  });
});

describe('token reads (interface v2)', () => {
  const TOKEN = 'tusd.testnet';

  /** A fake RPC whose views answer per contract and method, recording every request. */
  function tokenRpc(answers: Record<string, unknown>) {
    const calls: Array<Record<string, unknown>> = [];
    const { rpc } = fakeRpc({});
    const reader = createReader({
      contractId: CONTRACT,
      rpc: {
        ...rpc,
        async callFunction(params) {
          calls.push(params);
          const key = `${params.contractId} ${params.method}`;
          if (!(key in answers)) throw new Error(`no fake for ${key}`);
          return answers[key];
        },
      },
    });
    return { reader, calls };
  }

  it('reads a balance with ft_balance_of on the token, at final finality', async () => {
    const { reader, calls } = tokenRpc({ 'tusd.testnet ft_balance_of': '40000000' });
    expect(await reader.tokenBalance(TOKEN, 'luis.testnet')).toBe('40000000');
    expect(calls).toEqual([
      {
        contractId: TOKEN,
        method: 'ft_balance_of',
        args: { account_id: 'luis.testnet' },
        blockQuery: FINAL,
      },
    ]);
  });

  it('reads the registration and the minimum deposit from the storage views', async () => {
    const bounds = { min: '1250000000000000000000', max: '1250000000000000000000' };
    const registered = tokenRpc({
      'tusd.testnet storage_balance_of': { total: '1250000000000000000000', available: '0' },
      'tusd.testnet storage_balance_bounds': bounds,
    });
    expect(await registered.reader.tokenRegistration(TOKEN, 'luis.testnet')).toEqual({
      registered: true,
      minDeposit: '1250000000000000000000',
    });
    expect(registered.calls.map((c) => [c.contractId, c.method, c.args, c.blockQuery])).toEqual([
      [TOKEN, 'storage_balance_of', { account_id: 'luis.testnet' }, FINAL],
      [TOKEN, 'storage_balance_bounds', {}, FINAL],
    ]);

    const unregistered = tokenRpc({
      'tusd.testnet storage_balance_of': null,
      'tusd.testnet storage_balance_bounds': { ...bounds, max: null },
    });
    expect(await unregistered.reader.tokenRegistration(TOKEN, 'sofia.testnet')).toEqual({
      registered: false,
      minDeposit: '1250000000000000000000',
    });
  });

  it('refuses a token answer that does not match, naming the method and the token', async () => {
    const { reader } = tokenRpc({
      'tusd.testnet ft_balance_of': 40,
      'tusd.testnet storage_balance_of': null,
      'tusd.testnet storage_balance_bounds': { min: 1 },
    });
    await expect(reader.tokenBalance(TOKEN, 'luis.testnet')).rejects.toThrow(
      /ft_balance_of on tusd.testnet/,
    );
    await expect(reader.tokenRegistration(TOKEN, 'luis.testnet')).rejects.toThrow(
      /storage_balance_bounds on tusd.testnet/,
    );
  });

  it('answers from the fixture ledgers in fixture mode', async () => {
    const reader = createFixtureReader(FIXTURES_WITH_TOKENS);
    expect(await reader.tokenBalance(TOKEN, 'luis.testnet')).toBe('40000000');
    expect(await reader.tokenBalance(TOKEN, 'nobody.testnet')).toBe('0');
    expect(await reader.tokenRegistration(TOKEN, 'luis.testnet')).toEqual({
      registered: true,
      minDeposit: '1250000000000000000000',
    });
    expect(await reader.tokenRegistration(TOKEN, 'sofia.testnet')).toMatchObject({
      registered: false,
    });
    await expect(reader.tokenBalance('not-a-token.testnet', 'luis.testnet')).rejects.toThrow(
      /not-a-token.testnet/,
    );
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

describe('createRpc against endpoints that hang or fail', () => {
  const SLOW = 'https://slow.example';
  const DEAD = 'https://dead.example';
  const GOOD = 'https://good.example';
  const VIEW = {
    contractId: CONTRACT,
    method: 'get_config',
    args: {},
    blockQuery: { finality: 'final' },
  } as const;

  /** A JSON-RPC answer to a `call_function` query whose result is `value`. */
  function viewAnswer(value: unknown): Response {
    const bytes = [...new TextEncoder().encode(JSON.stringify(value))];
    const body = {
      jsonrpc: '2.0',
      id: '1',
      result: { result: bytes, logs: [], block_height: 1, block_hash: 'h' },
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }

  function stubFetch(byUrl: Record<string, () => Promise<Response>>) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      const answer = byUrl[url];
      return answer ? answer() : Promise.reject(new Error(`unexpected ${url}`));
    });
    // FailoverRpcProvider logs every failed attempt; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails over from an endpoint that never answers, within the timeout', async () => {
    const calls = stubFetch({
      [SLOW]: () => new Promise<Response>(() => {}),
      [GOOD]: async () => viewAnswer({ version: '1.0.0' }),
    });
    const rpc = createRpc([SLOW, GOOD], { timeoutMs: 50 });
    const started = Date.now();
    expect(await rpc.callFunction(VIEW)).toEqual({ version: '1.0.0' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls).toEqual([SLOW, GOOD]);
  });

  it('rejects in bounded time when every endpoint hangs', async () => {
    stubFetch({
      [SLOW]: () => new Promise<Response>(() => {}),
      [GOOD]: () => new Promise<Response>(() => {}),
    });
    const rpc = createRpc([SLOW, GOOD], { timeoutMs: 30 });
    await expect(rpc.callFunction(VIEW)).rejects.toThrow();
  });

  it("does not retry Node's 'fetch failed': near-api-js moves to the next endpoint at once", async () => {
    const calls = stubFetch({
      [DEAD]: () => Promise.reject(new TypeError('fetch failed')),
      [GOOD]: async () => viewAnswer(7),
    });
    const rpc = createRpc([DEAD, GOOD]);
    expect(await rpc.callFunction(VIEW)).toBe(7);
    expect(calls).toEqual([DEAD, GOOD]);
  });

  it('retries an HTTP 503 on the same endpoint before moving on', async () => {
    let first = true;
    const calls = stubFetch({
      [DEAD]: async () => {
        if (first) {
          first = false;
          return new Response('unavailable', { status: 503 });
        }
        return viewAnswer(8);
      },
    });
    const rpc = createRpc([DEAD]);
    expect(await rpc.callFunction(VIEW)).toBe(8);
    expect(calls).toEqual([DEAD, DEAD]);
  });
});

// The policy a DAO made by sputnikv2.testnet with the default policy answers to `get_policy`
// (shape read from peter.sputnikv2.testnet on 2026-11-13), with a council of three.
const COUNCIL = ['a.testnet', 'b.testnet', 'c.testnet'];
function daoPolicy(
  overrides: { council?: Record<string, unknown>; defaultVotePolicy?: unknown } = {},
) {
  return {
    roles: [
      { name: 'all', kind: 'Everyone', permissions: ['*:AddProposal'], vote_policy: {} },
      {
        name: 'council',
        kind: { Group: COUNCIL },
        permissions: [
          '*:Finalize',
          '*:AddProposal',
          '*:VoteApprove',
          '*:VoteReject',
          '*:VoteRemove',
        ],
        vote_policy: {},
        ...overrides.council,
      },
    ],
    default_vote_policy: overrides.defaultVotePolicy ?? {
      weight_kind: 'RoleWeight',
      quorum: '0',
      threshold: [1, 2],
    },
    proposal_bond: '1000000000000000000000000',
    proposal_period: '604800000000000',
    bounty_bond: '1000000000000000000000000',
    bounty_forgiveness_period: '86400000000000',
  };
}

/** `get_policy` of ticket-jury.sputnikv2.testnet (Sputnik DAO 2.3.1), as the chain answered it. */
const TICKET_JURY_POLICY = {
  bounty_bond: '1000000000000000000000000',
  bounty_forgiveness_period: '86400000000000',
  default_vote_policy: { quorum: '0', threshold: [1, 2], weight_kind: 'RoleWeight' },
  proposal_bond: '1000000000000000000000000',
  proposal_period: '604800000000000',
  roles: [
    { kind: 'Everyone', name: 'all', permissions: ['*:AddProposal'], vote_policy: {} },
    {
      kind: {
        Group: ['te-d1-venue.testnet', 'te-d1-verifier.testnet', 'te-d1-auditor.testnet'],
      },
      name: 'council',
      permissions: ['*:Finalize', '*:AddProposal', '*:VoteApprove', '*:VoteReject', '*:VoteRemove'],
      vote_policy: {},
    },
  ],
};

describe('readGroupVerifier', () => {
  it("reads the real policy of the group-verifier proof's DAO: 3 members, 2 needed", () => {
    expect(groupVerifierOf(TICKET_JURY_POLICY)).toEqual({
      members: ['te-d1-venue.testnet', 'te-d1-verifier.testnet', 'te-d1-auditor.testnet'],
      needed: 2,
    });
  });

  async function read(policy: unknown) {
    const { rpc, calls } = fakeRpc({ get_policy: policy });
    const group = await createReader({ contractId: CONTRACT, rpc }).readGroupVerifier?.(
      'dao.sputnikv2.testnet',
    );
    return { group, calls };
  }

  it('reads a Sputnik DAO council under the default policy: 2 of 3 must agree', async () => {
    const { group, calls } = await read(daoPolicy());
    expect(group).toEqual({ members: COUNCIL, needed: 2 });
    expect(calls).toEqual([
      {
        kind: 'viewAccount',
        params: { accountId: 'dao.sputnikv2.testnet', blockQuery: FINAL },
      },
      {
        kind: 'callFunction',
        params: {
          contractId: 'dao.sputnikv2.testnet',
          method: 'get_policy',
          args: {},
          blockQuery: FINAL,
        },
      },
    ]);
  });

  it('applies min(n, floor(n * num / den) + 1) to the ratio', async () => {
    const ratio = (threshold: [number, number], members: string[]) =>
      groupVerifierOf(
        daoPolicy({
          council: { kind: { Group: members } },
          defaultVotePolicy: { weight_kind: 'RoleWeight', quorum: '0', threshold },
        }),
      )?.needed;
    const five = ['a.testnet', 'b.testnet', 'c.testnet', 'd.testnet', 'e.testnet'];
    expect(ratio([1, 2], five)).toBe(3);
    expect(ratio([2, 3], five)).toBe(4);
    expect(ratio([1, 1], five)).toBe(5);
    expect(ratio([0, 1], five)).toBe(1);
    expect(ratio([1, 2], ['a.testnet', 'b.testnet'])).toBe(2);
  });

  it("uses the role's own policy for a label before the default one", async () => {
    const { group } = await read(
      daoPolicy({
        council: {
          permissions: ['call:VoteApprove'],
          vote_policy: { call: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 1] } },
        },
      }),
    );
    expect(group?.needed).toBe(3);
  });

  describe('counts every label that can change who decides calls', () => {
    const byOne = { weight_kind: 'RoleWeight', quorum: '0', threshold: '1' };

    it('one member alone can change the policy: needed is 1, not 2', () => {
      for (const label of ['policy', 'policy_add_or_update_role', 'policy_update_parameters']) {
        const policy = daoPolicy({
          council: { permissions: ['*:*'], vote_policy: { [label]: byOne } },
        });
        expect(groupVerifierOf(policy), label).toEqual({ members: COUNCIL, needed: 1 });
      }
    });

    it('one member alone can add or remove members, or upgrade the contract: needed is 1', () => {
      for (const label of [
        'add_member_to_role',
        'remove_member_from_role',
        'upgrade_self',
        'upgrade_remote',
        'config',
      ]) {
        const policy = daoPolicy({ council: { vote_policy: { [label]: byOne } } });
        expect(groupVerifierOf(policy), label).toEqual({ members: COUNCIL, needed: 1 });
      }
    });

    it('another group that can approve a policy change, an upgrade or a new member gives null', () => {
      for (const permission of [
        'policy:VoteApprove',
        'policy_remove_role:*',
        'upgrade_self:VoteApprove',
        'add_member_to_role:VoteApprove',
      ]) {
        const policy = daoPolicy();
        policy.roles.push({
          name: 'board',
          kind: { Group: ['a.testnet'] },
          permissions: [permission],
          vote_policy: {},
        } as never);
        expect(groupVerifierOf(policy), permission).toBeNull();
      }
    });

    it('a label that weighs by token gives null; a label that can never pass is left out', () => {
      const tokenWeight = { weight_kind: 'TokenWeight', quorum: '0', threshold: [1, 2] };
      expect(
        groupVerifierOf(daoPolicy({ council: { vote_policy: { policy: tokenWeight } } })),
      ).toBeNull();
      const never = { weight_kind: 'RoleWeight', quorum: '9', threshold: [1, 2] };
      expect(
        groupVerifierOf(daoPolicy({ council: { vote_policy: { upgrade_self: never } } })),
      ).toEqual({ members: COUNCIL, needed: 2 });
      expect(groupVerifierOf(daoPolicy({ council: { vote_policy: { call: never } } }))).toBeNull();
    });

    it('a group that cannot approve calls is not described, even if it decides the policy', () => {
      expect(
        groupVerifierOf(daoPolicy({ council: { permissions: ['policy:VoteApprove'] } })),
      ).toBeNull();
    });
  });

  it('counts the quorum and a fixed weight as the contract does', async () => {
    const policy = (vote: unknown) => groupVerifierOf(daoPolicy({ defaultVotePolicy: vote }));
    expect(policy({ weight_kind: 'RoleWeight', quorum: '3', threshold: [1, 2] })?.needed).toBe(3);
    expect(policy({ weight_kind: 'RoleWeight', quorum: '0', threshold: '2' })?.needed).toBe(2);
    expect(policy({ weight_kind: 'RoleWeight', quorum: '0', threshold: '9' })?.needed).toBe(3);
    // More votes than members can never be reached: not described as a group that decides.
    expect(policy({ weight_kind: 'RoleWeight', quorum: '4', threshold: [1, 2] })).toBeNull();
  });

  it('accepts each permission that lets the council approve a function call', () => {
    for (const permission of ['*:*', 'call:*', '*:VoteApprove', 'call:VoteApprove']) {
      expect(
        groupVerifierOf(daoPolicy({ council: { permissions: [permission] } })),
        permission,
      ).toEqual({
        members: COUNCIL,
        needed: 2,
      });
    }
    // Another group that cannot approve calls is ignored.
    const withOthers = daoPolicy();
    withOthers.roles.push({
      name: 'community',
      kind: { Group: ['d.testnet'] },
      permissions: ['*:AddProposal'],
      vote_policy: {},
    } as never);
    expect(groupVerifierOf(withOthers)).toEqual({ members: COUNCIL, needed: 2 });
    // A role of another kind that can approve calls gives null, Everyone included.
    for (const kind of ['Everyone', { Member: '1' }]) {
      const open = daoPolicy();
      open.roles.push({
        name: 'open',
        kind,
        permissions: ['call:VoteApprove'],
        vote_policy: {},
      } as never);
      expect(groupVerifierOf(open), JSON.stringify(kind)).toBeNull();
    }
    for (const permission of ['transfer:VoteApprove', '*:VoteReject', 'call:AddProposal']) {
      expect(
        groupVerifierOf(daoPolicy({ council: { permissions: [permission] } })),
        permission,
      ).toBeNull();
    }
  });

  it('is null for anything that is not one group deciding by role weight', () => {
    const tokenWeight = { weight_kind: 'TokenWeight', quorum: '0', threshold: [1, 2] };
    const twoGroups = daoPolicy();
    twoGroups.roles.push({
      ...twoGroups.roles[1],
      name: 'board',
      kind: { Group: ['d.testnet'] },
    } as never);
    const memberRole = daoPolicy({ council: { kind: { Member: '1' } } });
    for (const policy of [
      daoPolicy({ defaultVotePolicy: tokenWeight }),
      twoGroups,
      memberRole,
      daoPolicy({ council: { kind: { Group: [] } } }),
      daoPolicy({ council: { kind: { Group: ['Not An Account'] } } }),
      { roles: 'none' },
      null,
      '1.0.0',
    ]) {
      expect(groupVerifierOf(policy)).toBeNull();
    }
  });

  it('does not ask an account without code for a policy (near-api-js logs every failed view)', async () => {
    const { rpc, calls } = fakeRpc({ get_policy: daoPolicy() });
    const plain: ReaderRpc = {
      ...rpc,
      async viewAccount(params) {
        calls.push({ kind: 'viewAccount', params });
        return { amount: 1n, code_hash: '1'.repeat(32), block_height: 1 };
      },
    };
    const reader = createReader({ contractId: CONTRACT, rpc: plain });
    expect(await reader.readGroupVerifier?.('teatro.testnet')).toBeNull();
    expect(calls.map((c) => c.kind)).toEqual(['viewAccount']);
  });

  it('is null for a plain account, or when the view fails', async () => {
    const rpc: ReaderRpc = {
      ...fakeRpc({}).rpc,
      async callFunction() {
        throw new Error('CodeDoesNotExist');
      },
    };
    expect(
      await createReader({ contractId: CONTRACT, rpc }).readGroupVerifier?.('teatro.testnet'),
    ).toBeNull();
  });

  it('answers on fixture data from its policies, and null for every other account', async () => {
    const reader = createFixtureReader({ ...FIXTURES, policies: { 'dao.testnet': daoPolicy() } });
    expect(await reader.readGroupVerifier?.('dao.testnet')).toEqual({
      members: COUNCIL,
      needed: 2,
    });
    expect(await reader.readGroupVerifier?.('teatro.testnet')).toBeNull();
    expect(await createFixtureReader().readGroupVerifier?.('teatro.testnet')).toBeNull();
  });
});
