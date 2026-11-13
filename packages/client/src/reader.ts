import { FailoverRpcProvider, JsonRpcProvider } from 'near-api-js';
import { z } from 'zod';
import {
  type AccountingView,
  AccountingViewSchema,
  type Config,
  ConfigSchema,
  type EventView,
  EventViewSchema,
  type OperationView,
  OperationViewSchema,
  type TicketHistory,
  TicketHistorySchema,
  type TicketView,
  TicketViewSchema,
  YoctoSchema,
} from './schemas.js';

// Every read goes to the contract at `final` finality (near-api-js defaults to optimistic) and
// every response is parsed with its schema before anyone uses it.

const FINAL = { finality: 'final' } as const;

/**
 * Per endpoint, for the failures near-api-js retries (HTTP 500/503/408, "Failed to fetch"): 3
 * attempts, 250 ms then 500 ms apart. Anything else goes to the next endpoint at once.
 */
const RPC_RETRY = { retries: 3, wait: 250, backoff: 2 };
/** near-api-js gives `fetch` no timeout; without one a hung endpoint never fails over. */
const READ_TIMEOUT_MS = 8_000;
/** Transaction status requests wait on the node by design (`waitUntil`), so they get longer. */
const TX_TIMEOUT_MS = 30_000;
const MAX_KEY_PAGES = 100;

type FinalQuery = typeof FINAL;

export type CallFunctionParams = {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  blockQuery: FinalQuery;
};
export type ViewAccountParams = { accountId: string; blockQuery: FinalQuery };
export type ViewAccessKeyListParams = {
  accountId: string;
  finalityQuery: FinalQuery;
  afterKey?: string;
};

/** The reads the reader needs from an RPC provider. `FailoverRpcProvider` satisfies it. */
export interface ReaderRpc {
  callFunction(params: CallFunctionParams): Promise<unknown>;
  viewAccount(params: ViewAccountParams): Promise<unknown>;
  viewAccessKeyList(params: ViewAccessKeyListParams): Promise<unknown>;
}

/** What the proof page shows about the contract account, read at `final`. */
export interface AccountProof {
  /** Liquid balance in yoctoNEAR. */
  balance: string;
  codeHash: string;
  /** Number of access keys. Zero means nobody can change the account. */
  accessKeys: number;
  /** Height of the block the account was read at. */
  blockHeight: number;
}

export interface Reader {
  readonly contractId: string;
  getConfig(): Promise<Config>;
  quoteEventBudget(capacity: number): Promise<string>;
  getEvent(eventId: number): Promise<EventView | null>;
  listEvents(fromIndex: number, limit: number): Promise<EventView[]>;
  getAccounting(eventId: number): Promise<AccountingView | null>;
  getTicket(tokenId: string): Promise<TicketView | null>;
  listTicketsForOwner(accountId: string, fromIndex: number, limit: number): Promise<TicketView[]>;
  getTicketHistory(tokenId: string): Promise<TicketHistory | null>;
  getOperation(operationId: number): Promise<OperationView | null>;
  getAccountProof(accountId: string): Promise<AccountProof>;
}

export type ReaderOptions =
  | { contractId: string; rpcUrls: readonly string[] }
  | { contractId: string; rpc: ReaderRpc };

/**
 * One provider over every endpoint, tried in order. Pass the same instance to `createReader` and
 * `trackTransaction`; the agent's signer can use it as its `Provider`.
 */
export interface RpcOptions {
  /** Time limit per endpoint for a read. Default 8000 ms. */
  timeoutMs?: number;
  /** Time limit per endpoint for a transaction send or status request. Default 30000 ms. */
  txTimeoutMs?: number;
}

export function createRpc(
  rpcUrls: readonly string[],
  options: RpcOptions = {},
): FailoverRpcProvider {
  if (rpcUrls.length === 0) throw new Error('createRpc needs at least one RPC URL');
  const readMs = options.timeoutMs ?? READ_TIMEOUT_MS;
  const txMs = options.txTimeoutMs ?? TX_TIMEOUT_MS;
  return new FailoverRpcProvider(
    rpcUrls.map((url) => withTimeouts(new JsonRpcProvider({ url }, RPC_RETRY), url, readMs, txMs)),
  );
}

/**
 * Wraps every method of a provider so its promise rejects after a time limit, which makes the
 * failover move on. The abandoned request is ignored; a resent signed transaction cannot run twice.
 */
function withTimeouts(
  provider: JsonRpcProvider,
  url: string,
  readMs: number,
  txMs: number,
): JsonRpcProvider {
  return new Proxy(provider, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      const ms = /^(send|viewTransaction)/.test(property) ? txMs : readMs;
      return (...args: unknown[]) =>
        timeLimit(Promise.resolve(value.apply(target, args)), ms, `${property} on ${url}`);
    },
  });
}

function timeLimit<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

const AccountStateSchema = z.object({
  amount: z.bigint().min(0n),
  code_hash: z.string(),
  block_height: z.int().min(0),
});

const AccessKeyPageSchema = z.object({
  keys: z.array(z.unknown()),
  last_key: z.string().nullish(),
});

function parse<S extends z.ZodType>(source: string, schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `${source} returned data that does not match the expected shape:\n${z.prettifyError(result.error)}`,
      { cause: result.error },
    );
  }
  return result.data;
}

export function createReader(options: ReaderOptions): Reader {
  const { contractId } = options;
  const rpc: ReaderRpc = 'rpc' in options ? options.rpc : createRpc(options.rpcUrls);

  async function view<S extends z.ZodType>(
    method: string,
    args: Record<string, unknown>,
    schema: S,
  ): Promise<z.output<S>> {
    const raw = await rpc.callFunction({ contractId, method, args, blockQuery: FINAL });
    return parse(method, schema, raw);
  }

  return {
    contractId,
    getConfig: () => view('get_config', {}, ConfigSchema),
    quoteEventBudget: (capacity) => view('quote_event_budget', { capacity }, YoctoSchema),
    getEvent: (eventId) => view('get_event', { event_id: eventId }, EventViewSchema.nullable()),
    listEvents: (fromIndex, limit) =>
      view('list_events', { from_index: fromIndex, limit }, z.array(EventViewSchema)),
    getAccounting: (eventId) =>
      view('get_accounting', { event_id: eventId }, AccountingViewSchema.nullable()),
    getTicket: (tokenId) => view('get_ticket', { token_id: tokenId }, TicketViewSchema.nullable()),
    listTicketsForOwner: (accountId, fromIndex, limit) =>
      view(
        'list_tickets_for_owner',
        { account_id: accountId, from_index: fromIndex, limit },
        z.array(TicketViewSchema),
      ),
    getTicketHistory: (tokenId) =>
      view('get_ticket_history', { token_id: tokenId }, TicketHistorySchema.nullable()),
    getOperation: (operationId) =>
      view('get_operation', { operation_id: operationId }, OperationViewSchema.nullable()),

    async getAccountProof(accountId) {
      const account = parse(
        'view_account',
        AccountStateSchema,
        await rpc.viewAccount({ accountId, blockQuery: FINAL }),
      );
      // The key list has no block pin, so it is read at `final` too, possibly one block later.
      let accessKeys = 0;
      let afterKey: string | undefined;
      for (let page = 0; ; page += 1) {
        if (page === MAX_KEY_PAGES)
          throw new Error(`view_access_key_list did not end for ${accountId}`);
        const params: ViewAccessKeyListParams =
          afterKey === undefined
            ? { accountId, finalityQuery: FINAL }
            : { accountId, finalityQuery: FINAL, afterKey };
        const list = parse(
          'view_access_key_list',
          AccessKeyPageSchema,
          await rpc.viewAccessKeyList(params),
        );
        accessKeys += list.keys.length;
        if (!list.last_key) break;
        afterKey = list.last_key;
      }
      return {
        balance: account.amount.toString(),
        codeHash: account.code_hash,
        accessKeys,
        blockHeight: account.block_height,
      };
    },
  };
}
