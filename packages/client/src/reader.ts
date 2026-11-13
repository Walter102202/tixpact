import { FailoverRpcError, FailoverRpcProvider, JsonRpcProvider } from 'near-api-js';
import { AccountDoesNotExistError } from 'near-api-js/rpc-errors';
import { z } from 'zod';
import { NftTokenSchema, type TicketDisplay, ticketDisplayOf } from './display.js';
import {
  AccountIdSchema,
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
/** The code hash of an account without a contract: 32 zero bytes, in base58. */
const NO_CODE_HASH = '1'.repeat(32);

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
  /**
   * Whether `accountId` exists, read at `final`. Rejects when no endpoint answered, so an outage
   * never reads as "missing". Optional, so readers written before it stay valid.
   */
  accountExists?(accountId: string): Promise<boolean>;
  /** `ft_balance_of` on a NEP-141 token: the account's balance in the token's smallest unit. */
  tokenBalance(token: string, accountId: string): Promise<string>;
  /**
   * Whether `accountId` is registered with a NEP-141 token (`storage_balance_of` is not null), and
   * the token's minimum registration deposit in yoctoNEAR (`storage_balance_bounds().min`).
   */
  tokenRegistration(token: string, accountId: string): Promise<TokenRegistration>;
  /**
   * The group behind a verifier account that is a Sputnik DAO (`get_policy`), or null for a plain
   * account, any other policy, or a failed view. Optional, so readers written before it stay valid.
   */
  readGroupVerifier?(accountId: string): Promise<GroupVerifier | null>;
  /**
   * The ticket as wallets show it (NEP-171 `nft_token`): the title, description and drawn ticket
   * the contract derives at every read. Null for a ticket that does not exist; a media that is not
   * an SVG data URL reads as null. Optional, so readers written before it stay valid.
   */
  ticketDisplay?(tokenId: string): Promise<TicketDisplay | null>;
}

/** An account's standing with a NEP-141 token, for `actions.registerWithToken`. */
export interface TokenRegistration {
  registered: boolean;
  /** yoctoNEAR. */
  minDeposit: string;
}

/** A verifier that is a group: `needed` of `members` must approve before the DAO acts. */
export interface GroupVerifier {
  members: string[];
  needed: number;
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

/** NEP-145 `storage_balance_of`: null when the account is not registered. */
const StorageBalanceSchema = z.object({ total: YoctoSchema, available: YoctoSchema }).nullable();
/** NEP-145 `storage_balance_bounds`. */
const StorageBoundsSchema = z.object({ min: YoctoSchema, max: YoctoSchema.nullable() });

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

/** Whether a failed read says the account does not exist, from any endpoint of a failover. */
function saysAccountMissing(error: unknown): boolean {
  const errors = error instanceof FailoverRpcError ? error.errors : [error];
  return errors.some((e) => e instanceof AccountDoesNotExistError);
}

export function createReader(options: ReaderOptions): Reader {
  const { contractId } = options;
  const rpc: ReaderRpc = 'rpc' in options ? options.rpc : createRpc(options.rpcUrls);

  async function viewOn<S extends z.ZodType>(
    contract: string,
    method: string,
    args: Record<string, unknown>,
    schema: S,
  ): Promise<z.output<S>> {
    const raw = await rpc.callFunction({ contractId: contract, method, args, blockQuery: FINAL });
    return parse(contract === contractId ? method : `${method} on ${contract}`, schema, raw);
  }
  const view = <S extends z.ZodType>(method: string, args: Record<string, unknown>, schema: S) =>
    viewOn(contractId, method, args, schema);

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
    ticketDisplay: async (tokenId) =>
      ticketDisplayOf(await view('nft_token', { token_id: tokenId }, NftTokenSchema)),

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

    tokenBalance: (token, accountId) =>
      viewOn(token, 'ft_balance_of', { account_id: accountId }, YoctoSchema),

    async tokenRegistration(token, accountId) {
      const [balance, bounds] = await Promise.all([
        viewOn(token, 'storage_balance_of', { account_id: accountId }, StorageBalanceSchema),
        viewOn(token, 'storage_balance_bounds', {}, StorageBoundsSchema),
      ]);
      return { registered: balance !== null, minDeposit: bounds.min };
    },

    async accountExists(accountId) {
      try {
        await rpc.viewAccount({ accountId, blockQuery: FINAL });
        return true;
      } catch (error) {
        if (saysAccountMissing(error)) return false;
        throw error;
      }
    },

    async readGroupVerifier(accountId) {
      let policy: unknown;
      try {
        // Most verifiers are plain accounts. Asking one for a policy fails, and near-api-js logs
        // each failed endpoint to the console; an account without code is answered here instead.
        const account = AccountStateSchema.safeParse(
          await rpc.viewAccount({ accountId, blockQuery: FINAL }),
        );
        if (!account.success || account.data.code_hash === NO_CODE_HASH) return null;
        policy = await rpc.callFunction({
          contractId: accountId,
          method: 'get_policy',
          args: {},
          blockQuery: FINAL,
        });
      } catch {
        // Not a DAO, or no endpoint answered: the page shows the account as it is.
        return null;
      }
      return groupVerifierOf(policy);
    },
  };
}

// Sputnik DAO v2 policies (`get_policy`), as near-daos/sputnik-dao-contract
// sputnikdao2/src/policy.rs serializes them. Read on 2026-11-13; shape checked on testnet.

const DECIMAL = /^(0|[1-9][0-9]*)$/;

const VotePolicySchema = z.object({
  weight_kind: z.string(),
  quorum: z.string().regex(DECIMAL),
  // `WeightOrRatio` is untagged: a weight is a U128 string, a ratio is `[num, denom]`, denom > 0.
  threshold: z.union([z.string().regex(DECIMAL), z.tuple([z.int().min(0), z.int().min(1)])]),
});

const PolicySchema = z.object({
  roles: z.array(
    z.object({
      kind: z.unknown(),
      permissions: z.array(z.string()),
      vote_policy: z.record(z.string(), z.unknown()),
    }),
  ),
  default_vote_policy: z.unknown(),
});

/**
 * Proposal labels that decide function calls or can change who decides them (`proposals.rs`,
 * `to_policy_label`): a member who can pass any of these alone can rewrite the rules, then call.
 * Every other label that starts with `policy` found in the policy is added.
 */
const RULE_LABELS = [
  'call',
  'config',
  'add_member_to_role',
  'remove_member_from_role',
  'upgrade_self',
  'upgrade_remote',
  // Sputnik v3: replaces the factory and auto_update; the factory may then replace the DAO's code.
  'factory_info_update',
  'policy',
  'policy_add_or_update_role',
  'policy_remove_role',
  'policy_update_default_vote_policy',
  'policy_update_parameters',
];

/** Whether these permissions let a role vote to approve a proposal with this label. */
const canApprove = (permissions: string[], label: string) =>
  permissions.some(
    (p) =>
      p === '*:*' || p === `${label}:*` || p === '*:VoteApprove' || p === `${label}:VoteApprove`,
  );

const GroupKindSchema = z.object({ Group: z.array(AccountIdSchema).min(1) });

/** Votes a proposal needs under this policy, as the contract computes it, for a group of `n`. */
function votesNeeded(vote: z.infer<typeof VotePolicySchema>, n: bigint): bigint {
  const { threshold, quorum } = vote;
  // BigInt throughout: a weight is a U128 and a ratio's terms are u64.
  let needed =
    typeof threshold === 'string'
      ? BigInt(threshold)
      : (n * BigInt(threshold[0])) / BigInt(threshold[1]) + 1n;
  if (needed > n) needed = n;
  if (BigInt(quorum) > needed) needed = BigInt(quorum);
  return needed;
}

/**
 * The group that decides a DAO's function calls and its rules, or null. Labels considered:
 * `RULE_LABELS` and every `policy…` label in the policy. Every role that may approve any of them
 * (`*:*`, `<label>:*`, `*:VoteApprove`, `<label>:VoteApprove`) is an approver, `Everyone` included
 * (the contract's tally skips it, but the line never says a group decides while another role holds
 * the permission). It answers only when there is exactly one approver, it is a `Group`, it may
 * approve `call`, and its vote policy for each label it may approve (its own entry for the label,
 * else the default) weighs by role. `needed` is the fewest votes that pass any of those labels:
 * `max(quorum, min(n, floor(n * num / den) + 1))` for a ratio, `max(quorum, min(n, weight))` for a
 * weight. A label whose threshold exceeds the group can never pass and is left out; if that label
 * is `call`, or a threshold is 0, the answer is null.
 */
export function groupVerifierOf(policy: unknown): GroupVerifier | null {
  const parsed = PolicySchema.safeParse(policy);
  if (!parsed.success) return null;
  const { roles, default_vote_policy } = parsed.data;
  const labels = new Set(RULE_LABELS);
  for (const role of roles) {
    for (const label of [
      ...role.permissions.map((p) => p.split(':')[0] ?? ''),
      ...Object.keys(role.vote_policy),
    ]) {
      if (label.startsWith('policy')) labels.add(label);
    }
  }

  const approvers = roles.filter((role) =>
    [...labels].some((label) => canApprove(role.permissions, label)),
  );
  const [role] = approvers;
  if (approvers.length !== 1 || role === undefined) return null;
  const group = GroupKindSchema.safeParse(role.kind);
  if (!group.success || !canApprove(role.permissions, 'call')) return null;

  const members = [...new Set(group.data.Group)];
  const n = BigInt(members.length);
  let fewest: bigint | null = null;
  for (const label of labels) {
    if (!canApprove(role.permissions, label)) continue;
    const vote = VotePolicySchema.safeParse(role.vote_policy[label] ?? default_vote_policy);
    if (!vote.success || vote.data.weight_kind !== 'RoleWeight') return null;
    const needed = votesNeeded(vote.data, n);
    if (needed < 1n) return null;
    if (needed > n) {
      if (label === 'call') return null;
      continue;
    }
    if (fewest === null || needed < fewest) fewest = needed;
  }
  return fewest === null ? null : { members, needed: Number(fewest) };
}
