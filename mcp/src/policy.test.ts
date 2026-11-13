import { actions, FIXTURES, parseNear, type TicketView } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { ALLOWED_METHODS, evaluate, exposureOf, type Policy } from './policy.js';

const CONTRACT = 'ticket-escrow.testnet';
const policy: Policy = {
  contractId: CONTRACT,
  maxPriceYocto: parseNear('1.5'),
  maxExposureYocto: parseNear('5'),
};
const nothingHeld = { exposureYocto: '0' };

describe('evaluate', () => {
  it('allows a purchase within both caps', () => {
    const call = actions.buyTicket(1, parseNear('1.5'));
    expect(
      evaluate(policy, { exposureYocto: parseNear('3.5') }, { receiverId: CONTRACT, call }),
    ).toEqual({ outcome: 'allow' });
  });

  it('denies a price above the per-ticket cap and says both amounts (Review Focus 5)', () => {
    const call = actions.buyTicket(9, parseNear('2'));
    expect(evaluate(policy, nothingHeld, { receiverId: CONTRACT, call })).toEqual({
      outcome: 'deny',
      reason: 'price_above_cap',
      message: 'Price 2 NEAR is above the per-ticket cap of 1.5 NEAR',
    });
  });

  it('denies when the exposure plus the price exceeds the exposure cap', () => {
    const call = actions.buyTicket(1, parseNear('1.5'));
    expect(
      evaluate(policy, { exposureYocto: parseNear('3.6') }, { receiverId: CONTRACT, call }),
    ).toEqual({
      outcome: 'deny',
      reason: 'exposure_above_cap',
      message:
        'Exposure would be 5.1 NEAR (3.6 NEAR in tickets held plus 1.5 NEAR for this one), above the cap of 5 NEAR',
    });
  });

  it('shows amounts exactly, never rounded to look within a cap', () => {
    const call = actions.buyTicket(1, (BigInt(parseNear('1.5')) + 1n).toString());
    const decision = evaluate(policy, nothingHeld, { receiverId: CONTRACT, call });
    expect(decision).toMatchObject({ outcome: 'deny', reason: 'price_above_cap' });
    expect(decision.outcome === 'deny' && decision.message).toBe(
      'Price 1.500000000000000000000001 NEAR is above the per-ticket cap of 1.5 NEAR',
    );
  });

  it('denies a contract outside the allowlist', () => {
    const call = actions.buyTicket(1, parseNear('1'));
    expect(evaluate(policy, nothingHeld, { receiverId: 'other.testnet', call })).toEqual({
      outcome: 'deny',
      reason: 'contract_not_allowed',
      message: 'Contract other.testnet is not allowed: this agent only calls ticket-escrow.testnet',
    });
  });

  it('denies a method outside the allowlist, even on the allowed contract', () => {
    for (const call of [
      actions.claimPayout(7),
      actions.cancelEvent(1),
      actions.attestCompleted(5),
      actions.acceptVerification(2, 'a'.repeat(64)),
    ]) {
      expect(evaluate(policy, nothingHeld, { receiverId: CONTRACT, call })).toEqual({
        outcome: 'deny',
        reason: 'method_not_allowed',
        message: `Method ${call.methodName} is not allowed: this agent only calls buy_ticket, nft_transfer, expire_event and claim_refund`,
      });
    }
  });

  it('checks the contract before the method', () => {
    const decision = evaluate(policy, nothingHeld, {
      receiverId: 'other.testnet',
      call: actions.claimPayout(7),
    });
    expect(decision).toMatchObject({ reason: 'contract_not_allowed' });
  });

  it('lets only buy_ticket attach more than 1 yoctoNEAR', () => {
    const call = { ...actions.claimRefund('8-1'), deposit: parseNear('1') };
    expect(evaluate(policy, nothingHeld, { receiverId: CONTRACT, call })).toEqual({
      outcome: 'deny',
      reason: 'deposit_not_allowed',
      message: 'claim_refund would attach 1 NEAR; only buy_ticket may attach more than 1 yoctoNEAR',
    });
  });

  it('allows the transfer, expiry and claim calls as the client builds them', () => {
    for (const call of [
      actions.transferTicket('1-3', 'ana.testnet'),
      actions.expireEvent(6),
      actions.claimRefund('8-1'),
    ]) {
      expect(evaluate(policy, nothingHeld, { receiverId: CONTRACT, call })).toEqual({
        outcome: 'allow',
      });
    }
  });

  it('denies more gas than the client gas table gives the method', () => {
    const call = { ...actions.buyTicket(1, parseNear('1')), gas: (51n * 10n ** 12n).toString() };
    expect(evaluate(policy, nothingHeld, { receiverId: CONTRACT, call })).toEqual({
      outcome: 'deny',
      reason: 'gas_above_table',
      message: 'buy_ticket asks for 51 Tgas, above the 50 Tgas the client gives it',
    });
  });

  it('a zero cap denies every purchase', () => {
    const closed = { ...policy, maxPriceYocto: '0' };
    const call = actions.buyTicket(1, '1');
    expect(evaluate(closed, nothingHeld, { receiverId: CONTRACT, call })).toMatchObject({
      outcome: 'deny',
      reason: 'price_above_cap',
    });
  });

  it('names exactly the four methods the plan allows', () => {
    expect([...ALLOWED_METHODS]).toEqual([
      'buy_ticket',
      'nft_transfer',
      'expire_event',
      'claim_refund',
    ]);
  });
});

describe('exposureOf', () => {
  const held = (claim: TicketView['claim'], principal: string): TicketView => ({
    token_id: '1-1',
    event_id: 1,
    serial: 1,
    owner_id: 'agent.testnet',
    principal,
    status: claim === 'RefundPending' ? 'RefundPending' : 'Active',
    claim,
    pending_operation_id: null,
    currency: null,
  });

  it('counts the principal still inside the contract: reserved, claimable or being sent', () => {
    const tickets = [
      held('Reserved', parseNear('1')),
      held('Refundable', parseNear('2')),
      held('RefundPending', parseNear('0.5')),
      held('Refunded', parseNear('10')),
      held('ReleasedToOrganizer', parseNear('20')),
    ];
    expect(exposureOf(tickets)).toBe(parseNear('3.5'));
  });

  it('is zero with no tickets', () => {
    expect(exposureOf([])).toBe('0');
  });

  it('adds up the fixture holder exactly', () => {
    const luis = FIXTURES.tickets.filter((t) => t.owner_id === 'luis.testnet');
    expect(exposureOf(luis)).toBe(parseNear('8.5'));
  });
});
