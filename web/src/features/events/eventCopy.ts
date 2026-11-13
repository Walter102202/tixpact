import { type EventView, formatNear } from '@ticket-escrow/client';

export const near = (yocto: string) => `${formatNear(yocto)} NEAR`;

/** Why tickets cannot be bought right now, or null while the event is on sale. */
export function buyBlockedReason(event: EventView): string | null {
  switch (event.phase) {
    case 'OnSale':
      return null;
    case 'AwaitingVerifier':
      return `Tickets go on sale once ${event.verifier_id} accepts these terms.`;
    case 'SoldOut':
      return `Sold out: all ${event.capacity} tickets are taken.`;
    case 'InProgress':
    case 'AwaitingAttestation':
    case 'Expirable':
      return 'Sales closed when the event started.';
    case 'Completed':
      return 'Sales are closed: the event took place and was confirmed.';
    case 'Refundable':
      return 'Sales are closed: this event is open for refunds.';
  }
}

/** The verifier line: who confirms, and whether they accepted the terms. Never says "Confirmed". */
export function verifierStatus(event: EventView): string {
  return event.verifier_accepted ? 'accepted these terms' : 'Awaiting verifier';
}

/** The outcome headline of a resolved event, or the open question of an unresolved one. */
export function outcomeLine(event: EventView): string | null {
  if (event.outcome === 'Completed')
    return `Confirmed by ${event.resolved_by ?? event.verifier_id}`;
  if (event.outcome_reason === 'Cancelled') {
    return `Cancelled by ${event.resolved_by ?? 'the organizer or the verifier'}`;
  }
  if (event.outcome_reason === 'Expired' || event.phase === 'Expirable') {
    return 'The deadline passed without confirmation';
  }
  return null;
}

/** What `evidence_ref` holds for this outcome (decision 2026-11-12-cancel-reason-shares-evidence-ref). */
export function referenceLabel(event: EventView): string {
  return event.outcome_reason === 'Attested' ? 'Evidence' : 'Reason';
}
