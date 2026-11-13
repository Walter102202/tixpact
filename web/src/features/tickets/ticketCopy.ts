import {
  CLAIM_LABELS,
  canClaimRefund,
  type EventView,
  type HistoryEntry,
  type TicketView,
} from '@ticket-escrow/client';

/**
 * The claim word. "Claimable" means one thing: the holder can claim it now. That includes a
 * `Reserved` ticket whose event is past the deadline (canClaimRefund).
 */
export function claimWord(ticket: TicketView, event: EventView): string {
  if (canClaimRefund(ticket, event)) return CLAIM_LABELS.Refundable;
  // Refundable but locked (a transfer to a contract is pending): the money is there, the claim is not.
  if (ticket.claim === 'Refundable') return CLAIM_LABELS.Reserved;
  return CLAIM_LABELS[ticket.claim];
}

/** One line per history entry; the account is whoever the entry is about. */
export function historyText(entry: HistoryEntry): string {
  switch (entry.kind) {
    case 'Purchased':
      return `Bought by ${entry.account_id}`;
    case 'Transferred':
      return `Transferred to ${entry.account_id}`;
    case 'TransferReturned':
      return `Returned to ${entry.account_id}: the receiving contract did not keep it`;
    case 'RefundRequested':
      return `Refund requested for ${entry.account_id}`;
    case 'RefundSettled':
      return `Refunded to ${entry.account_id}`;
    case 'RefundFailed':
      return `Refund to ${entry.account_id} failed; the claim was restored`;
  }
}

/**
 * Why the holder cannot transfer the ticket now, or null when they can. Mirrors R6: only while the
 * event is unresolved, before it starts, and with no transfer or refund in flight.
 */
export function transferBlockedReason(ticket: TicketView, event: EventView): string | null {
  if (ticket.status === 'TransferPending') {
    return 'A transfer to a contract is still waiting for its answer.';
  }
  if (ticket.status === 'RefundPending') return 'A refund for this ticket is being sent.';
  if (ticket.status === 'Refunded') return 'This ticket was refunded.';
  if (event.outcome === 'Completed') return 'The event took place and was confirmed.';
  if (event.outcome === 'Refundable') {
    return 'The event is open for refunds: claim the price instead.';
  }
  if (event.now_ms >= event.starts_at_ms) return 'Transfers closed when the event started.';
  return null;
}
