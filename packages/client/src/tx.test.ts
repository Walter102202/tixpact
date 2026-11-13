import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from './errors.js';
import { createFixtureRpc, FIXTURE_CONTRACT_ID, TX_FIXTURES } from './fixtures.js';
import {
  explorerAccountUrl,
  explorerTxUrl,
  moneyMoved,
  purchaseResult,
  readUntilChanged,
  summarizeTransaction,
  type TxStage,
  type TxStatusRpc,
  TxStatusSchema,
  trackTransaction,
} from './tx.js';

const noSleep = async () => {};

/** The NEP-297 events a result should list, by name, in order. */
const logged = (...names: string[]) =>
  names.map((event) => expect.objectContaining({ event, receiptId: expect.any(String) }));

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
    expect(result).toEqual({
      ok: true,
      value: true,
      events: logged('refund_requested', 'refund_settled'),
    });
  });

  it('decodes a string return value', async () => {
    const tx = TX_FIXTURES.buySucceeded;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result).toEqual({
      ok: true,
      value: '1-4',
      events: logged('nft_mint', 'ticket_purchased'),
    });
  });

  it('reads a transfer that returns nothing as ok with no value', async () => {
    const tx = TX_FIXTURES.transferSucceeded;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result).toEqual({ ok: true, events: logged('nft_transfer') });
  });

  it('reads the recorded organizer and verifier calls as they settled', async () => {
    const expected = [
      [TX_FIXTURES.eventCreated, { ok: true, value: 9, events: [] }],
      [TX_FIXTURES.verificationAccepted, { ok: true, events: [] }],
      [TX_FIXTURES.eventAttested, { ok: true, events: [] }],
      [TX_FIXTURES.eventCancelled, { ok: true, events: [] }],
      [
        TX_FIXTURES.payoutSettled,
        { ok: true, value: true, events: logged('payout_requested', 'payout_settled') },
      ],
    ] as const;
    for (const [tx, result] of expected) {
      const tracked = await track(rpc, tx.hash, tx.signerId);
      expect(tracked.result, tx.hash).toEqual(result);
    }
  });

  it('reads the recorded token registration and faucet calls as they settled, on the token', async () => {
    const registered = await track(
      rpc,
      TX_FIXTURES.tokenRegistered.hash,
      TX_FIXTURES.tokenRegistered.signerId,
    );
    expect(registered.result).toEqual({
      ok: true,
      value: { total: '1250000000000000000000', available: '0' },
      events: [],
    });
    const minted = await track(
      rpc,
      TX_FIXTURES.faucetMinted.hash,
      TX_FIXTURES.faucetMinted.signerId,
    );
    expect(minted.result).toEqual({ ok: true, value: '100000000', events: logged('ft_mint') });
    expect(minted.result.events?.[0]?.executorId).toBe('tusd.testnet');
    for (const tx of [TX_FIXTURES.tokenRegistered, TX_FIXTURES.faucetMinted]) {
      const status = TxStatusSchema.parse(tx.status);
      expect(status.receipts_outcome[0]?.outcome.executor_id, tx.hash).toBe('tusd.testnet');
    }
    // Each recording is the call the builder makes, sent to the token.
    const sent = (tx: { status: Record<string, unknown> }) =>
      tx.status.transaction as { receiver_id: string; actions: unknown[] };
    expect(sent(TX_FIXTURES.tokenRegistered)).toMatchObject({
      receiver_id: 'tusd.testnet',
      actions: [
        {
          FunctionCall: {
            method_name: 'storage_deposit',
            args: btoa(JSON.stringify({ account_id: 'sofia.testnet', registration_only: true })),
            deposit: '1250000000000000000000',
          },
        },
      ],
    });
    expect(sent(TX_FIXTURES.faucetMinted)).toMatchObject({
      receiver_id: 'tusd.testnet',
      actions: [{ FunctionCall: { method_name: 'faucet', deposit: '0' } }],
    });
  });

  it('reads a payout whose transfer to the organizer failed as failed, with false', async () => {
    const tx = TX_FIXTURES.payoutTransferFailed;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result.ok).toBe(false);
    expect(result.failedReceipt?.receiptId).toBe(tx.failedReceiptId);
    expect(result.failedReceipt?.executorId).toBe('org.testnet');
    expect(result.failedReceipt?.step).toBe('other');
    expect(result.value).toBe(false);
  });

  it('reads a payout whose confirmation ran out of gas as failed at the callback', async () => {
    const tx = TX_FIXTURES.payoutCallbackFailed;
    const { result } = await track(rpc, tx.hash, tx.signerId);
    expect(result.ok).toBe(false);
    expect(result.failedReceipt?.receiptId).toBe(tx.failedReceiptId);
    expect(result.failedReceipt?.step).toBe('callback');
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
      // The callback has not run, so its refund_settled is not an event yet.
      events: logged('refund_requested'),
    });
  });

  it('keeps polling while the final status is Started, then judges the settled answer', async () => {
    const started = edited(settled.status, (receipts) => receipts.slice(0, 2), 'Started');
    const rpc = answering(started, settled.status);
    const result = await trackTransaction(rpc, settled.hash, settled.signerId, () => {}, {
      sleep: noSleep,
    });
    expect(result).toEqual({
      ok: true,
      value: true,
      events: logged('refund_requested', 'refund_settled'),
    });
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
      events: [],
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
    expect(result).toEqual({
      ok: true,
      value: false,
      events: logged('refund_requested', 'refund_failed'),
    });
    expect(moneyMoved(result)).toBe(false);
  });
});

describe('purchaseResult', () => {
  const rpc = createFixtureRpc();
  const ESCROW = FIXTURE_CONTRACT_ID;
  const judged = async (tx: { hash: string; signerId: string }) =>
    (await track(rpc, tx.hash, tx.signerId)).result;
  const purchasedLog = (tokenId: string) =>
    `EVENT_JSON:${JSON.stringify({ standard: 'ticket_escrow', version: '2.0.0', event: 'ticket_purchased', data: [{ event_id: 12, token_id: tokenId }] })}`;
  /** A recorded status with the logs of receipt `index` replaced. */
  const withLogs = (status: Record<string, unknown>, index: number, logs: string[]) =>
    edited(status, (receipts) =>
      receipts.map((r, i) => (i === index ? { ...r, outcome: { ...r.outcome, logs } } : r)),
    );
  /** A recorded status with receipt `index` failed by a panic with this message. */
  const panickedAt = (status: Record<string, unknown>, index: number, message: string) =>
    edited(status, (receipts) =>
      receipts.map((r, i) =>
        i === index
          ? {
              ...r,
              outcome: {
                ...r.outcome,
                status: {
                  Failure: {
                    ActionError: {
                      index: 0,
                      kind: {
                        FunctionCallError: {
                          ExecutionError: `Smart contract panicked: ${message}`,
                        },
                      },
                    },
                  },
                },
              },
            }
          : r,
      ),
    );
  const summary = (status: unknown) => summarizeTransaction(TxStatusSchema.parse(status));

  it('reads a token purchase the contract kept as bought, with the ticket it logged', async () => {
    const result = await judged(TX_FIXTURES.tokenBuySucceeded);
    expect(result.ok).toBe(true);
    // The transaction's value is the token resolver's: the amount kept, not the ticket id.
    expect(result.value).toBe('10000000');
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: true, tokenId: '10-3' });
  });

  it('reads a token purchase the contract rejected as not bought, although the transaction succeeded', async () => {
    const tx = TX_FIXTURES.tokenBuyRejected;
    const status = TxStatusSchema.parse(tx.status);
    // The chain calls the transaction a success: the token refunded the buyer in its resolver.
    expect(status.status).toEqual({ SuccessValue: btoa('"0"') });
    const result = await judged(tx);
    expect(result.failedReceipt?.receiptId).toBe(tx.failedReceiptId);
    expect(result.failedReceipt?.executorId).toBe(ESCROW);
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: false, code: 'ERR_TOO_LATE' });
  });

  it('reports the v2 purchase codes of a rejected ft_on_transfer', () => {
    for (const code of ['ERR_WRONG_CURRENCY', 'ERR_BAD_MESSAGE', 'ERR_WRONG_DEPOSIT']) {
      const result = summary(panickedAt(TX_FIXTURES.tokenBuyRejected.status, 1, `${code}: no`));
      expect(purchaseResult(result, ESCROW)).toEqual({ bought: false, code });
    }
  });

  it('reads a purchase the token refused before the contract ran as not bought, with no code', async () => {
    const result = await judged(TX_FIXTURES.tokenBuyUnfunded);
    expect(result.ok).toBe(false);
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: false, code: null });
  });

  it('takes the code only from a failed receipt the escrow ran', () => {
    // A token whose own panic starts with an ERR_ code is not the escrow's answer.
    const result = summary(
      panickedAt(TX_FIXTURES.tokenBuyUnfunded.status, 0, 'ERR_SOLD_OUT: the token says so'),
    );
    expect(result.failedReceipt).toMatchObject({
      executorId: 'tusd.testnet',
      error: { code: 'ERR_SOLD_OUT' },
    });
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: false, code: null });
  });

  it('covers the v1 buy_ticket outcomes too', async () => {
    expect(purchaseResult(await judged(TX_FIXTURES.buySucceeded), ESCROW)).toEqual({
      bought: true,
      tokenId: '1-4',
    });
    expect(purchaseResult(await judged(TX_FIXTURES.buyRejected), ESCROW)).toEqual({
      bought: false,
      code: 'ERR_SOLD_OUT',
    });
  });

  it('ignores a ticket_purchased log of a receipt that failed', () => {
    const bought = TxStatusSchema.parse(TX_FIXTURES.tokenBuySucceeded.status);
    const purchasedLogs = bought.receipts_outcome[1]?.outcome.logs ?? [];
    // ft_on_transfer logged the purchase, then panicked: the log is in the outcome, the ticket is not.
    const result = summary(withLogs(TX_FIXTURES.tokenBuyRejected.status, 1, purchasedLogs));
    expect(result.events?.some((e) => e.event === 'ticket_purchased')).toBe(false);
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: false, code: 'ERR_TOO_LATE' });
  });

  it('never counts a look-alike ticket_purchased written by another account', () => {
    // The token writes a forged log in its own receipt, then the escrow rejects the purchase.
    const rejected = summary(
      withLogs(TX_FIXTURES.tokenBuyRejected.status, 0, [purchasedLog('12-9')]),
    );
    expect(rejected.events?.map((e) => [e.executorId, e.event])).toContainEqual([
      'tusd.testnet',
      'ticket_purchased',
    ]);
    expect(purchaseResult(rejected, ESCROW)).toEqual({ bought: false, code: 'ERR_TOO_LATE' });
    // Ahead of a real purchase, the forged id is skipped and the escrow's ticket counts.
    const bought = TxStatusSchema.parse(TX_FIXTURES.tokenBuySucceeded.status);
    const tokenLogs = bought.receipts_outcome[0]?.outcome.logs ?? [];
    const real = summary(
      withLogs(TX_FIXTURES.tokenBuySucceeded.status, 0, [purchasedLog('12-9'), ...tokenLogs]),
    );
    expect(purchaseResult(real, ESCROW)).toEqual({ bought: true, tokenId: '10-3' });
    // Nor is a log from an account that only looks like the escrow.
    expect(purchaseResult(real, 'another-escrow.testnet')).toEqual({ bought: false, code: null });
  });

  it('counts the purchase when the escrow logged it and a later receipt failed', () => {
    // The token's resolver runs out of gas after ft_on_transfer kept the money and minted.
    const status = edited(TX_FIXTURES.tokenBuySucceeded.status, (receipts) =>
      receipts.map((r, i) =>
        i === 2
          ? {
              ...r,
              outcome: {
                ...r.outcome,
                status: {
                  Failure: {
                    ActionError: {
                      index: 0,
                      kind: { FunctionCallError: { ExecutionError: 'Exceeded the prepaid gas.' } },
                    },
                  },
                },
              },
            }
          : r,
      ),
    );
    const result = summary(status);
    expect(result.ok).toBe(false);
    expect(result.failedReceipt?.executorId).toBe('tusd.testnet');
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: true, tokenId: '10-3' });
  });

  it('does not read a mint without ticket_purchased as a purchase', () => {
    const bought = TxStatusSchema.parse(TX_FIXTURES.buySucceeded.status);
    const mintOnly = (bought.receipts_outcome[0]?.outcome.logs ?? []).filter((log) =>
      log.includes('"nft_mint"'),
    );
    expect(mintOnly).toHaveLength(1);
    const result = summary(withLogs(TX_FIXTURES.buySucceeded.status, 0, mintOnly));
    expect(result.ok).toBe(true);
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: false, code: null });
  });

  it('takes the first ticket_purchased of the escrow when there are two', () => {
    const result = summary(
      withLogs(TX_FIXTURES.tokenBuySucceeded.status, 1, [
        purchasedLog('10-3'),
        purchasedLog('10-4'),
      ]),
    );
    expect(result.events?.filter((e) => e.event === 'ticket_purchased')).toHaveLength(2);
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: true, tokenId: '10-3' });
  });

  it('reads a ticket_purchased whose data is an object, and skips malformed logs', () => {
    const base = summary(TX_FIXTURES.tokenBuyRejected.status);
    const event = (data: unknown) => ({
      executorId: ESCROW,
      receiptId: 'r',
      standard: 'ticket_escrow',
      version: '2.0.0',
      event: 'ticket_purchased',
      data,
    });
    expect(purchaseResult({ ...base, events: [event({ token_id: '10-4' })] }, ESCROW)).toEqual({
      bought: true,
      tokenId: '10-4',
    });
    expect(purchaseResult({ ...base, events: [event([{ token_id: 'ten' }])] }, ESCROW)).toEqual({
      bought: false,
      code: 'ERR_TOO_LATE',
    });
    const bought = TxStatusSchema.parse(TX_FIXTURES.buySucceeded.status);
    const noisy = withLogs(TX_FIXTURES.buySucceeded.status, 0, [
      'EVENT_JSON:{not json',
      'EVENT_JSON:{"standard":1}',
      'plain text',
      ...(bought.receipts_outcome[0]?.outcome.logs ?? []),
    ]);
    const result = summary(noisy);
    expect(result.events?.map((e) => e.event)).toEqual(['nft_mint', 'ticket_purchased']);
    expect(purchaseResult(result, ESCROW)).toEqual({ bought: true, tokenId: '1-4' });
  });

  it('never reads a result without events as a purchase, whatever it returned', () => {
    expect(purchaseResult({ ok: true, value: '1-4' }, ESCROW)).toEqual({
      bought: false,
      code: null,
    });
    const failedAt = (executorId: string, code: 'ERR_SOLD_OUT' | 'UNKNOWN') => ({
      ok: false,
      failedReceipt: {
        receiptId: 'r',
        step: 'contract' as const,
        executorId,
        error: { code, message: 'x' },
      },
    });
    expect(purchaseResult(failedAt(ESCROW, 'ERR_SOLD_OUT'), ESCROW)).toEqual({
      bought: false,
      code: 'ERR_SOLD_OUT',
    });
    expect(purchaseResult(failedAt(ESCROW, 'UNKNOWN'), ESCROW)).toEqual({
      bought: false,
      code: null,
    });
    expect(purchaseResult(failedAt('tusd.testnet', 'ERR_SOLD_OUT'), ESCROW)).toEqual({
      bought: false,
      code: null,
    });
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
