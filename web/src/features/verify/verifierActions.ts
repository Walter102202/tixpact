import type { EventView } from '@ticket-escrow/client';
import { outcomeLine } from '../events/eventCopy';

export type VerifierAction = 'accept' | 'attest' | 'cancel';

const DEADLINE_PASSED =
  'The deadline passed: the event can only be expired, and every holder can claim.';

/**
 * Why each verifier action is unavailable, or null when the contract would take it now, judged
 * at the chain time of the read (`now_ms`). Mirrors R2 and `accept_verification`'s window:
 * accept while `now < starts_at_ms`; confirm while `ends_at_ms <= now < resolution_deadline_ms`;
 * cancel while `now < resolution_deadline_ms`; all only for the named verifier, only unresolved.
 */
export function verifierBlockers(
  event: EventView,
  accountId: string | null,
  time: (ms: number) => string,
): Record<VerifierAction, string | null> {
  const all = (reason: string) => ({ accept: reason, attest: reason, cancel: reason });
  if (accountId === null) return all(`Sign in as ${event.verifier_id} to act on this event.`);
  if (accountId !== event.verifier_id) {
    return all(`Only ${event.verifier_id} can accept, confirm or cancel this event.`);
  }
  if (event.outcome !== 'Unresolved') return all(`The event is resolved: ${outcomeLine(event)}.`);

  const now = event.now_ms;
  const pastDeadline = now >= event.resolution_deadline_ms;
  let accept: string | null = null;
  if (event.verifier_accepted) accept = 'You accepted these terms.';
  else if (now >= event.starts_at_ms) {
    accept = 'The event has started; the terms can no longer be accepted.';
  }

  let attest: string | null = null;
  if (!event.verifier_accepted) attest = 'Accept the terms first.';
  else if (pastDeadline) attest = DEADLINE_PASSED;
  else if (now < event.ends_at_ms) attest = `Opens when the event ends: ${time(event.ends_at_ms)}.`;

  return { accept, attest, cancel: pastDeadline ? DEADLINE_PASSED : null };
}
