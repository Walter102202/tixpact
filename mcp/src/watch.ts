import { setTimeout as delay } from 'node:timers/promises';
import type { Agent } from './agent.js';
import { describeError } from './format.js';
import { MAX_PAGE, type WriteResult } from './schemas.js';

// The refund watcher: a plain loop, not a service. Every 30 seconds it reads the agent's tickets a
// page at a time; for an event whose deadline passed without an outcome it calls expire_event, then
// it claims every ticket that can be claimed. Each call goes through an agent with the same policy
// as the MCP tools, but the watcher runs in its own process, so its writes queue among themselves,
// not with the server's. It never buys, so it can never raise the exposure the cap counts. A call
// that keeps failing is retried less and less often, then given up. It stops when told to, before
// the next call.

export const WATCH_INTERVAL_MS = 30_000;
/** Failed attempts at one call (a paid transaction that did not do its job) before giving up. */
export const MAX_FAILURES = 5;
/** Pages of tickets read in one round: far above any demo, and it bounds the round. */
const MAX_PAGES = 100;

interface Failures {
  count: number;
  /** The first round in which the call may be tried again. */
  retryAtRound: number;
}

/** What the watcher remembers between rounds. */
export interface WatchState {
  round: number;
  /** Per call ("claim_refund 8-1", "expire_event 6"): its failures since its last success. */
  failures: Map<string, Failures>;
}

export function createWatchState(): WatchState {
  return { round: 0, failures: new Map() };
}

export interface WatchOnceOptions {
  agent: Agent;
  log: (line: string) => void;
  /** Checked before each call: once it aborts, nothing more is sent in the round. */
  signal?: AbortSignal;
  /** Failures and back-off carried between rounds; a fresh state when omitted. */
  state?: WatchState;
}

export interface WatchOptions {
  agent: Agent;
  log: (line: string) => void;
  intervalMs: number;
  signal: AbortSignal;
  /** Waits between rounds; returns early when `signal` aborts. Tests replace it. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface WatchRound {
  /** Events switched to refunds in this round. */
  expired: number[];
  /** Tickets whose refund moved money in this round. */
  claimed: string[];
  /** Calls that did not succeed (each one is logged). */
  problems: number;
}

const STOP_LINE = 'Stop requested: nothing more is sent in this round.';

function line(label: string, result: WriteResult): string {
  const tx = result.tx_hash === null ? '' : `, tx ${result.tx_hash} ${result.explorer_url ?? ''}`;
  const why = result.status === 'succeeded' ? '' : `: ${result.message}`;
  return `${label}: ${result.status}${tx}${why}`;
}

/** A paid transaction that did not do its job. Denials and refusals before signing cost nothing. */
const costly = (result: WriteResult) =>
  result.status === 'failed' || result.status === 'unconfirmed';

/** One round: expire what is past its deadline, then claim everything claimable. */
export async function watchOnce(options: WatchOnceOptions): Promise<WatchRound> {
  const { agent, log, signal } = options;
  const state = options.state ?? createWatchState();
  state.round += 1;
  const round: WatchRound = { expired: [], claimed: [], problems: 0 };
  const waiting: string[] = [];
  let stopped = false;
  let due = 0;

  /** Sends one call, unless a stop was requested or the call is waiting after failures. */
  async function attempt(label: string, run: () => Promise<WriteResult>) {
    due += 1;
    if (signal?.aborted) {
      if (!stopped) log(STOP_LINE);
      stopped = true;
      return null;
    }
    const failure = state.failures.get(label);
    if (failure !== undefined && state.round < failure.retryAtRound) {
      if (failure.count < MAX_FAILURES) waiting.push(label);
      return null;
    }
    const result = await run();
    log(line(label, result));
    if (result.status === 'succeeded') {
      state.failures.delete(label);
    } else if (costly(result)) {
      const count = (failure?.count ?? 0) + 1;
      if (count >= MAX_FAILURES) {
        state.failures.set(label, { count, retryAtRound: Number.POSITIVE_INFINITY });
        log(
          `Gave up on ${label} after ${count} failed attempts (last: ${result.message.replace(/\.$/, '')}). Restart the watcher to try it again.`,
        );
      } else {
        // 2, 4, 8, 16 rounds: the wait doubles after each failure.
        state.failures.set(label, { count, retryAtRound: state.round + 2 ** count });
      }
    }
    if (result.status !== 'succeeded') round.problems += 1;
    return result;
  }

  // A page at a time, so the tickets read before a failing page are still handled.
  const pastDeadline = new Map<number, boolean>();
  const expireTried = new Set<number>();
  let held = 0;
  let pages = 0;
  for (; pages < MAX_PAGES && !stopped; pages += 1) {
    const tickets = await agent.myTicketsPage(held, MAX_PAGE);
    if (tickets.length === 0) break;
    held += tickets.length;
    const active = tickets.filter((t) => t.status === 'Active');

    for (const ticket of active) {
      if (ticket.claim !== 'Reserved' || pastDeadline.has(ticket.event_id)) continue;
      const { event } = await agent.getEvent({ event_id: ticket.event_id });
      pastDeadline.set(
        ticket.event_id,
        event.outcome === 'Unresolved' && event.now_ms >= event.resolution_deadline_ms,
      );
    }

    for (const [eventId, past] of pastDeadline) {
      if (!past || expireTried.has(eventId) || stopped) continue;
      expireTried.add(eventId);
      const result = await attempt(`expire_event ${eventId}`, () =>
        agent.expireEvent({ event_id: eventId }),
      );
      if (result?.status === 'succeeded') round.expired.push(eventId);
    }

    // claim_refund on a past-deadline event works even if the expiry above did not go through:
    // the contract expires the event first.
    const claimable = active.filter(
      (t) =>
        t.claim === 'Refundable' ||
        (t.claim === 'Reserved' && pastDeadline.get(t.event_id) === true),
    );
    for (const ticket of claimable) {
      if (stopped) break;
      const result = await attempt(`claim_refund ${ticket.token_id}`, () =>
        agent.claimRefund({ token_id: ticket.token_id }),
      );
      if (result?.status === 'succeeded') round.claimed.push(ticket.token_id);
    }
  }

  if (pages === MAX_PAGES) {
    log(`Read ${MAX_PAGES} pages of tickets this round; tickets beyond them were not checked.`);
  }
  if (waiting.length > 0) {
    log(`Retrying later, after earlier failures: ${waiting.join(', ')}.`);
  }
  if (due === 0) {
    log(`Nothing to claim: ${held} ticket${held === 1 ? '' : 's'} held, none claimable now.`);
  }
  return round;
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  delay(ms, undefined, { signal }).catch(() => undefined);

/** Runs `watchOnce` every `intervalMs` until `signal` aborts. A failed round is logged, not fatal. */
export async function watch(options: WatchOptions): Promise<void> {
  const { agent, log, intervalMs, signal } = options;
  const sleep = options.sleep ?? abortableSleep;
  const state = createWatchState();
  log(
    `Watching ${agent.accountId ?? 'no account'}: a plain loop that checks every ${intervalMs / 1000} s. Stop it with Ctrl+C.`,
  );
  while (!signal.aborted) {
    try {
      await watchOnce({ agent, log, signal, state });
    } catch (error) {
      log(`Round failed: ${describeError(error)}`);
    }
    if (signal.aborted) break;
    await sleep(intervalMs, signal);
  }
  log('Stopped.');
}
