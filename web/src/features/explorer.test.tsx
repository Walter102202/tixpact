import { screen, within } from '@testing-library/react';
import { explorerAccountUrl } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { renderAt, testServices } from '../test/render';

// Threat model, Limit 7: the web is not the contract, so each screen links to the explorer.

const explorerLinks = () =>
  screen
    .queryAllByRole('link')
    .filter((link) => link.getAttribute('href')?.startsWith('https://testnet.nearblocks.io/'));

/** The explorer link inside the value next to a facts label. */
function factLink(label: string): string | null {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling as HTMLElement;
  return within(value).queryByRole('link')?.getAttribute('href') ?? null;
}

describe('explorer links on live data', () => {
  const live = () => testServices({ fixtureMode: false });

  it.each(['/', '/events/1', '/tickets', '/tickets/1-3', '/organizer', '/verify/1', '/proof'])(
    '%s links the contract account in the footer',
    async (path) => {
      const services = live();
      renderAt(path, services);
      const footer = screen.getByRole('contentinfo');
      expect(
        within(footer).getByRole('link', { name: services.contractId }).getAttribute('href'),
      ).toBe(explorerAccountUrl(services.contractId));
    },
  );

  it('the event page links the organizer and the verifier', async () => {
    renderAt('/events/1', live());
    await screen.findByRole('heading', { level: 1, name: 'Jazz night' });
    expect(factLink('Organizer')).toBe(explorerAccountUrl('org.testnet'));
    expect(factLink('Verifier')).toBe(explorerAccountUrl('teatro.testnet'));
  });

  it('the ticket page links the holder and the contract', async () => {
    const services = live();
    renderAt('/tickets/1-3', services);
    await screen.findByRole('heading', { level: 1, name: 'Ticket 1-3' });
    expect(factLink('Holder')).toBe(explorerAccountUrl('luis.testnet'));
    const lead = screen.getByText(/A NEAR NFT \(NEP-171\) on the contract/);
    expect(within(lead).getByRole('link', { name: services.contractId }).getAttribute('href')).toBe(
      explorerAccountUrl(services.contractId),
    );
  });
});

describe('explorer links on demo data', () => {
  it('are not shown: the demo accounts and hashes are not on chain', async () => {
    renderAt('/tickets/1-3');
    await screen.findByRole('heading', { level: 1, name: 'Ticket 1-3' });
    expect(explorerLinks()).toEqual([]);
  });
});
