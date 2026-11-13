import {
  actions,
  FIXTURES,
  FIXTURES_WITH_TOKENS,
  parseNear,
  type TicketView,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { ALLOWED_METHODS, evaluate, exposureOf, type Policy } from './policy.js';

const CONTRACT = 'ticket-escrow.testnet';
const policy: Policy = {
  contractId: CONTRACT,
  maxPriceYocto: parseNear('1.5'),
  maxExposureYocto: parseNear('5'),
};
const nothingHeld = { exposureYocto: '0' };
/** A purchase of an event priced in NEAR, with nothing held. */
const nearPurchase = { exposureYocto: '0', eventCurrency: null };

describe('evaluate', () => {
  it('allows a purchase within both caps', () => {
    const call = actions.buyTicket(1, parseNear('1.5'));
    expect(
      evaluate(
        policy,
        { exposureYocto: parseNear('3.5'), eventCurrency: null },
        { receiverId: CONTRACT, call },
      ),
    ).toEqual({ outcome: 'allow' });
  });

  it('denies a price above the per-ticket cap and says both amounts (Review Focus 5)', () => {
    const call = actions.buyTicket(9, parseNear('2'));
    expect(evaluate(policy, nearPurchase, { receiverId: CONTRACT, call })).toEqual({
      outcome: 'deny',
      reason: 'price_above_cap',
      message: 'Price 2 NEAR is above the per-ticket cap of 1.5 NEAR',
    });
  });

  it('denies when the exposure plus the price exceeds the exposure cap', () => {
    const call = actions.buyTicket(1, parseNear('1.5'));
    expect(
      evaluate(
        policy,
        { exposureYocto: parseNear('3.6'), eventCurrency: null },
        { receiverId: CONTRACT, call },
      ),
    ).toEqual({
      outcome: 'deny',
      reason: 'exposure_above_cap',
      message:
        'Exposure would be 5.1 NEAR (3.6 NEAR in tickets held plus 1.5 NEAR for this one), above the cap of 5 NEAR',
    });
  });

  it('shows amounts exactly, never rounded to look within a cap', () => {
    const call = actions.buyTicket(1, (BigInt(parseNear('1.5')) + 1n).toString());
    const decision = evaluate(policy, nearPurchase, { receiverId: CONTRACT, call });
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
    expect(evaluate(closed, nearPurchase, { receiverId: CONTRACT, call })).toMatchObject({
      outcome: 'deny',
      reason: 'price_above_cap',
    });
  });

  it('denies a purchase for an event priced in a token, because the caps are in NEAR', () => {
    // buy_ticket on a tUSD event would attach the tUSD price as yoctoNEAR: dust, within every cap.
    const call = actions.buyTicket(10, '10000000');
    expect(
      evaluate(
        policy,
        { exposureYocto: '0', eventCurrency: 'tusd.testnet' },
        { receiverId: CONTRACT, call },
      ),
    ).toEqual({
      outcome: 'deny',
      reason: 'currency_not_near',
      message:
        'Event 10 is priced in tusd.testnet, not in NEAR: this agent only buys tickets priced in NEAR, because its caps are in NEAR',
    });
  });

  it('checks the currency before the price cap, which would compare token units with NEAR', () => {
    const call = actions.buyTicket(10, parseNear('100'));
    const decision = evaluate(
      policy,
      { exposureYocto: null, eventCurrency: 'tusd.testnet' },
      { receiverId: CONTRACT, call },
    );
    expect(decision).toMatchObject({ outcome: 'deny', reason: 'currency_not_near' });
  });

  it('never allows a purchase whose event currency was not read', () => {
    const call = actions.buyTicket(1, parseNear('1'));
    expect(() => evaluate(policy, nothingHeld, { receiverId: CONTRACT, call })).toThrow(
      /currency was not read/,
    );
  });

  it('keeps the allow list closed to the token calls of interface v2', () => {
    const event = { event_id: 10, price: '10000000', currency: 'tusd.testnet' };
    const tokenCalls = [
      actions.buyTicketWithToken(CONTRACT, event),
      actions.registerWithToken('tusd.testnet', 'luis.testnet', parseNear('0.00125')),
      actions.faucet('tusd.testnet'),
    ];
    for (const call of tokenCalls) {
      // Sent where the builder says, to the token: not the one contract the agent may call.
      expect(evaluate(policy, nearPurchase, { receiverId: call.receiverId, call })).toMatchObject({
        outcome: 'deny',
        reason: 'contract_not_allowed',
      });
      // Even aimed at the escrow contract, the method is not on the list.
      expect(evaluate(policy, nearPurchase, { receiverId: CONTRACT, call })).toMatchObject({
        outcome: 'deny',
        reason: 'method_not_allowed',
      });
    }
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

  it('leaves out tickets priced in a token: their amounts are not yoctoNEAR', () => {
    const tusd = (claim: TicketView['claim']) => ({
      ...held(claim, '25000000'),
      currency: 'tusd.testnet',
    });
    const tickets = [held('Reserved', parseNear('1')), tusd('Reserved'), tusd('Refundable')];
    expect(exposureOf(tickets)).toBe(parseNear('1'));
    const luis = FIXTURES_WITH_TOKENS.tickets.filter((t) => t.owner_id === 'luis.testnet');
    expect(luis.some((t) => t.currency !== null)).toBe(true);
    expect(exposureOf(luis)).toBe(parseNear('8.5'));
  });

  it('adds up the fixture holder exactly', () => {
    const luis = FIXTURES.tickets.filter((t) => t.owner_id === 'luis.testnet');
    expect(exposureOf(luis)).toBe(parseNear('8.5'));
  });
});
