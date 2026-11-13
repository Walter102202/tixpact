import {
  actions,
  type ContractCall,
  type EventView,
  explorerAccountUrl,
  explorerTxUrl,
  moneyMoved,
  PHASE_LABELS,
  type Reader,
  type TicketView,
  type TrackOptions,
  type TxResult,
  type TxStatusRpc,
  trackTransaction,
} from '@ticket-escrow/client';
import { type AgentConfig, ConfigError } from './config.js';
import { near, when } from './format.js';
import { evaluate, exposureOf, isExposedClaim, type Policy } from './policy.js';
import {
  MAX_PAGE,
  type ToolInput,
  type ToolOutput,
  type WriteResult,
  type WriteStatus,
} from './schemas.js';
import { type AgentSigner, SendError } from './signer.js';

// What the agent can do, shared by the MCP tools and the refund watcher. Every write runs the same
// path, one at a time: the key check, a read of the chain, the policy, the signer, then the verdict
// read back by transaction hash.

export interface AgentDeps {
  config: AgentConfig;
  reader: Reader;
  /** Where transactions are judged; the same RPC as the reader in production. */
  txRpc: TxStatusRpc;
  /** Null when no key is configured or signing was turned off: every write is then denied. */
  signer: AgentSigner | null;
  /** Why the signer is null although a key is configured (for example, the RPC is not testnet). */
  signingOffReason?: string | null;
  /** How long to follow a transaction (tests shorten it). */
  track?: TrackOptions;
}

export interface Agent {
  /** The agent's account (`AGENT_ACCOUNT_ID`), or null when the server only reads. */
  readonly accountId: string | null;
  listEvents(input: ToolInput<'list_events'>): Promise<ToolOutput<'list_events'>>;
  getEvent(input: ToolInput<'get_event'>): Promise<ToolOutput<'get_event'>>;
  getTicket(input: ToolInput<'get_ticket'>): Promise<ToolOutput<'get_ticket'>>;
  listMyTickets(): Promise<ToolOutput<'list_my_tickets'>>;
  getWallet(): Promise<ToolOutput<'get_wallet'>>;
  verifyContract(): Promise<ToolOutput<'verify_contract'>>;
  buyTicket(input: ToolInput<'buy_ticket'>): Promise<WriteResult>;
  transferTicket(input: ToolInput<'transfer_ticket'>): Promise<WriteResult>;
  expireEvent(input: ToolInput<'expire_event'>): Promise<WriteResult>;
  claimRefund(input: ToolInput<'claim_refund'>): Promise<WriteResult>;
}

const NO_KEY =
  'no key configured; set AGENT_PRIVATE_KEY with AGENT_ACCOUNT_ID and both caps to let the agent sign';
const NO_CAPS =
  'no caps configured; set MAX_PRICE_YOCTO and MAX_EXPOSURE_YOCTO to let the agent sign';
const NO_ACCOUNT =
  'AGENT_ACCOUNT_ID is not set: this server does not know which account is the agent.';

/** Pages read before a listing gives up: far above any demo, and it bounds a runaway loop. */
const MAX_PAGES = 100;
/** Accounting reads in flight at once for `verify_contract`. */
const READ_BATCH = 10;

/**
 * A purchase this server signed. It counts against the exposure cap until a read shows its price
 * is no longer the agent's exposure: the transaction failed, or the ticket is held by someone else
 * or no longer has its price in the contract.
 */
interface PendingPurchase {
  /** The transaction hash, or a local id when the send failed before the hash was known. */
  key: string;
  /** Null when the hash is unknown: then it counts until this server restarts. */
  txHash: string | null;
  deposit: bigint;
  /** The minted ticket id once the transaction is judged; null while unconfirmed. */
  tokenId: string | null;
}

/** What the exposure cap counts right now, and where it comes from. */
interface Exposure {
  /** The agent's tickets, as the list read now shows them. */
  tickets: TicketView[];
  /** Principal of the signed purchases the list does not show. */
  inFlight: bigint;
  total: bigint;
}

type Sent =
  | { kind: 'done'; result: WriteResult }
  | { kind: 'unconfirmed'; txHash: string | null; result: WriteResult }
  | { kind: 'tracked'; txHash: string; tx: TxResult };

function writeResult(
  status: WriteStatus,
  fields: Partial<WriteResult> & { message: string },
): WriteResult {
  return {
    status,
    reason: null,
    call: null,
    tx_hash: null,
    explorer_url: null,
    failed_receipt: null,
    value: null,
    ...fields,
  };
}

function callView(call: ContractCall, contractId: string): NonNullable<WriteResult['call']> {
  return {
    contract_id: contractId,
    method_name: call.methodName,
    args: call.args,
    deposit: call.deposit,
    gas: call.gas,
  };
}

const notSent = (reason: string, message: string) => writeResult('not_sent', { reason, message });

async function readAllPages<T>(read: (from: number) => Promise<T[]>, what: string): Promise<T[]> {
  const all: T[] = [];
  // Stop on an empty page only: a short page does not prove the end if the contract's page limit
  // is below ours, and stopping early would undercount the exposure.
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await read(all.length);
    if (batch.length === 0) return all;
    all.push(...batch);
  }
  throw new Error(`${what} did not end after ${MAX_PAGES} pages; stopped reading.`);
}

export function createAgent(deps: AgentDeps): Agent {
  const { config, reader } = deps;
  const contractId = config.contractId;
  // Reads and the cap use AGENT_ACCOUNT_ID and writes are signed by the key's account: one account.
  if (deps.signer !== null && deps.signer.accountId !== config.agentAccountId) {
    throw new ConfigError(
      `The key signs for ${deps.signer.accountId}, but AGENT_ACCOUNT_ID is ${config.agentAccountId ?? 'not set'}: refusing to start.`,
    );
  }
  const pending = new Map<string, PendingPurchase>();
  let unknownSends = 0;

  // Writes run one at a time, so two purchases asked for at once cannot both pass the exposure
  // check against the same balance of tickets.
  let tail: Promise<unknown> = Promise.resolve();
  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  }

  const allTickets = (accountId: string) =>
    readAllPages(
      (from) => reader.listTicketsForOwner(accountId, from, MAX_PAGE),
      `The ticket list of ${accountId}`,
    );

  function requireAgent(): string {
    if (config.agentAccountId === null) throw new Error(NO_ACCOUNT);
    return config.agentAccountId;
  }

  /** One quick look at a transaction: its verdict, or null when it is still unknown. */
  async function peek(txHash: string, signerId: string): Promise<TxResult | null> {
    try {
      return await trackTransaction(deps.txRpc, txHash, signerId, () => {}, {
        ...deps.track,
        attempts: 1,
      });
    } catch {
      return null;
    }
  }

  /**
   * Where a signed purchase stands: `listed` (the list counts it), `in_flight` (the list does not
   * show it, so it is added) or `cleared` (a read shows its price is no longer the agent's
   * exposure). A read that fails or does not know the ticket keeps it counting: the list or the
   * node may simply be behind.
   */
  async function standing(
    purchase: PendingPurchase,
    listed: ReadonlyMap<string, TicketView>,
    accountId: string,
  ): Promise<'listed' | 'in_flight' | 'cleared'> {
    if (purchase.tokenId === null && purchase.txHash !== null) {
      const verdict = await peek(purchase.txHash, accountId);
      if (verdict !== null && !verdict.ok) return 'cleared';
      if (verdict?.ok && typeof verdict.value === 'string') purchase.tokenId = verdict.value;
    }
    if (purchase.tokenId === null) return 'in_flight';
    const inList = listed.get(purchase.tokenId);
    if (inList !== undefined) return isExposedClaim(inList.claim) ? 'listed' : 'cleared';
    const ticket = await reader.getTicket(purchase.tokenId).catch(() => null);
    if (ticket === null) return 'in_flight';
    const stillMine = ticket.owner_id === accountId && isExposedClaim(ticket.claim);
    return stillMine ? 'in_flight' : 'cleared';
  }

  /**
   * The principal the exposure cap counts: the agent's tickets still inside the contract, plus
   * every purchase this server signed that the list does not show (unconfirmed, or confirmed but
   * read from a node that is behind). A purchase leaves the count only when a read shows it is no
   * longer exposure. Call it only inside `serialized`.
   */
  async function exposureNow(accountId: string): Promise<Exposure> {
    const tickets = await allTickets(accountId);
    const listed = new Map(tickets.map((t) => [t.token_id, t]));
    let inFlight = 0n;
    for (const purchase of [...pending.values()]) {
      const where = await standing(purchase, listed, accountId);
      if (where === 'cleared') pending.delete(purchase.key);
      if (where === 'in_flight') inFlight += purchase.deposit;
    }
    return { tickets, inFlight, total: BigInt(exposureOf(tickets)) + inFlight };
  }

  const signingOff = deps.signingOffReason ?? null;

  function writeGate(): { signer: AgentSigner; policy: Policy } | { denied: WriteResult } {
    if (deps.signer === null && signingOff !== null) {
      return {
        denied: writeResult('denied', {
          reason: 'signing_off',
          message: `signing is off: ${signingOff}`,
        }),
      };
    }
    if (deps.signer === null) {
      return { denied: writeResult('denied', { reason: 'no_key', message: NO_KEY }) };
    }
    if (config.caps === null) {
      return { denied: writeResult('denied', { reason: 'no_caps', message: NO_CAPS }) };
    }
    return { signer: deps.signer, policy: { contractId, ...config.caps } };
  }

  /** The policy, then the signer, then the verdict by hash. */
  async function sendChecked(
    call: ContractCall,
    signer: AgentSigner,
    policy: Policy,
  ): Promise<Sent> {
    const view = callView(call, contractId);
    const exposure = await exposureNow(signer.accountId);
    const decision = evaluate(
      policy,
      { exposureYocto: exposure.total.toString() },
      { receiverId: contractId, call },
    );
    if (decision.outcome === 'deny') {
      return {
        kind: 'done',
        result: writeResult('denied', {
          reason: decision.reason,
          message: decision.message,
          call: view,
        }),
      };
    }

    let txHash: string;
    try {
      txHash = await signer.signAndSend(contractId, call);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const hash = error instanceof SendError ? error.txHash : null;
      // Only the signer's own verdict that nothing landed makes this a failure. Anything else may
      // have reached the chain, so it is unconfirmed and a purchase keeps counting.
      if (error instanceof SendError && !error.mayHaveLanded) {
        return {
          kind: 'done',
          result: writeResult('failed', {
            reason: 'not_accepted',
            message: `The node did not accept the transaction: ${detail}`,
            call: view,
            tx_hash: hash,
            explorer_url: hash === null ? null : explorerTxUrl(hash),
          }),
        };
      }
      if (hash === null) {
        return {
          kind: 'unconfirmed',
          txHash: null,
          result: writeResult('unconfirmed', {
            message: `It may have been sent, but its hash is unknown (${detail}), so its result cannot be checked here. Look at the agent account before trying again: ${explorerAccountUrl(signer.accountId)}.`,
            call: view,
          }),
        };
      }
      txHash = hash;
    }

    try {
      const tx = await trackTransaction(deps.txRpc, txHash, signer.accountId, () => {}, deps.track);
      return { kind: 'tracked', txHash, tx };
    } catch {
      return {
        kind: 'unconfirmed',
        txHash,
        result: writeResult('unconfirmed', {
          message:
            'Signed and sent, but no final result arrived in time. It may still complete: check the transaction before trying again.',
          call: view,
          tx_hash: txHash,
          explorer_url: explorerTxUrl(txHash),
        }),
      };
    }
  }

  /** The verdict of a tracked transaction: `success` when it moved what it should, else failed. */
  function judged(
    call: ContractCall,
    txHash: string,
    tx: TxResult,
    success: string | null,
    failure: string,
  ): WriteResult {
    const common = {
      call: callView(call, contractId),
      tx_hash: txHash,
      explorer_url: explorerTxUrl(txHash),
      value: tx.value ?? null,
    };
    if (tx.ok && success !== null) return writeResult('succeeded', { ...common, message: success });
    const failed = tx.failedReceipt;
    return writeResult('failed', {
      ...common,
      reason: failed?.error.code ?? null,
      message:
        failed === undefined
          ? `${failure}: the contract reported that nothing moved.`
          : `${failure}: the step on ${failed.executorId} (receipt ${failed.receiptId}) failed. ${failed.error.message}`,
      failed_receipt:
        failed === undefined
          ? null
          : {
              receipt_id: failed.receiptId,
              executor_id: failed.executorId,
              code: failed.error.code,
              message: failed.error.message,
            },
    });
  }

  async function eventOf(ticket: TicketView): Promise<EventView> {
    const event = await reader.getEvent(ticket.event_id);
    if (event === null)
      throw new Error(`Event ${ticket.event_id} of ticket ${ticket.token_id} does not exist.`);
    return event;
  }

  /** Why the agent cannot claim this ticket now, or null when `claim_refund` will pay. */
  function unclaimable(ticket: TicketView, event: EventView): string | null {
    const id = ticket.token_id;
    switch (ticket.claim) {
      case 'RefundPending':
        return `Ticket ${id} has a refund on its way (Sending); wait for it to settle`;
      case 'Refunded':
        return `Ticket ${id} was already refunded`;
      case 'ReleasedToOrganizer':
        return `Event ${event.event_id} was confirmed, so the price of ticket ${id} went to the organizer`;
      case 'Refundable':
      case 'Reserved':
        break;
    }
    if (ticket.status !== 'Active') return `Ticket ${id} has a transfer in progress`;
    if (ticket.claim === 'Refundable') return null;
    // Reserved: claimable once the deadline passed without an outcome (the claim expires the event).
    if (event.outcome === 'Unresolved' && event.now_ms >= event.resolution_deadline_ms) return null;
    return `Ticket ${id} is Reserved: event ${event.event_id} has not been cancelled, and its deadline (${when(event.resolution_deadline_ms)}) has not passed`;
  }

  return {
    accountId: config.agentAccountId,

    async listEvents({ from_index, limit }) {
      const events = await reader.listEvents(from_index, limit);
      return {
        events,
        next_from_index: events.length === limit ? from_index + events.length : null,
      };
    },

    async getEvent({ event_id }) {
      const [event, accounting] = await Promise.all([
        reader.getEvent(event_id),
        reader.getAccounting(event_id),
      ]);
      if (event === null) throw new Error(`Event ${event_id} does not exist.`);
      return { event, accounting };
    },

    async getTicket({ token_id }) {
      const ticket = await reader.getTicket(token_id);
      if (ticket === null) throw new Error(`Ticket ${token_id} does not exist.`);
      const [event, history] = await Promise.all([
        reader.getEvent(ticket.event_id),
        reader.getTicketHistory(token_id),
      ]);
      return { ticket, event, history };
    },

    async listMyTickets() {
      const accountId = requireAgent();
      // The same count the cap uses, so the agent never sees less exposure than the policy does.
      const { tickets, inFlight, total } = await serialized(() => exposureNow(accountId));
      return {
        account_id: accountId,
        tickets,
        exposure: total.toString(),
        in_flight: inFlight.toString(),
      };
    },

    async getWallet() {
      const accountId = requireAgent();
      const [proof, exposure] = await Promise.all([
        reader.getAccountProof(accountId),
        serialized(() => exposureNow(accountId)),
      ]);
      const caps = config.caps;
      const held = exposure.total;
      const cap = caps === null ? null : BigInt(caps.maxExposureYocto);
      const headroom = cap === null ? null : (cap > held ? cap - held : 0n).toString();
      const offReason =
        deps.signer === null
          ? (signingOff ?? 'no key configured')
          : caps === null
            ? 'no caps configured'
            : null;
      return {
        account_id: accountId,
        network: config.network,
        contract_id: contractId,
        balance: proof.balance,
        can_sign: offReason === null,
        signing_off_reason: offReason,
        max_price: caps?.maxPriceYocto ?? null,
        max_exposure: caps?.maxExposureYocto ?? null,
        exposure: held.toString(),
        headroom,
      };
    },

    async verifyContract() {
      const [proof, events] = await Promise.all([
        reader.getAccountProof(contractId),
        readAllPages((from) => reader.listEvents(from, MAX_PAGE), 'The event list'),
      ]);
      let reserved = 0n;
      let held = 0n;
      for (let start = 0; start < events.length; start += READ_BATCH) {
        const rows = await Promise.all(
          events.slice(start, start + READ_BATCH).map((e) => reader.getAccounting(e.event_id)),
        );
        for (const row of rows) {
          if (row === null) continue;
          reserved += BigInt(row.principal_reserved);
          held += BigInt(row.principal_reserved) + BigInt(row.organizer_available);
        }
      }
      return {
        contract_id: contractId,
        code_hash: proof.codeHash,
        access_keys: proof.accessKeys,
        balance: proof.balance,
        held: held.toString(),
        reserved_principal: reserved.toString(),
        balance_covers_held: BigInt(proof.balance) >= held,
        events_counted: events.length,
        block_height: proof.blockHeight,
      };
    },

    buyTicket({ event_id }) {
      return serialized(async () => {
        const gate = writeGate();
        if ('denied' in gate) return gate.denied;
        const event = await reader.getEvent(event_id);
        if (event === null) return notSent('not_found', `Event ${event_id} does not exist`);
        if (event.phase !== 'OnSale') {
          return notSent(
            'not_on_sale',
            `Event ${event_id} is not on sale (${PHASE_LABELS[event.phase]})`,
          );
        }
        const call = actions.buyTicket(event_id, event.price);
        const sent = await sendChecked(call, gate.signer, gate.policy);
        const deposit = BigInt(call.deposit);
        if (sent.kind === 'unconfirmed') {
          unknownSends += 1;
          const key = sent.txHash ?? `unknown-send-${unknownSends}`;
          pending.set(key, { key, txHash: sent.txHash, deposit, tokenId: null });
          const counted =
            sent.txHash === null
              ? 'Its price counts against the exposure cap until this server restarts.'
              : 'Its price counts against the exposure cap until the transaction shows it failed.';
          return { ...sent.result, message: `${sent.result.message} ${counted}` };
        }
        if (sent.kind !== 'tracked') return sent.result;
        const tokenId = typeof sent.tx.value === 'string' ? sent.tx.value : null;
        if (sent.tx.ok) {
          pending.set(sent.txHash, { key: sent.txHash, txHash: sent.txHash, deposit, tokenId });
        }
        return judged(
          call,
          sent.txHash,
          sent.tx,
          `Bought ticket ${tokenId ?? '(id not returned)'} for ${near(event.price)}. Its price stays reserved in the contract until the event is confirmed or switched to refunds.`,
          'The purchase did not complete',
        );
      });
    },

    transferTicket({ token_id, receiver_id, memo }) {
      return serialized(async () => {
        const gate = writeGate();
        if ('denied' in gate) return gate.denied;
        const agent = gate.signer.accountId;
        const ticket = await reader.getTicket(token_id);
        if (ticket === null) return notSent('not_found', `Ticket ${token_id} does not exist`);
        if (ticket.owner_id !== agent) {
          return notSent(
            'not_holder',
            `Ticket ${token_id} is held by ${ticket.owner_id}, not by ${agent}`,
          );
        }
        if (receiver_id === agent) {
          return notSent('same_account', `Ticket ${token_id} is already held by ${agent}`);
        }
        const blocked = (why: string) =>
          notSent('not_transferable', `Ticket ${token_id} cannot be transferred now: ${why}`);
        if (ticket.status === 'RefundPending') return blocked('it has a refund in progress');
        if (ticket.status === 'TransferPending') return blocked('it has a transfer in progress');
        if (ticket.status === 'Refunded') return blocked('it was refunded');
        const event = await eventOf(ticket);
        if (event.outcome !== 'Unresolved') {
          return blocked(`event ${event.event_id} already has its outcome (${event.outcome})`);
        }
        if (event.now_ms >= event.starts_at_ms) {
          return blocked(`event ${event.event_id} started at ${when(event.starts_at_ms)}`);
        }
        const call = actions.transferTicket(token_id, receiver_id, memo ?? null);
        const sent = await sendChecked(call, gate.signer, gate.policy);
        if (sent.kind !== 'tracked') return sent.result;
        return judged(
          call,
          sent.txHash,
          sent.tx,
          `Gave ticket ${token_id} to ${receiver_id}, and with it the right to its ${near(ticket.principal)} refund.`,
          'The transfer did not complete',
        );
      });
    },

    expireEvent({ event_id }) {
      return serialized(async () => {
        const gate = writeGate();
        if ('denied' in gate) return gate.denied;
        const event = await reader.getEvent(event_id);
        if (event === null) return notSent('not_found', `Event ${event_id} does not exist`);
        if (event.outcome !== 'Unresolved') {
          return notSent(
            'already_resolved',
            `Event ${event_id} already has its outcome: ${event.outcome}`,
          );
        }
        if (event.now_ms < event.resolution_deadline_ms) {
          return notSent(
            'too_early',
            `Event ${event_id} cannot be switched to refunds before its deadline, ${when(event.resolution_deadline_ms)}`,
          );
        }
        const call = actions.expireEvent(event_id);
        const sent = await sendChecked(call, gate.signer, gate.policy);
        if (sent.kind !== 'tracked') return sent.result;
        return judged(
          call,
          sent.txHash,
          sent.tx,
          `Event ${event_id} now has refunds open: its deadline passed without confirmation, so every holder can claim the price of their ticket.`,
          'The switch to refunds did not complete',
        );
      });
    },

    claimRefund({ token_id }) {
      return serialized(async () => {
        const gate = writeGate();
        if ('denied' in gate) return gate.denied;
        const agent = gate.signer.accountId;
        const ticket = await reader.getTicket(token_id);
        if (ticket === null) return notSent('not_found', `Ticket ${token_id} does not exist`);
        if (ticket.owner_id !== agent) {
          return notSent(
            'not_holder',
            `Ticket ${token_id} is held by ${ticket.owner_id}, not by ${agent}`,
          );
        }
        const why = unclaimable(ticket, await eventOf(ticket));
        if (why !== null) return notSent('not_claimable', why);
        const call = actions.claimRefund(token_id);
        const sent = await sendChecked(call, gate.signer, gate.policy);
        if (sent.kind !== 'tracked') return sent.result;
        return judged(
          call,
          sent.txHash,
          sent.tx,
          moneyMoved(sent.tx) ? `Refunded ${near(ticket.principal)} to ${agent}.` : null,
          'The refund did not complete',
        );
      });
    },
  };
}
