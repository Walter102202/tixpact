import { describe, expect, it } from 'vitest';
import { FIXTURES } from './fixtures.js';
import { canClaimRefund } from './rules.js';
import type { EventView, TicketView } from './schemas.js';

function eventById(id: number): EventView {
  const event = FIXTURES.events.find((e) => e.event_id === id);
  if (!event) throw new Error(`no fixture event ${id}`);
  return event;
}

function ticketById(id: string): TicketView {
  const ticket = FIXTURES.tickets.find((t) => t.token_id === id);
  if (!ticket) throw new Error(`no fixture ticket ${id}`);
  return ticket;
}

describe('canClaimRefund', () => {
  it('is true for a refundable ticket of a refundable event', () => {
    expect(canClaimRefund(ticketById('8-1'), eventById(8))).toBe(true);
  });

  it('is true for a reserved ticket once the deadline passed without confirmation', () => {
    const ticket = ticketById('6-1');
    const event = eventById(6);
    expect(ticket.claim).toBe('Reserved');
    expect(event.phase).toBe('Expirable');
    expect(canClaimRefund(ticket, event)).toBe(true);
  });

  it('is false while the event can still be confirmed', () => {
    expect(canClaimRefund(ticketById('1-3'), eventById(1))).toBe(false);
    expect(canClaimRefund(ticketById('4-1'), eventById(4))).toBe(false);
    expect(canClaimRefund(ticketById('5-1'), eventById(5))).toBe(false);
  });

  it('is false once the money is on its way, refunded or released', () => {
    expect(canClaimRefund(ticketById('8-2'), eventById(8))).toBe(false);
    expect(canClaimRefund(ticketById('8-3'), eventById(8))).toBe(false);
    expect(canClaimRefund(ticketById('7-1'), eventById(7))).toBe(false);
  });

  it('is false for a ticket locked by a transfer, even after the deadline', () => {
    const locked: TicketView = { ...ticketById('6-1'), status: 'TransferPending' };
    expect(canClaimRefund(locked, eventById(6))).toBe(false);
  });

  it('is false when the event is not the ticket event', () => {
    expect(canClaimRefund(ticketById('6-1'), eventById(8))).toBe(false);
  });
});
