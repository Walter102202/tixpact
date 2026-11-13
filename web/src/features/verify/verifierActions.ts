import type { EventView } from '@ticket-escrow/client';
import { outcomeLine } from '../events/eventCopy';

export type VerifierAction = 'accept' | 'attest' | 'cancel';

const DEADLINE_PASSED =
  'The deadline passed: the event can only be expired, and every holder can claim.';

/**
 * Why each verifier action is unavailable on this page, or null when the contract would take it
 * now, judged at the chain time of the read (`now_ms`). Mirrors R2 and `accept_verification`'s
 * window: accept while `now < starts_at_ms`; confirm while
 * `ends_at_ms <= now < resolution_deadline_ms`; cancel while `now < resolution_deadline_ms`; all
 * only while unresolved. Accept and confirm are the verifier's alone. The contract also takes a
 * cancel from the organizer, who is offered it on the Organize page.
 */
export function verifierBlockers(
  event: EventView,
  accountId: string | null,
  time: (ms: number) => string,
): Record<VerifierAction, string | null> {
  const all = (reason: string) => ({ accept: reason, attest: reason, cancel: reason });
  if (accountId === null) return all(`Sign in as ${event.verifier_id} to act on this event.`);
  if (event.outcome !== 'Unresolved') return all(`The event is resolved: ${outcomeLine(event)}.`);

  const now = event.now_ms;
  const pastDeadline = now >= event.resolution_deadline_ms;
  if (accountId !== event.verifier_id) {
    const decide = `Only ${event.verifier_id} can accept or confirm this event.`;
    let cancel = `Only ${event.verifier_id} or the organizer, ${event.organizer_id}, can cancel this event.`;
    if (pastDeadline) cancel = DEADLINE_PASSED;
    else if (accountId === event.organizer_id) {
      cancel = 'As the organizer, you can cancel this event from the Organize page.';
    }
    return { accept: decide, attest: decide, cancel };
  }
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
