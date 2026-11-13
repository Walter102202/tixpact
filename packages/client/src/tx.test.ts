import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from './errors.js';
import { createFixtureRpc, FIXTURE_CONTRACT_ID, TX_FIXTURES } from './fixtures.js';
import {
  explorerAccountUrl,
  explorerTxUrl,
  moneyMoved,
  readUntilChanged,
  summarizeTransaction,
  type TxStage,
  type TxStatusRpc,
  TxStatusSchema,
  trackTransaction,
} from './tx.js';

const noSleep = async () => {};

type Outcome = { id: string; outcome: Record<string, unknown> };

/** A recorded status, parsed, with its receipt outcomes rewritten by `edit`. */
function edited(
  status: Record<string, unknown>,
  edit: (receipts: Outcome[]) => Outcome[],
  finalStatus?: unknown,
) {
  const copy = structuredClone(status) as { receipts_outcome: Outcome[]; status: unknown };
  copy.receipts_outcome = edit(copy.receipts_outcome);
  if (finalStatus !== undefined) copy.status = finalStatus;
  return copy;
}

/** An RPC that answers every request with the next status in the list, then repeats the last. */
function answering(...statuses: unknown[]): TxStatusRpc & { requests: number } {
  const rpc = {
    requests: 0,
    async viewTransactionStatusWithReceipts() {
      const answer = statuses[Math.min(rpc.requests, statuses.length - 1)];
      rpc.requests += 1;
      return structuredClone(answer);
    },
  };
  return rpc;
}

async function track(rpc: TxStatusRpc, hash: string, signerId: string) {
  const stages: TxStage[] = [];
  const result = await trackTransaction(rpc, hash, signerId, (stage) => stages.push(stage), {
    sleep: noSleep,
  });
  return { result, stages };
}

describe('trackTransaction on recorded statuses', () => {
  const rpc = createFixtureRpc();

  it('returns ok: false with the failed callback receipt (Review Focus 1)', async () => {
    const tx = TX_FIXTURES.refundCallbackFailed;
    const { result, stages } = await track(rpc, tx.hash, tx.signerId);
    expect(result.ok).toBe(false);
    expect(result.failedReceipt).toEqual({
      receiptId: tx.failedReceiptId,
      executorId: FIXTURE_CONTRACT_ID,
      step: 'callback',
      error: { code: 'UNKNOWN', message: 'The call ran out of gas before it finished.' },
    });
    expect(stages).toEqual(['sending', 'executed', 'final']);
  });

  it('returns ok: false when the refund transfer failed even though the transaction succeeded', async () => {
    const tx = TX_FIXTURES.refundTransferFailed;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result.ok).toBe(false);
    expect(result.failedReceipt?.receiptId).toBe(tx.failedReceiptId);
    expect(result.failedReceipt?.executorId).toBe('vanishing-holder.testnet');
    expect(result.failedReceipt?.step).toBe('other');
    expect(result.failedReceipt?.error.message).toBe(
      'Account vanishing-holder.testnet does not exist.',
    );
    expect(result.value).toBe(false);
  });

  it('returns ok: true and the decoded value when every receipt succeeded', async () => {
    const tx = TX_FIXTURES.refundSettled;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result).toEqual({ ok: true, value: true });
  });

  it('decodes a string return value', async () => {
    const tx = TX_FIXTURES.buySucceeded;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result).toEqual({ ok: true, value: '1-4' });
  });

  it('reads a transfer that returns nothing as ok with no value', async () => {
    const tx = TX_FIXTURES.transferSucceeded;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result).toEqual({ ok: true });
  });

  it('reads the recorded organizer and verifier calls as they settled', async () => {
    const expected = [
      [TX_FIXTURES.eventCreated, { ok: true, value: 9 }],
      [TX_FIXTURES.verificationAccepted, { ok: true }],
      [TX_FIXTURES.eventAttested, { ok: true }],
      [TX_FIXTURES.eventCancelled, { ok: true }],
      [TX_FIXTURES.payoutSettled, { ok: true, value: true }],
    ] as const;
    for (const [tx, result] of expected) {
      const tracked = await track(rpc, tx.hash, tx.signerId);
      expect(tracked.result, tx.hash).toEqual(result);
    }
  });

  it('maps a contract panic to its error code', async () => {
    const tx = TX_FIXTURES.buyRejected;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result.ok).toBe(false);
    expect(result.failedReceipt?.receiptId).toBe(tx.failedReceiptId);
    expect(result.failedReceipt?.step).toBe('contract');
    expect(result.failedReceipt?.error).toEqual({
      code: 'ERR_SOLD_OUT',
      message: ERROR_MESSAGES.ERR_SOLD_OUT,
    });
  });
});

describe('trackTransaction polling', () => {
  const recorded = TX_FIXTURES.refundSettled;

  it('waits for execution, then for finality, retrying while the transaction is unknown', async () => {
    const requests: string[] = [];
    let unknownOnce = true;
    const rpc: TxStatusRpc = {
      async viewTransactionStatusWithReceipts(params) {
        requests.push(params.waitUntil);
        expect(params).toMatchObject({ txHash: recorded.hash, accountId: recorded.signerId });
        if (unknownOnce) {
          unknownOnce = false;
          throw new Error('Transaction doesn’t exist');
        }
        const level = params.waitUntil === 'FINAL' ? 'FINAL' : 'EXECUTED_OPTIMISTIC';
        return { ...recorded.status, final_execution_status: level };
      },
    };
    const sleeps: number[] = [];
    const stages: TxStage[] = [];
    const result = await trackTransaction(
      rpc,
      recorded.hash,
      recorded.signerId,
      (stage) => stages.push(stage),
      { sleep: async (ms) => void sleeps.push(ms), intervalMs: 250 },
    );
    expect(result.ok).toBe(true);
    expect(requests).toEqual(['EXECUTED_OPTIMISTIC', 'EXECUTED_OPTIMISTIC', 'FINAL']);
    expect(sleeps).toEqual([250]);
    expect(stages).toEqual(['sending', 'executed', 'final']);
  });

  it('judges the transaction on its final status, not the optimistic one', async () => {
    const failed = TX_FIXTURES.refundCallbackFailed;
    const rpc: TxStatusRpc = {
      async viewTransactionStatusWithReceipts(params) {
        return params.waitUntil === 'FINAL'
          ? failed.status
          : { ...recorded.status, final_execution_status: 'EXECUTED_OPTIMISTIC' };
      },
    };
    const result = await trackTransaction(rpc, failed.hash, failed.signerId, () => {}, {
      sleep: noSleep,
    });
    expect(result.ok).toBe(false);
  });

  it('keeps polling when the node answers below the requested stage', async () => {
    let answers = 0;
    const rpc: TxStatusRpc = {
      async viewTransactionStatusWithReceipts() {
        answers += 1;
        return answers === 1 ? { final_execution_status: 'INCLUDED' } : recorded.status;
      },
    };
    const result = await trackTransaction(rpc, recorded.hash, recorded.signerId, () => {}, {
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(answers).toBe(2);
  });

  it('gives up after the attempts, naming the transaction', async () => {
    let attempts = 0;
    const rpc: TxStatusRpc = {
      async viewTransactionStatusWithReceipts() {
        attempts += 1;
        throw new Error('timeout');
      },
    };
    const stages: TxStage[] = [];
    await expect(
      trackTransaction(rpc, recorded.hash, recorded.signerId, (stage) => stages.push(stage), {
        sleep: noSleep,
        attempts: 3,
      }),
    ).rejects.toThrow(recorded.hash);
    expect(attempts).toBe(3);
    expect(stages).toEqual(['sending']);
  });
});

describe('a transaction is ok only when every outcome succeeded', () => {
  const settled = TX_FIXTURES.refundSettled;

  it('never reports ok while an outcome is still Unknown at FINAL, and gives up', async () => {
    const unknown = edited(settled.status, (receipts) =>
      receipts.map((r, i) =>
        i === 2 ? { ...r, outcome: { ...r.outcome, status: 'Unknown' } } : r,
      ),
    );
    const rpc = answering(unknown);
    await expect(
      trackTransaction(rpc, settled.hash, settled.signerId, () => {}, {
        sleep: noSleep,
        attempts: 3,
      }),
    ).rejects.toThrow(settled.hash);
    expect(summarizeTransaction(TxStatusSchema.parse(unknown))).toEqual({
      ok: false,
      value: true,
    });
  });

  it('keeps polling while the final status is Started, then judges the settled answer', async () => {
    const started = edited(settled.status, (receipts) => receipts.slice(0, 2), 'Started');
    const rpc = answering(started, settled.status);
    const result = await trackTransaction(rpc, settled.hash, settled.signerId, () => {}, {
      sleep: noSleep,
    });
    expect(result).toEqual({ ok: true, value: true });
    expect(rpc.requests).toBe(2);
    const stuck = answering(started);
    await expect(
      trackTransaction(stuck, settled.hash, settled.signerId, () => {}, {
        sleep: noSleep,
        attempts: 2,
      }),
    ).rejects.toThrow(/Could not confirm transaction/);
  });

  it('reports a failure that happened in the transaction outcome alone', async () => {
    const rejected = {
      ...structuredClone(settled.status),
      status: { Failure: { InvalidTxError: { NotEnoughBalance: { signer_id: 'luis.testnet' } } } },
      receipts_outcome: [],
    };
    const tx = rejected as unknown as { transaction_outcome: Outcome };
    tx.transaction_outcome.outcome = {
      ...tx.transaction_outcome.outcome,
      receipt_ids: [],
      status: { Failure: { InvalidTxError: { NotEnoughBalance: { signer_id: 'luis.testnet' } } } },
    };
    const { result } = await track(answering(rejected), settled.hash, settled.signerId);
    expect(result).toEqual({
      ok: false,
      failedReceipt: {
        receiptId: settled.hash,
        executorId: 'luis.testnet',
        step: 'transaction',
        error: { code: 'UNKNOWN', message: 'The account does not have enough NEAR for this.' },
      },
    });
  });
});

describe('moneyMoved', () => {
  it('is true only when the claim settled and the contract says money moved', async () => {
    const rpc = createFixtureRpc();
    const settled = await track(rpc, TX_FIXTURES.refundSettled.hash, 'luis.testnet');
    expect(moneyMoved(settled.result)).toBe(true);
    const callbackFailed = await track(rpc, TX_FIXTURES.refundCallbackFailed.hash, 'luis.testnet');
    expect(moneyMoved(callbackFailed.result)).toBe(false);
  });

  it('is false when every receipt succeeded but the contract returned false', () => {
    // The reviewer's reproduction: the transfer-failed recording without its failed receipt.
    const tx = TX_FIXTURES.refundTransferFailed;
    const withoutFailure = edited(tx.status, (receipts) =>
      receipts.filter((r) => r.id !== tx.failedReceiptId),
    );
    const result = summarizeTransaction(TxStatusSchema.parse(withoutFailure));
    expect(result).toEqual({ ok: true, value: false });
    expect(moneyMoved(result)).toBe(false);
  });
});

describe('readUntilChanged', () => {
  it('returns the first read that differs from the snapshot', async () => {
    const reads = [{ status: 'Active' }, { status: 'Active' }, { status: 'RefundPending' }];
    let i = 0;
    const sleeps: number[] = [];
    const result = await readUntilChanged(
      async () => reads[Math.min(i++, reads.length - 1)],
      { status: 'Active' },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toEqual({ changed: true, value: { status: 'RefundPending' } });
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('gives up after five reads, one second apart, and says nothing changed', async () => {
    let reads = 0;
    const sleeps: number[] = [];
    const result = await readUntilChanged(
      async () => {
        reads += 1;
        return { sold: 3 };
      },
      { sold: 3 },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toEqual({ changed: false, value: { sold: 3 } });
    expect(reads).toBe(5);
    expect(sleeps).toEqual([1000, 1000, 1000, 1000]);
  });
});

describe('explorer links', () => {
  it('point at the testnet explorer', () => {
    expect(explorerTxUrl('7Yk2wHq3PNm8vT1cRb4sXa9dEfGjKu5LzQo6Wn2Hy3Mp')).toBe(
      'https://testnet.nearblocks.io/txns/7Yk2wHq3PNm8vT1cRb4sXa9dEfGjKu5LzQo6Wn2Hy3Mp',
    );
    expect(explorerAccountUrl('luis.testnet')).toBe(
      'https://testnet.nearblocks.io/address/luis.testnet',
    );
  });
});
