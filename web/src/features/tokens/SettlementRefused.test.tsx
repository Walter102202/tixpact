import { render } from '@testing-library/react';
import type { FailedReceipt } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { refusedByToken, SettlementRefused } from './SettlementRefused';

const TUSD_UNIT = { symbol: 'tUSD', decimals: 6 };

function failedOn(executorId: string, message: string): FailedReceipt {
  return { receiptId: 'r', step: 'other', executorId, error: { code: 'UNKNOWN', message } };
}

describe('refusedByToken', () => {
  it('is the failed receipt only when it ran on the event currency', () => {
    const failed = failedOn('tusd.testnet', 'The account x.testnet is not registered');
    expect(refusedByToken({ ok: false, failedReceipt: failed }, 'tusd.testnet')).toBe(failed);
    expect(refusedByToken({ ok: false, failedReceipt: failed }, null)).toBeNull();
    expect(refusedByToken({ ok: false, failedReceipt: failed }, 'other.testnet')).toBeNull();
    expect(refusedByToken({ ok: false }, 'tusd.testnet')).toBeNull();
  });
});

describe('SettlementRefused', () => {
  it('for another refusal, names the token and keeps its message, without a registration step', () => {
    const { container } = render(
      <SettlementRefused
        failed={failedOn('tusd.testnet', 'Smart contract panicked: paused')}
        payee="luis.testnet"
        unit={TUSD_UNIT}
        restored="The claim is back on the ticket."
        retry="claim"
      />,
    );
    expect(container.textContent).toContain(
      'Nothing was paid and nothing was lost: the token tusd.testnet refused to pay luis.testnet.',
    );
    expect(container.textContent).toContain('Smart contract panicked: paused');
    expect(container.textContent).toContain('The claim is back on the ticket.');
    expect(container.textContent).not.toContain('Register');
  });

  it('promises nothing back when the page read again does not show it', () => {
    const { container } = render(
      <SettlementRefused
        failed={failedOn('tusd.testnet', 'The account luis.testnet is not registered')}
        payee="luis.testnet"
        unit={TUSD_UNIT}
        restored={null}
        retry="claim"
      />,
    );
    expect(container.textContent).toBe(
      'Nothing was paid: tUSD could not pay luis.testnet, which is not registered with it.',
    );
  });
});
