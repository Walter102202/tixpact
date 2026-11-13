import { actions, parseNear } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { toConnectorAction, transactionFor, txHashFromOutcome } from './walletOutcome';

describe('transactionFor', () => {
  it('sends a call on the escrow to the escrow contract', () => {
    const tx = transactionFor(actions.claimRefund('1-3'), 'luis.testnet', 'ticket-escrow.testnet');
    expect(tx.signerId).toBe('luis.testnet');
    expect(tx.receiverId).toBe('ticket-escrow.testnet');
    expect(tx.actions).toEqual([toConnectorAction(actions.claimRefund('1-3'))]);
  });

  it('sends a purchase in a token to the token, with the escrow as the transfer receiver', () => {
    const call = actions.buyTicketWithToken('ticket-escrow.testnet', {
      event_id: 10,
      price: '10000000',
      currency: 'tusd.testnet',
    });
    const tx = transactionFor(call, 'luis.testnet', 'ticket-escrow.testnet');
    expect(tx.receiverId).toBe('tusd.testnet');
    expect(tx.actions).toEqual([
      {
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer_call',
          args: {
            receiver_id: 'ticket-escrow.testnet',
            amount: '10000000',
            memo: null,
            msg: '{"event_id":10}',
          },
          gas: '100000000000000',
          deposit: '1',
        },
      },
    ]);
  });
});

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

  it('falls back to the hash of the signed transaction when the outcome carries no outcome id', () => {
    expect(
      txHashFromOutcome({
        transaction: { hash: 'AXBfY5E1CdGAt4TzSk7u1wgqUzaTqPVRdvcFsxjjoPq2' },
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
