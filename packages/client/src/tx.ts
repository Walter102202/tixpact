import { base64Decode, bytesToString } from 'near-api-js';
import { z } from 'zod';
import { type ContractError, parseContractError } from './errors.js';

// After the wallet returns, the transaction is judged by the chain, not by the wallet: its status
// is re-read by hash with every receipt, and any failed receipt makes the result a failure, even
// when the transaction's own status is a success (a refund whose transfer failed).

const EXPLORER = 'https://testnet.nearblocks.io';

export type TxWaitLevel = 'EXECUTED_OPTIMISTIC' | 'FINAL';

/** `sending`: submitted; `executed`: every non-refund receipt ran; `final`: those blocks are final. */
export type TxStage = 'sending' | 'executed' | 'final';

/** The read `trackTransaction` needs. `FailoverRpcProvider` satisfies it. */
export interface TxStatusRpc {
  viewTransactionStatusWithReceipts(params: {
    txHash: string;
    accountId: string;
    waitUntil: TxWaitLevel;
  }): Promise<unknown>;
}

export interface FailedReceipt {
  receiptId: string;
  /** Account the failed receipt ran on: the contract for a call or callback, the payee for a transfer. */
  executorId: string;
  error: ContractError;
}

export interface TxResult {
  ok: boolean;
  /** The first failed receipt, in the order the node lists them. */
  failedReceipt?: FailedReceipt;
  /** The decoded return value of the transaction, when it has one. */
  value?: unknown;
}

export interface TrackOptions {
  /** Requests per stage before giving up. Default 20. */
  attempts?: number;
  /** Pause between requests after an error or an early answer. Default 1000 ms. */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const ExecutionStatusSchema = z.union([
  z.object({ SuccessValue: z.string() }),
  z.object({ SuccessReceiptId: z.string() }),
  z.object({ Failure: z.looseObject({}) }),
  z.string(),
]);

const OutcomeWithIdSchema = z.object({
  id: z.string(),
  outcome: z.object({
    executor_id: z.string(),
    logs: z.array(z.string()),
    receipt_ids: z.array(z.string()),
    status: ExecutionStatusSchema,
  }),
});

const ExecutionLevelSchema = z.enum([
  'NONE',
  'INCLUDED',
  'EXECUTED_OPTIMISTIC',
  'INCLUDED_FINAL',
  'EXECUTED',
  'FINAL',
]);

/** The parts of an `EXPERIMENTAL_tx_status` response this package reads. */
export const TxStatusSchema = z.object({
  final_execution_status: ExecutionLevelSchema,
  status: ExecutionStatusSchema,
  transaction_outcome: OutcomeWithIdSchema,
  receipts_outcome: z.array(OutcomeWithIdSchema),
});

export type TxStatus = z.infer<typeof TxStatusSchema>;
type ExecutionLevel = z.infer<typeof ExecutionLevelSchema>;

const REACHED: Record<TxWaitLevel, ReadonlySet<ExecutionLevel>> = {
  EXECUTED_OPTIMISTIC: new Set(['EXECUTED_OPTIMISTIC', 'EXECUTED', 'FINAL']),
  FINAL: new Set(['FINAL']),
};

const LevelOnlySchema = z.object({ final_execution_status: ExecutionLevelSchema });

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Follows a submitted transaction until its receipts are final and reports how it really ended.
 * Calls `onStage` once per stage, in order, and resolves only at `final`. A view read afterwards
 * may still come from a node that is behind (the RPC is load-balanced and the failover can switch
 * endpoints): re-read with `readUntilChanged` before showing the new state. Rejects if a stage is
 * not reached in time, including when the node keeps reporting an outcome that has not run.
 */
export async function trackTransaction(
  rpc: TxStatusRpc,
  txHash: string,
  signerId: string,
  onStage: (stage: TxStage) => void,
  options: TrackOptions = {},
): Promise<TxResult> {
  const settings = {
    attempts: options.attempts ?? 20,
    intervalMs: options.intervalMs ?? 1000,
    sleep: options.sleep ?? defaultSleep,
  };
  onStage('sending');
  const executed = await waitFor(rpc, txHash, signerId, 'EXECUTED_OPTIMISTIC', settings);
  onStage('executed');
  const final = isComplete(executed, 'FINAL')
    ? executed
    : await waitFor(rpc, txHash, signerId, 'FINAL', settings);
  onStage('final');
  return summarizeTransaction(final);
}

async function waitFor(
  rpc: TxStatusRpc,
  txHash: string,
  signerId: string,
  level: TxWaitLevel,
  settings: Required<TrackOptions>,
): Promise<TxStatus> {
  let lastProblem: unknown;
  for (let attempt = 1; attempt <= settings.attempts; attempt += 1) {
    try {
      const raw = await rpc.viewTransactionStatusWithReceipts({
        txHash,
        accountId: signerId,
        waitUntil: level,
      });
      const reached = LevelOnlySchema.safeParse(raw);
      if (reached.success && REACHED[level].has(reached.data.final_execution_status)) {
        const parsed = TxStatusSchema.safeParse(raw);
        if (parsed.success && isComplete(parsed.data, level)) return parsed.data;
        lastProblem = parsed.success ? new Error('some outcomes have not run yet') : parsed.error;
      } else {
        lastProblem = reached.success
          ? new Error(`status is ${reached.data.final_execution_status}`)
          : reached.error;
      }
    } catch (error) {
      lastProblem = error;
    }
    if (attempt < settings.attempts) await settings.sleep(settings.intervalMs);
  }
  throw new Error(
    `Could not confirm transaction ${txHash}: no ${level} status after ${settings.attempts} attempts.`,
    { cause: lastProblem },
  );
}

type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

function failureOf(status: ExecutionStatus): Record<string, unknown> | undefined {
  return typeof status === 'object' && 'Failure' in status ? status.Failure : undefined;
}

/** A plain-string status (`Unknown`, `Pending`, `NotStarted`, `Started`) means "has not run yet". */
const hasRun = (status: ExecutionStatus) => typeof status === 'object';

/**
 * Whether a response is complete enough for its stage. `executed`: the transaction has a result.
 * `final`: also every outcome the node lists has run.
 */
function isComplete(status: TxStatus, level: TxWaitLevel): boolean {
  if (!REACHED[level].has(status.final_execution_status) || !hasRun(status.status)) return false;
  if (level === 'EXECUTED_OPTIMISTIC') return true;
  return [status.transaction_outcome, ...status.receipts_outcome].every((o) =>
    hasRun(o.outcome.status),
  );
}

const succeeded = (status: ExecutionStatus) =>
  typeof status === 'object' && ('SuccessValue' in status || 'SuccessReceiptId' in status);

/**
 * How a transaction ended, from one status response. `ok` is true only when the transaction and
 * every receipt outcome succeeded and the transaction has a return value; an outcome that has not
 * run makes it false. `failedReceipt` is the first failed outcome, in the node's order.
 */
export function summarizeTransaction(status: TxStatus): TxResult {
  const outcomes = [status.transaction_outcome, ...status.receipts_outcome];
  let failedReceipt: FailedReceipt | undefined;
  for (const { id, outcome } of outcomes) {
    const failure = failureOf(outcome.status);
    if (failure !== undefined) {
      failedReceipt = {
        receiptId: id,
        executorId: outcome.executor_id,
        error: parseContractError(failure),
      };
      break;
    }
  }
  const final = status.status;
  const hasValue = typeof final === 'object' && 'SuccessValue' in final;
  const value = hasValue ? decodeValue(final.SuccessValue) : undefined;
  const ok = hasValue && outcomes.every((o) => succeeded(o.outcome.status));
  return {
    ok,
    ...(failedReceipt === undefined ? {} : { failedReceipt }),
    ...(value === undefined ? {} : { value }),
  };
}

/**
 * Whether a `claim_refund` or `claim_payout` moved money: the transaction succeeded and the
 * contract's callback returned `true`. Show "Refunded" or "Collected" only when this is true.
 */
export function moneyMoved(result: TxResult): boolean {
  return result.ok && result.value === true;
}

export interface ReadUntilChangedOptions {
  /** Reads in total, the first one included. Default 5. */
  attempts?: number;
  /** Pause between reads. Default 1000 ms. */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Default: equal JSON. */
  isEqual?: (a: unknown, b: unknown) => boolean;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Re-reads a view after a transaction until it differs from the snapshot taken before sending.
 * `changed: false` means every read still matched the snapshot: keep showing "Sending".
 */
export async function readUntilChanged<T>(
  read: () => Promise<T>,
  before: T,
  options: ReadUntilChangedOptions = {},
): Promise<{ changed: boolean; value: T }> {
  const attempts = options.attempts ?? 5;
  const intervalMs = options.intervalMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  const isEqual = options.isEqual ?? sameJson;
  let value = await read();
  for (let attempt = 1; attempt < attempts && isEqual(value, before); attempt += 1) {
    await sleep(intervalMs);
    value = await read();
  }
  return { changed: !isEqual(value, before), value };
}

function decodeValue(base64: string): unknown {
  if (base64 === '') return undefined;
  const text = bytesToString(base64Decode(base64));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER}/txns/${encodeURIComponent(hash)}`;
}

export function explorerAccountUrl(accountId: string): string {
  return `${EXPLORER}/address/${encodeURIComponent(accountId)}`;
}
