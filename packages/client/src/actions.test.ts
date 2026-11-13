import { describe, expect, it } from 'vitest';
import {
  acceptVerification,
  attestCompleted,
  buyTicket,
  type ContractCall,
  cancelEvent,
  claimPayout,
  claimRefund,
  createEvent,
  expireEvent,
  GAS_TGAS,
  transferTicket,
} from './actions.js';

const PRICE = '1500000000000000000000000';
const QUOTE = '700000000000000000000000';
const HASH = '9f2c1d7e4b8a6f30c5d2e9a1b7f4c8e03d6a9b2f5e8c1a4d7b0e3f6a9c2d5e8f';
const TERMS = {
  title: 'Jazz night',
  venue: 'Teatro Municipal',
  starts_at_ms: 1794700000000,
  ends_at_ms: 1794710800000,
  resolution_deadline_ms: 1794883600000,
  price: PRICE,
  capacity: 50,
  verifier_id: 'teatro.testnet',
};

const tgas = (n: number) => `${n}000000000000`;

describe('action builders', () => {
  it('build every call with the frozen method, args, deposit and gas', () => {
    const cases: Array<[ContractCall, ContractCall]> = [
      [
        createEvent(TERMS, QUOTE),
        { methodName: 'create_event', args: { terms: TERMS }, deposit: QUOTE, gas: tgas(30) },
      ],
      [
        acceptVerification(1, HASH),
        {
          methodName: 'accept_verification',
          args: { event_id: 1, terms_hash: HASH },
          deposit: '1',
          gas: tgas(30),
        },
      ],
      [
        buyTicket(1, PRICE),
        { methodName: 'buy_ticket', args: { event_id: 1 }, deposit: PRICE, gas: tgas(50) },
      ],
      [
        cancelEvent(1),
        {
          methodName: 'cancel_event',
          args: { event_id: 1, reason_ref: null },
          deposit: '1',
          gas: tgas(30),
        },
      ],
      [
        attestCompleted(1, 'https://teatro.example/report'),
        {
          methodName: 'attest_completed',
          args: { event_id: 1, evidence_ref: 'https://teatro.example/report' },
          deposit: '1',
          gas: tgas(30),
        },
      ],
      [
        expireEvent(1),
        { methodName: 'expire_event', args: { event_id: 1 }, deposit: '0', gas: tgas(30) },
      ],
      [
        claimRefund('1-3'),
        { methodName: 'claim_refund', args: { token_id: '1-3' }, deposit: '1', gas: tgas(100) },
      ],
      [
        claimPayout(1),
        { methodName: 'claim_payout', args: { event_id: 1 }, deposit: '1', gas: tgas(100) },
      ],
      [
        transferTicket('1-3', 'luis.testnet'),
        {
          methodName: 'nft_transfer',
          args: { receiver_id: 'luis.testnet', token_id: '1-3', approval_id: null, memo: null },
          deposit: '1',
          gas: tgas(30),
        },
      ],
    ];
    for (const [built, expected] of cases) {
      expect(built).toEqual(expected);
    }
  });

  it('keep the whole client-side gas table in one place', () => {
    expect(GAS_TGAS).toEqual({
      create_event: 30,
      accept_verification: 30,
      buy_ticket: 50,
      cancel_event: 30,
      attest_completed: 30,
      expire_event: 30,
      claim_refund: 100,
      claim_payout: 100,
      nft_transfer: 30,
      nft_transfer_call: 150,
    });
  });

  it('refuse to build a call that would send a malformed amount or id', () => {
    expect(() => buyTicket(1, '1.5')).toThrow();
    expect(() => buyTicket(0, PRICE)).toThrow();
    expect(() => createEvent({ ...TERMS, price: 1.5e24 as unknown as string }, QUOTE)).toThrow();
    expect(() => createEvent(TERMS, '-1')).toThrow();
    expect(() => acceptVerification(1, '9f2c…')).toThrow();
    expect(() => claimRefund('1_3')).toThrow();
    expect(() => transferTicket('1-3', 'Not An Account')).toThrow();
  });

  it('return a fresh object each time', () => {
    const first = buyTicket(1, PRICE);
    (first.args as { event_id: number }).event_id = 2;
    expect(buyTicket(1, PRICE).args).toEqual({ event_id: 1 });
  });
});
