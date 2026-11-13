import { actions, parseNear } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { toConnectorAction, txHashFromOutcome } from './walletOutcome';

describe('toConnectorAction', () => {
  it('turns a contract call into near-connect FunctionCall action, amounts as given', () => {
    expect(toConnectorAction(actions.buyTicket(1, parseNear('1.5')))).toEqual({
      type: 'FunctionCall',
      params: {
        methodName: 'buy_ticket',
        args: { event_id: 1 },
        gas: '50000000000000',
        deposit: '1500000000000000000000000',
      },
    });
  });
});

describe('txHashFromOutcome', () => {
  it('reads the transaction hash from the outcome the wallet returns', () => {
    expect(
      txHashFromOutcome({
        transaction_outcome: { id: 'AXBfY5E1CdGAt4TzSk7u1wgqUzaTqPVRdvcFsxjjoPq2' },
      }),
    ).toBe('AXBfY5E1CdGAt4TzSk7u1wgqUzaTqPVRdvcFsxjjoPq2');
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'ok'],
    ['an outcome without a hash', { transaction_outcome: {} }],
    ['an empty hash', { transaction_outcome: { id: '' } }],
    ['a number for the hash', { transaction_outcome: { id: 7 } }],
  ])('refuses %s', (_, outcome) => {
    expect(() => txHashFromOutcome(outcome)).toThrow(
      'The wallet did not return a transaction hash.',
    );
  });
});
