import { fireEvent, screen, within } from '@testing-library/react';
import {
  createFixtureReader,
  FIXTURES,
  FIXTURES_WITH_TOKENS,
  type Reader,
  SVG_MEDIA_PREFIX,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { createFixtureWallet } from '../../lib/near/wallet';
import { renderAt, testServices } from '../../test/render';

// The ticket as wallets show it: the contract's own description and drawn ticket (`nft_token`).

async function openTicket(id: string, reader: Reader, as = 'luis.testnet') {
  const services = testServices({ reader, wallet: createFixtureWallet(as) });
  renderAt(`/tickets/${id}`, services);
  await screen.findByRole('heading', { level: 1, name: `Ticket ${id}` });
  return services;
}

const section = () => screen.findByRole('region', { name: 'As wallets show it' });

describe('the ticket page shows the ticket as wallets show it', () => {
  it('for a reserved NEAR ticket: the picture, its sentence, and the hash check', async () => {
    await openTicket('1-3', createFixtureReader(FIXTURES));
    const shown = await section();
    const event = FIXTURES.events.find((e) => e.event_id === 1);
    const description = `Ticket 3 of ${event?.capacity} for ${event?.title} at ${event?.venue}. 1.5 NEAR is reserved in the contract until the event is resolved.`;
    const image = within(shown).getByRole('img', { name: description }) as HTMLImageElement;
    expect(image.getAttribute('src')?.startsWith(SVG_MEDIA_PREFIX)).toBe(true);
    expect(within(shown).getByText(description, { selector: 'p' })).toBeTruthy();
    expect(shown.textContent).toContain(
      'The contract computes the picture and this sentence at every read, so they change with the ticket. The picture matches the hash the contract gives.',
    );
  });

  it('for a refunded tUSD ticket', async () => {
    await openTicket('11-3', createFixtureReader(FIXTURES_WITH_TOKENS));
    const shown = await section();
    const image = within(shown).getByRole('img');
    expect(image.getAttribute('alt')).toMatch(
      /^Ticket 3 of \d+ for .+\. 25 tUSD was refunded to the holder\.$/,
    );
    expect(
      Buffer.from(
        (image.getAttribute('src') ?? '').slice(SVG_MEDIA_PREFIX.length),
        'base64',
      ).toString(),
    ).toContain('>Refunded</text>');
  });

  it('hides a picture whose hash does not match, and says so', async () => {
    const fixtures = createFixtureReader(FIXTURES);
    const reader: Reader = {
      ...fixtures,
      ticketDisplay: async (tokenId) => {
        const display = await fixtures.ticketDisplay?.(tokenId);
        return display
          ? { ...display, mediaHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }
          : null;
      },
    };
    await openTicket('1-3', reader);
    const shown = await section();
    expect(within(shown).queryByRole('img')).toBeNull();
    expect(shown.textContent).toContain(
      'The picture does not match the hash the contract gives, so it is not shown.',
    );
    expect(shown.textContent).not.toContain('matches the hash');
  });

  it('leaves the section out when the read fails, and the page works', async () => {
    const reader: Reader = {
      ...createFixtureReader(FIXTURES),
      ticketDisplay: () => Promise.reject(new Error('rpc down')),
    };
    await openTicket('1-3', reader);
    expect(await screen.findByText('Price paid', { selector: 'dt' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Entry pass' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'As wallets show it' })).toBeNull();
  });

  it('reads it again after a claim on this page changes the ticket', async () => {
    const data = structuredClone(FIXTURES_WITH_TOKENS);
    const reader = createFixtureReader(data);
    const services = await openTicket('11-1', reader);
    const before = await section();
    expect(before.textContent).toContain('whoever holds this ticket can claim 25 tUSD.');
    const recorded = services.wallet.answer;
    services.wallet.answer = async (call) => {
      // The contract pays the claim: the ticket is now refunded.
      const ticket = data.tickets.find((t) => t.token_id === '11-1');
      if (ticket) Object.assign(ticket, { status: 'Refunded', claim: 'Refunded' });
      return recorded(call);
    };
    fireEvent.click(await screen.findByRole('button', { name: 'Claim 25 tUSD to luis.testnet' }));
    expect(
      await screen.findByText(/25 tUSD was refunded to the holder\.$/, { selector: 'p' }),
    ).toBeTruthy();
  });
});
