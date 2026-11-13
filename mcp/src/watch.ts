import { setTimeout as delay } from 'node:timers/promises';
import type { Agent } from './agent.js';
import { describeError } from './format.js';
import type { WriteResult } from './schemas.js';

// The refund watcher: a plain loop, not a service. Every 30 seconds it reads the agent's tickets;
// for an event whose deadline passed without an outcome it calls expire_event, then it claims every
// ticket that can be claimed. Each call goes through the same agent as the MCP tools, so the same
// policy and the same one-at-a-time queue apply. It stops when the process is told to.

export const WATCH_INTERVAL_MS = 30_000;

export interface WatchOnceOptions {
  agent: Agent;
  log: (line: string) => void;
}

export interface WatchOptions extends WatchOnceOptions {
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

function line(label: string, result: WriteResult): string {
  const tx = result.tx_hash === null ? '' : `, tx ${result.tx_hash} ${result.explorer_url ?? ''}`;
  const why = result.status === 'succeeded' ? '' : `: ${result.message}`;
  return `${label}: ${result.status}${tx}${why}`;
}

/** One round: expire what is past its deadline, then claim everything claimable. */
export async function watchOnce({ agent, log }: WatchOnceOptions): Promise<WatchRound> {
  const { tickets } = await agent.listMyTickets();
  const active = tickets.filter((t) => t.status === 'Active');
  const reservedEvents = new Set(
    active.filter((t) => t.claim === 'Reserved').map((t) => t.event_id),
  );

  const pastDeadline = new Set<number>();
  for (const eventId of reservedEvents) {
    const { event } = await agent.getEvent({ event_id: eventId });
    if (event.outcome === 'Unresolved' && event.now_ms >= event.resolution_deadline_ms) {
      pastDeadline.add(eventId);
    }
  }

  const round: WatchRound = { expired: [], claimed: [], problems: 0 };
  for (const eventId of pastDeadline) {
    const result = await agent.expireEvent({ event_id: eventId });
    log(line(`expire_event ${eventId}`, result));
    if (result.status === 'succeeded') round.expired.push(eventId);
    else round.problems += 1;
  }

  // claim_refund on a past-deadline event works even if the expiry above did not go through:
  // the contract expires the event first.
  const due = active.filter(
    (t) => t.claim === 'Refundable' || (t.claim === 'Reserved' && pastDeadline.has(t.event_id)),
  );
  for (const ticket of due) {
    const result = await agent.claimRefund({ token_id: ticket.token_id });
    log(line(`claim_refund ${ticket.token_id}`, result));
    if (result.status === 'succeeded') round.claimed.push(ticket.token_id);
    else round.problems += 1;
  }

  if (pastDeadline.size === 0 && due.length === 0) {
    const n = tickets.length;
    log(`Nothing to claim: ${n} ticket${n === 1 ? '' : 's'} held, none claimable now.`);
  }
  return round;
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  delay(ms, undefined, { signal }).catch(() => undefined);

/** Runs `watchOnce` every `intervalMs` until `signal` aborts. A failed round is logged, not fatal. */
export async function watch(options: WatchOptions): Promise<void> {
  const { agent, log, intervalMs, signal } = options;
  const sleep = options.sleep ?? abortableSleep;
  log(
    `Watching ${agent.accountId ?? 'no account'}: a plain loop that checks every ${intervalMs / 1000} s. Stop it with Ctrl+C.`,
  );
  while (!signal.aborted) {
    try {
      await watchOnce({ agent, log });
    } catch (error) {
      log(`Round failed: ${describeError(error)}`);
    }
    if (signal.aborted) break;
    await sleep(intervalMs, signal);
  }
  log('Stopped.');
}
