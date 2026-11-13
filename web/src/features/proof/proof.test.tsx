import { fireEvent, screen } from '@testing-library/react';
import {
  type AccountProof,
  createFixtureReader,
  explorerAccountUrl,
  FIXTURES,
  formatNear,
  parseNear,
  type Reader,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { renderAt, testServices } from '../../test/render';

/** The value next to a label in the proof's facts list. */
function fact(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
}

function readerWith(proof: Partial<AccountProof>): Reader {
  const fixtures = createFixtureReader();
  return {
    ...fixtures,
    getAccountProof: async (id) => ({ ...(await fixtures.getAccountProof(id)), ...proof }),
  };
}

async function openProof(services = testServices()) {
  const view = renderAt('/proof', services);
  await screen.findByText('Code hash', { selector: 'dt' });
  return view;
}

describe('/proof', () => {
  it('shows the account, code hash, keys, balance, reserved principal and the block of the read', async () => {
    const asked: string[] = [];
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      getAccountProof: (id) => {
        asked.push(id);
        return fixtures.getAccountProof(id);
      },
    };
    const services = testServices({ reader });
    await openProof(services);
    expect(asked).toEqual([services.contractId]);
    expect(fact('Contract account')).toBe(services.contractId);
    expect(fact('Code hash')).toBe(FIXTURES.accountProof.codeHash);
    expect(fact('Access keys')).toBe('0 keys: nobody can change this contract');
    expect(fact('Contract balance')).toBe(`${formatNear(FIXTURES.accountProof.balance)} NEAR`);
    // 6 + 4 + 1 + 0.8 + 1.2 + 3: principal_reserved summed over every fixture event.
    expect(fact('Reserved for ticket holders')).toBe('16 NEAR');
    // Event 7 is confirmed and its organizer has not collected: organizer_available 4.5.
    expect(fact('Waiting for organizers to collect')).toBe('4.5 NEAR');
    expect(fact('Events read')).toBe('8');
    expect(fact('Read at block')).toBe('190,000,000');
  });

  it('says a deployment with keys can still be changed', async () => {
    await openProof(testServices({ reader: readerWith({ accessKeys: 2 }) }));
    expect(fact('Access keys')).toBe('2 keys: this deployment can still be changed');
  });

  it('uses the singular for one key', async () => {
    await openProof(testServices({ reader: readerWith({ accessKeys: 1 }) }));
    expect(fact('Access keys')).toBe('1 key: this deployment can still be changed');
  });

  it('compares the balance with both amounts the contract holds for others', async () => {
    await openProof();
    expect(screen.getByText('The balance covers both.')).toBeTruthy();
  });

  it('counts what organizers have yet to collect: a balance between the two is below', async () => {
    // 16 NEAR reserved + 4.5 NEAR to collect = 20.5 NEAR; 18 NEAR covers the first alone.
    await openProof(testServices({ reader: readerWith({ balance: parseNear('18') }) }));
    expect(
      screen.getByText('The balance is below what the contract holds for others.'),
    ).toBeTruthy();
  });

  it('says so when the balance is below both', async () => {
    await openProof(testServices({ reader: readerWith({ balance: '1' }) }));
    expect(
      screen.getByText('The balance is below what the contract holds for others.'),
    ).toBeTruthy();
  });

  it('links the contract account to the explorer on live data', async () => {
    const services = testServices({ fixtureMode: false });
    await openProof(services);
    const link = screen.getByRole('link', { name: 'Open the contract account in the explorer' });
    expect(link.getAttribute('href')).toBe(explorerAccountUrl(services.contractId));
  });

  it('shows "Could not read the chain" and no numbers when the RPC fails', async () => {
    const reader: Reader = {
      ...createFixtureReader(),
      getAccountProof: () => Promise.reject(new Error('every endpoint timed out')),
    };
    renderAt('/proof', testServices({ reader }));
    expect(await screen.findByText('Could not read the chain.')).toBeTruthy();
    expect(screen.queryByText(FIXTURES.accountProof.codeHash)).toBeNull();
    expect(screen.queryByText(/NEAR/, { selector: 'dd' })).toBeNull();
  });

  it('drops the numbers it showed when a fresh read fails', async () => {
    let fail = false;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      getAccountProof: (id) =>
        fail ? Promise.reject(new Error('down')) : fixtures.getAccountProof(id),
    };
    await openProof(testServices({ reader }));
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    expect(await screen.findByText('Could not read the chain.')).toBeTruthy();
    expect(screen.queryByText(FIXTURES.accountProof.codeHash)).toBeNull();
  });

  it('is in the main navigation', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Proof' }).getAttribute('href')).toBe('/proof');
  });
});
