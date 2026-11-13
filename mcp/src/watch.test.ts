import {
  actions,
  type ContractCall,
  createFixtureReader,
  createFixtureRpc,
  FIXTURE_CONTRACT_ID,
  FIXTURES,
  type Reader,
  type RecordedTx,
  TX_FIXTURES,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { createAgent } from './agent.js';
import type { AgentConfig } from './config.js';
import type { AgentSigner } from './signer.js';
import { watch, watchOnce } from './watch.js';

const AGENT = 'luis.testnet';
const EXPIRE_HASH = 'ExpireOkHash11111111111111111111111111111111';

const config: AgentConfig = {
  network: 'testnet',
  contractId: FIXTURE_CONTRACT_ID,
  rpcUrls: ['https://rpc.invalid'],
  agentAccountId: AGENT,
  caps: { maxPriceYocto: '1', maxExposureYocto: '1' },
  hasKey: true,
};

/** A final status in which every receipt succeeded and the call returned `value`. */
function okTx(hash: string, value: unknown): RecordedTx {
  const base64 = Buffer.from(JSON.stringify(value)).toString('base64');
  return {
    hash,
    signerId: AGENT,
    failedReceiptId: null,
    status: {
      final_execution_status: 'FINAL',
      status: { SuccessValue: base64 },
      transaction_outcome: {
        id: hash,
        outcome: {
          executor_id: AGENT,
          logs: [],
          receipt_ids: [],
          status: { SuccessReceiptId: 'r' },
        },
      },
      receipts_outcome: [],
    },
  };
}

function setup(reader: Reader = createFixtureReader()) {
  const calls: ContractCall[] = [];
  const signer: AgentSigner = {
    accountId: AGENT,
    async signAndSend(_receiverId, call) {
      calls.push(call);
      return call.methodName === 'expire_event' ? EXPIRE_HASH : TX_FIXTURES.refundSettled.hash;
    },
  };
  const agent = createAgent({
    config,
    reader,
    txRpc: createFixtureRpc({ ...TX_FIXTURES, expired: okTx(EXPIRE_HASH, 'Refundable') }),
    signer,
    track: { attempts: 1, sleep: async () => {} },
  });
  const lines: string[] = [];
  return { agent, calls, lines, log: (line: string) => lines.push(line) };
}

describe('watchOnce', () => {
  it('expires an event past its deadline, then claims every claimable ticket, logging each hash', async () => {
    // luis.testnet holds 6-1 (event 6 past its deadline, unresolved) and 8-1 (event 8 cancelled).
    const { agent, calls, lines, log } = setup();
    const round = await watchOnce({ agent, log });
    expect(calls).toEqual([
      actions.expireEvent(6),
      actions.claimRefund('6-1'),
      actions.claimRefund('8-1'),
    ]);
    expect(round).toEqual({ expired: [6], claimed: ['6-1', '8-1'], problems: 0 });
    expect(lines).toEqual([
      `expire_event 6: succeeded, tx ${EXPIRE_HASH} https://testnet.nearblocks.io/txns/${EXPIRE_HASH}`,
      `claim_refund 6-1: succeeded, tx ${TX_FIXTURES.refundSettled.hash} https://testnet.nearblocks.io/txns/${TX_FIXTURES.refundSettled.hash}`,
      `claim_refund 8-1: succeeded, tx ${TX_FIXTURES.refundSettled.hash} https://testnet.nearblocks.io/txns/${TX_FIXTURES.refundSettled.hash}`,
    ]);
  });

  it('leaves alone tickets that are reserved inside their deadline, being sent, refunded or released', async () => {
    const { agent, calls, log } = setup();
    await watchOnce({ agent, log });
    const touched = calls.map((c) => c.args.token_id ?? c.args.event_id);
    for (const untouched of ['1-3', '3-2', '5-1', '7-1', '8-2', '8-3']) {
      expect(touched).not.toContain(untouched);
    }
  });

  it('says so when there is nothing to claim', async () => {
    const data = { ...FIXTURES, tickets: FIXTURES.tickets.filter((t) => t.token_id === '1-3') };
    const { agent, calls, lines, log } = setup(createFixtureReader(data));
    expect(await watchOnce({ agent, log })).toEqual({ expired: [], claimed: [], problems: 0 });
    expect(calls).toEqual([]);
    expect(lines).toEqual(['Nothing to claim: 1 ticket held, none claimable now.']);
  });

  it('logs a claim that did not go through, and still tries the others', async () => {
    const lines: string[] = [];
    const keyless = createAgent({
      config,
      reader: createFixtureReader(),
      txRpc: createFixtureRpc(),
      signer: null,
    });
    const round = await watchOnce({ agent: keyless, log: (line) => lines.push(line) });
    expect(round).toEqual({ expired: [], claimed: [], problems: 3 });
    expect(lines[0]).toMatch(/^expire_event 6: denied: no key configured/);
    expect(lines.slice(1).map((l) => l.split(':')[0])).toEqual([
      'claim_refund 6-1',
      'claim_refund 8-1',
    ]);
  });
});

describe('watch', () => {
  it('runs a round, waits the interval, and stops when told to', async () => {
    const { agent, lines, log } = setup();
    const controller = new AbortController();
    const waits: number[] = [];
    await watch({
      agent,
      log,
      intervalMs: 30_000,
      signal: controller.signal,
      sleep: async (ms) => {
        waits.push(ms);
        if (waits.length === 2) controller.abort();
      },
    });
    expect(waits).toEqual([30_000, 30_000]);
    expect(lines[0]).toBe(
      'Watching luis.testnet: a plain loop that checks every 30 s. Stop it with Ctrl+C.',
    );
    expect(lines.filter((l) => l.startsWith('claim_refund 8-1'))).toHaveLength(2);
    expect(lines.at(-1)).toBe('Stopped.');
  });

  it('logs a round that failed and keeps going', async () => {
    let reads = 0;
    const flaky: Reader = {
      ...createFixtureReader(),
      async listTicketsForOwner() {
        reads += 1;
        throw new Error('RPC unreachable');
      },
    };
    const { agent, lines, log } = setup(flaky);
    const controller = new AbortController();
    await watch({
      agent,
      log,
      intervalMs: 5,
      signal: controller.signal,
      sleep: async () => {
        if (reads === 2) controller.abort();
      },
    });
    expect(lines.filter((l) => l === 'Round failed: RPC unreachable')).toHaveLength(2);
  });
});
