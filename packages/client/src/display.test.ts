import { describe, expect, it } from 'vitest';
import {
  drawTicket,
  mediaMatchesHash,
  SVG_MEDIA_PREFIX,
  type TicketDisplay,
  ticketDisplayFor,
} from './display.js';
import { createFixtureReader, FIXTURES, FIXTURES_WITH_TOKENS } from './fixtures.js';
import { CLAIM_LABELS, formatAmount, NEAR_UNIT } from './format.js';
import { createReader, type ReaderRpc } from './reader.js';
import type { Claim, EventView, TicketView } from './schemas.js';

// Read on 2026-11-13 from testnet (read-only): te-d5-escrow.testnet (contract v2 at 2f36f84),
// nft_token {"token_id":"3-1"}. The SVG below is the 711 bytes its media carries; the hash is the
// chain's media_hash, so a wrong copy of either fails these tests.
const CHAIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180" viewBox="0 0 360 180"><rect x="2" y="2" width="356" height="176" rx="14" fill="#fbfaff" stroke="#2b8a3e" stroke-width="3"/><line x1="284" y1="16" x2="284" y2="164" stroke="#2b8a3e" stroke-width="2" stroke-dasharray="6 6"/><g font-family="system-ui,sans-serif" fill="#1b1b29"><text x="22" y="46" font-size="17" font-weight="700">Dollar night</text><text x="22" y="74" font-size="13">Ticket 1</text><text x="22" y="142" font-size="24" font-weight="700">10 tUSD</text></g><text x="322" y="90" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#2b8a3e" text-anchor="middle" transform="rotate(-90 322 90)">Refunded</text></svg>';
const CHAIN_HASH = 'MyfUe+oYqBPlTeqNQd/kmD8doc8ZUQgz9GMxpHL4A88=';
const CHAIN_DESCRIPTION =
  'Ticket 1 of 5 for Dollar night at Teatro Municipal. 10 tUSD was refunded to the holder.';
const TUSD_V2 = 'tusd.ticket-escrow-v2.testnet';

const svgMedia = (svg: string) => `${SVG_MEDIA_PREFIX}${Buffer.from(svg).toString('base64')}`;

/** The nft_token answer as the RPC returned it. */
function chainAnswer(metadata: Record<string, unknown> = {}) {
  return {
    token_id: '3-1',
    owner_id: 'te-d1-luis.testnet',
    metadata: {
      title: 'Dollar night - ticket 1',
      description: CHAIN_DESCRIPTION,
      media: svgMedia(CHAIN_SVG),
      media_hash: CHAIN_HASH,
      copies: null,
      issued_at: null,
      expires_at: null,
      starts_at: null,
      updated_at: null,
      extra: `{"event_id":3,"serial":1,"status":"Refunded","claim":"Refunded","outcome":"Refundable","principal":"10000000","currency":"${TUSD_V2}"}`,
      reference: null,
      reference_hash: null,
      ...metadata,
    },
    approved_account_ids: null,
  };
}

function readerAnswering(answer: unknown) {
  const asked: Array<Record<string, unknown>> = [];
  const rpc: ReaderRpc = {
    async callFunction(params) {
      asked.push({ ...params });
      return answer;
    },
    viewAccount: async () => {
      throw new Error('not used');
    },
    viewAccessKeyList: async () => {
      throw new Error('not used');
    },
  };
  return { reader: createReader({ contractId: 'te-d5-escrow.testnet', rpc }), asked };
}

const decode = (display: TicketDisplay) =>
  Buffer.from((display.media ?? '').slice(SVG_MEDIA_PREFIX.length), 'base64').toString('utf8');

describe('reader.ticketDisplay', () => {
  it('reads nft_token at final and parses a real answer, whose picture matches its hash', async () => {
    const { reader, asked } = readerAnswering(chainAnswer());
    const display = await reader.ticketDisplay?.('3-1');
    expect(asked).toEqual([
      {
        contractId: 'te-d5-escrow.testnet',
        method: 'nft_token',
        args: { token_id: '3-1' },
        blockQuery: { finality: 'final' },
      },
    ]);
    expect(display).toEqual({
      title: 'Dollar night - ticket 1',
      description: CHAIN_DESCRIPTION,
      media: svgMedia(CHAIN_SVG),
      mediaHash: CHAIN_HASH,
    });
    expect(Buffer.byteLength(CHAIN_SVG)).toBe(711);
    expect(display && mediaMatchesHash(display)).toBe(true);
  });

  it('reads a ticket that does not exist as null', async () => {
    const { reader } = readerAnswering(null);
    expect(await reader.ticketDisplay?.('9-9')).toBeNull();
  });

  it.each([
    ['a link', 'https://example.com/ticket.svg'],
    ['another image type', 'data:image/png;base64,iVBORw0KGgo='],
    ['an SVG that is not base64', 'data:image/svg+xml,<svg onload="alert(1)"/>'],
    ['a payload that is not base64', `${SVG_MEDIA_PREFIX}<svg/>`],
    ['not a string', 42],
  ])('drops %s as media, and keeps the words', async (_, media) => {
    const { reader } = readerAnswering(chainAnswer({ media }));
    const display = await reader.ticketDisplay?.('3-1');
    expect(display?.media).toBeNull();
    expect(display?.description).toBe(CHAIN_DESCRIPTION);
    expect(display && mediaMatchesHash(display)).toBe(false);
  });

  it('reads metadata without any of the fields as nulls', async () => {
    const { reader } = readerAnswering({ token_id: '3-1', owner_id: 'a.testnet' });
    expect(await reader.ticketDisplay?.('3-1')).toEqual({
      title: null,
      description: null,
      media: null,
      mediaHash: null,
    });
  });
});

describe('mediaMatchesHash', () => {
  const display = (media: string, mediaHash: string | null): TicketDisplay => ({
    title: null,
    description: null,
    media,
    mediaHash,
  });

  it('is false when the picture is not the one hashed', () => {
    expect(
      mediaMatchesHash(display(svgMedia(CHAIN_SVG.replace('10 tUSD', '99 tUSD')), CHAIN_HASH)),
    ).toBe(false);
    expect(mediaMatchesHash(display(svgMedia(CHAIN_SVG), null))).toBe(false);
    expect(mediaMatchesHash(display(svgMedia(CHAIN_SVG), CHAIN_HASH))).toBe(true);
  });
});

describe('ticketDisplayFor (demo mode draws as the contract does)', () => {
  it('draws the testnet ticket 3-1 byte for byte, with the same hash and sentence', () => {
    const event = {
      ...FIXTURES_WITH_TOKENS.events[0],
      title: 'Dollar night',
      venue: 'Teatro Municipal',
      capacity: 5,
    } as EventView;
    const ticket = {
      ...FIXTURES_WITH_TOKENS.tickets[0],
      serial: 1,
      principal: '10000000',
      claim: 'Refunded',
      currency: TUSD_V2,
    } as TicketView;
    expect(ticketDisplayFor(event, ticket, { symbol: 'tUSD', decimals: 6 })).toEqual({
      title: 'Dollar night - ticket 1',
      description: CHAIN_DESCRIPTION,
      media: svgMedia(CHAIN_SVG),
      mediaHash: CHAIN_HASH,
    });
  });

  const SENTENCES: Record<Claim, (amount: string) => string> = {
    Reserved: (a) => `${a} is reserved in the contract until the event is resolved.`,
    Refundable: (a) => `The event was not confirmed: whoever holds this ticket can claim ${a}.`,
    RefundPending: (a) => `A refund of ${a} is on its way to the holder.`,
    Refunded: (a) => `${a} was refunded to the holder.`,
    ReleasedToOrganizer: () => 'The event was confirmed and the price went to the organizer.',
  };

  it.each(Object.keys(SENTENCES) as Claim[])(
    'the fixture reader draws a %s ticket with its word and sentence, in NEAR and in tUSD',
    async (claim) => {
      const reader = createFixtureReader(FIXTURES_WITH_TOKENS);
      const tickets = FIXTURES_WITH_TOKENS.tickets.filter((t) => t.claim === claim);
      expect(tickets.length).toBeGreaterThan(0);
      for (const ticket of tickets) {
        const display = await reader.ticketDisplay?.(ticket.token_id);
        if (!display) throw new Error(`no display for ${ticket.token_id}`);
        const event = FIXTURES_WITH_TOKENS.events.find((e) => e.event_id === ticket.event_id);
        const unit = ticket.currency === null ? NEAR_UNIT : { symbol: 'tUSD', decimals: 6 };
        const amount = formatAmount(ticket.principal, unit);
        expect(display.title).toBe(`${event?.title} - ticket ${ticket.serial}`);
        expect(display.description).toBe(
          `Ticket ${ticket.serial} of ${event?.capacity} for ${event?.title} at ${event?.venue}. ${SENTENCES[claim](amount)}`,
        );
        const svg = decode(display);
        expect(svg).toContain(`>${CLAIM_LABELS[claim]}</text></svg>`);
        expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(2048);
        expect(mediaMatchesHash(display)).toBe(true);
      }
    },
  );

  it('answers null for a ticket that does not exist', async () => {
    expect(await createFixtureReader().ticketDisplay?.('99-1')).toBeNull();
  });
});

describe('drawTicket', () => {
  it('escapes markup, turns control characters into spaces and cuts a long title', () => {
    const svg = drawTicket(`"<&>' \u0001${'x'.repeat(30)}`, 2, '1.5 NEAR', 'Reserved');
    expect(svg).toContain(`>&quot;&lt;&amp;&gt;&apos;  ${'x'.repeat(18)}…</text>`);
    expect(svg).not.toContain('\u0001');
  });

  it('keeps a title of 26 characters whole', () => {
    expect(drawTicket('a'.repeat(26), 1, '1 NEAR', 'Reserved')).toContain(`>${'a'.repeat(26)}<`);
  });
});
