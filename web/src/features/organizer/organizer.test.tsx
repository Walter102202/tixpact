import { fireEvent, screen, within } from '@testing-library/react';
import {
  actions,
  createFixtureReader,
  type EventTerms,
  FIXTURES,
  parseNear,
  type Reader,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { createFixtureWallet } from '../../lib/near/wallet';
import { renderAt, testServices } from '../../test/render';

const ORGANIZER = 'org.testnet';

/** A valid form, in the strings the inputs hold. The fixture clock is 2026-11-14 09:53 UTC. */
const VALID = {
  Title: 'Tango evening',
  Venue: 'Centro Cultural GAM',
  Starts: '2026-11-20T20:00',
  Ends: '2026-11-20T23:00',
  'Confirmation deadline': '2026-11-22T23:00',
  'Price in NEAR': '1.5',
  Capacity: '50',
  'Verifier account': 'teatro.testnet',
};

type Field = keyof typeof VALID;

function fill(values: Partial<Record<Field, string>>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

const local = (value: string) => new Date(value).getTime();

const VALID_TERMS: EventTerms = {
  title: VALID.Title,
  venue: VALID.Venue,
  starts_at_ms: local(VALID.Starts),
  ends_at_ms: local(VALID.Ends),
  resolution_deadline_ms: local(VALID['Confirmation deadline']),
  price: parseNear('1.5'),
  capacity: 50,
  verifier_id: 'teatro.testnet',
};

async function openOrganizer(services = testServices({ wallet: createFixtureWallet(ORGANIZER) })) {
  renderAt('/organizer', services);
  await screen.findByRole('heading', { level: 1, name: 'Organize an event' });
  return services;
}

const createButton = () => screen.getByRole('button', { name: /^Create the event/ });

describe('/organizer: create an event', () => {
  it('asks to sign in first', async () => {
    renderAt('/organizer', testServices({ wallet: createFixtureWallet(null) }));
    expect(await screen.findByText('Sign in to create an event.')).toBeTruthy();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('shows the storage budget from the contract and the three sentences', async () => {
    const asked: number[] = [];
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      quoteEventBudget: (capacity) => {
        asked.push(capacity);
        return fixtures.quoteEventBudget(capacity);
      },
    };
    await openOrganizer(testServices({ reader, wallet: createFixtureWallet(ORGANIZER) }));
    fill(VALID);
    expect(await screen.findByText('Storage budget: 0.7 NEAR')).toBeTruthy();
    expect(asked).toContain(50);
    expect(screen.getByText(/You receive nothing before teatro\.testnet confirms/)).toBeTruthy();
    expect(
      screen.getByText(/If nobody confirms by the deadline, every ticket holder can claim/),
    ).toBeTruthy();
    expect(screen.getByText(/It is not ticket money/)).toBeTruthy();
    expect(createButton().textContent).toBe('Create the event and pay 0.7 NEAR to the contract');
  });

  it.each([
    [
      'the verifier is the organizer',
      { 'Verifier account': ORGANIZER },
      'Verifier account',
      'The verifier must be another account, not you.',
    ],
    [
      'the price is 0',
      { 'Price in NEAR': '0' },
      'Price in NEAR',
      'The price must be above 0 NEAR.',
    ],
    [
      'the capacity is 0',
      { Capacity: '0' },
      'Capacity',
      'Capacity must be a whole number from 1 to 100.',
    ],
    [
      'the capacity is 101',
      { Capacity: '101' },
      'Capacity',
      'Capacity must be a whole number from 1 to 100.',
    ],
    [
      'the start is in the past',
      { Starts: '2026-11-01T20:00' },
      'Starts',
      'The start must be in the future.',
    ],
    [
      'the title is 121 bytes',
      { Title: 'a'.repeat(121) },
      'Title',
      'The title is 121 bytes; the limit is 120.',
    ],
    [
      'the title is 61 two-byte letters',
      { Title: 'ñ'.repeat(61) },
      'Title',
      'The title is 122 bytes; the limit is 120.',
    ],
  ] as const)(
    'rejects the terms when %s, before anything is sent',
    async (_, change, field, message) => {
      const services = await openOrganizer();
      fill(VALID);
      await screen.findByText('Storage budget: 0.7 NEAR');
      fill(change);
      fireEvent.click(createButton());
      expect(await screen.findByText(message)).toBeTruthy();
      const input = screen.getByLabelText(field);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(services.wallet.sent).toEqual([]);
    },
  );

  it('sends the terms with exactly the quoted budget and links the new event', async () => {
    const services = await openOrganizer();
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    fireEvent.click(createButton());
    expect(await screen.findByText('Event 9 created.')).toBeTruthy();
    expect(services.wallet.sent).toEqual([actions.createEvent(VALID_TERMS, parseNear('0.7'))]);
    expect(screen.getByRole('link', { name: 'Open event 9' }).getAttribute('href')).toBe(
      '/events/9',
    );
    expect(screen.getByText(/\/verify\/9/)).toBeTruthy();
  });
});

describe('/organizer: your events and the payout', () => {
  it('offers "Collect 4.5 NEAR" only where organizer_available is above zero', async () => {
    const services = await openOrganizer();
    const list = await screen.findByRole('list', { name: 'Your events' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(FIXTURES.events.length);
    const collect = within(list).getAllByRole('button', { name: /^Collect / });
    expect(collect.map((b) => b.textContent)).toEqual(['Collect 4.5 NEAR to org.testnet']);
    fireEvent.click(collect[0] as HTMLElement);
    expect(await screen.findByText('Sent 4.5 NEAR to org.testnet.')).toBeTruthy();
    expect(services.wallet.sent).toEqual([actions.claimPayout(7)]);
  });

  it('says why there is nothing to collect yet, and when a payout is on its way', async () => {
    const data = structuredClone(FIXTURES);
    const row = data.accounting.find((a) => a.event_id === 7);
    if (row) Object.assign(row, { organizer_available: '0', organizer_pending: parseNear('4.5') });
    await openOrganizer(
      testServices({ reader: createFixtureReader(data), wallet: createFixtureWallet(ORGANIZER) }),
    );
    const list = await screen.findByRole('list', { name: 'Your events' });
    const item = (title: string) =>
      within(list)
        .getAllByRole('listitem')
        .find((li) => li.textContent?.includes(title))?.textContent ?? '';
    expect(item('Opera gala')).toContain('Sending 4.5 NEAR to org.testnet');
    expect(item('Jazz night')).toContain('Nothing to collect until teatro.testnet confirms');
    expect(item('Summer festival')).toContain('Open for refunds: the organizer receives nothing');
    expect(within(list).queryAllByRole('button', { name: /^Collect / })).toEqual([]);
  });

  it('says so when the account has created no events', async () => {
    await openOrganizer(testServices({ wallet: createFixtureWallet('luis.testnet') }));
    expect(await screen.findByText('luis.testnet has not created any events.')).toBeTruthy();
  });

  it('is in the main navigation', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Organize' }).getAttribute('href')).toBe(
      '/organizer',
    );
  });
});
