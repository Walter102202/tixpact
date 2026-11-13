import type { EventView, TicketView } from './schemas.js';

/**
 * Whether the holder can call `claim_refund` on this ticket now, as the contract would judge it
 * at the event's `now_ms` (docs/decisions/2026-11-12-claim-shown-when-event-is-expirable.md).
 *
 * True when the ticket is `Refundable`, and also when it is `Reserved` and its event is past the
 * deadline without confirmation (`Expirable`): `claim_refund` then expires the event and pays in
 * one call. Never true while a transfer or a refund holds the ticket. Whether the viewer is the
 * holder is the caller's question.
 */
export function canClaimRefund(ticket: TicketView, event: EventView): boolean {
  if (ticket.event_id !== event.event_id || ticket.status !== 'Active') return false;
  if (ticket.claim === 'Refundable') return true;
  return ticket.claim === 'Reserved' && event.phase === 'Expirable';
}
