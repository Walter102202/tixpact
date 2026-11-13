import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_MESSAGES, parseContractError } from './errors.js';

const FROZEN_CODES = [
  'ERR_NOT_FOUND',
  'ERR_UNAUTHORIZED',
  'ERR_ONE_YOCTO',
  'ERR_WRONG_DEPOSIT',
  'ERR_INVALID_TERMS',
  'ERR_LIMIT',
  'ERR_TERMS_MISMATCH',
  'ERR_NOT_ACCEPTED',
  'ERR_SOLD_OUT',
  'ERR_TOO_EARLY',
  'ERR_TOO_LATE',
  'ERR_ALREADY_RESOLVED',
  'ERR_NOT_REFUNDABLE',
  'ERR_NOT_COMPLETED',
  'ERR_TICKET_LOCKED',
  'ERR_ALREADY_REFUNDED',
  'ERR_NOTHING_TO_PAY',
  'ERR_PAYOUT_PENDING',
  'ERR_INSUFFICIENT_LIQUIDITY',
  'ERR_INSUFFICIENT_GAS',
  'ERR_APPROVALS_DISABLED',
];

describe('error codes', () => {
  it('are exactly the frozen list', () => {
    expect([...ERROR_CODES]).toEqual(FROZEN_CODES);
  });

  it('each have one distinct plain-English sentence', () => {
    const sentences = ERROR_CODES.map((code) => ERROR_MESSAGES[code]);
    for (const sentence of sentences) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).not.toMatch(/ERR_|yocto(?!NEAR)/);
    }
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe('parseContractError', () => {
  it('reads the code from a contract panic message', () => {
    expect(
      parseContractError('Smart contract panicked: ERR_TICKET_LOCKED: ticket 1-3 is locked'),
    ).toEqual({ code: 'ERR_TICKET_LOCKED', message: ERROR_MESSAGES.ERR_TICKET_LOCKED });
  });

  it('reads the code from a receipt failure', () => {
    const failure = {
      ActionError: {
        index: 0,
        kind: {
          FunctionCallError: {
            ExecutionError: 'Smart contract panicked: ERR_SOLD_OUT: event 3 has no tickets left',
          },
        },
      },
    };
    expect(parseContractError(failure).code).toBe('ERR_SOLD_OUT');
  });

  it('reads the code from errors, their causes and failover error lists', () => {
    expect(parseContractError(new Error('ERR_NOT_REFUNDABLE: event 1 is unresolved')).code).toBe(
      'ERR_NOT_REFUNDABLE',
    );
    const wrapped = new Error('Wallet rejected', {
      cause: { data: 'Smart contract panicked: ERR_ONE_YOCTO: attach 1 yoctoNEAR' },
    });
    expect(parseContractError(wrapped).code).toBe('ERR_ONE_YOCTO');
    const failover = Object.assign(new Error('All providers failed'), {
      errors: [new Error('fetch failed'), new Error('ERR_NOT_FOUND: no event 9')],
    });
    expect(parseContractError(failover).code).toBe('ERR_NOT_FOUND');
  });

  it('does not invent a code it does not know', () => {
    const result = parseContractError('Smart contract panicked: ERR_SOMETHING_NEW: surprise');
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).toBe('The contract rejected the call: ERR_SOMETHING_NEW: surprise');
  });

  it('describes common chain failures in plain words', () => {
    const missing = {
      ActionError: {
        index: 0,
        kind: { AccountDoesNotExist: { account_id: 'vanishing-holder.testnet' } },
      },
    };
    expect(parseContractError(missing)).toEqual({
      code: 'UNKNOWN',
      message: 'Account vanishing-holder.testnet does not exist.',
    });
    const gas = {
      ActionError: {
        index: 0,
        kind: { FunctionCallError: { ExecutionError: 'Exceeded the prepaid gas.' } },
      },
    };
    expect(parseContractError(gas)).toEqual({
      code: 'UNKNOWN',
      message: 'The call ran out of gas before it finished.',
    });
    expect(parseContractError(undefined)).toEqual({
      code: 'UNKNOWN',
      message: 'The transaction failed for a reason the app does not recognize.',
    });
  });

  it('survives cyclic input', () => {
    const cyclic: { self?: unknown; message: string } = { message: 'ERR_LIMIT: memo too long' };
    cyclic.self = cyclic;
    expect(parseContractError(cyclic).code).toBe('ERR_LIMIT');
  });
});
