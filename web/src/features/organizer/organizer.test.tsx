import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  actions,
  createFixtureReader,
  createFixtureRpc,
  type EventTerms,
  FIXTURES,
  parseNear,
  type Reader,
  TX_FIXTURES,
  type TxStatusRpc,
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
      'the verifier is the contract',
      { 'Verifier account': 'ticket-escrow.testnet' },
      'Verifier account',
      'The verifier must be another account than the contract.',
    ],
    [
      'the verifier is not a testnet account',
      { 'Verifier account': 'teatro.testne' },
      'Verifier account',
      'Testnet accounts end in .testnet.',
    ],
    [
      'the price is 0',
      { 'Price in NEAR': '0' },
      'Price in NEAR',
      'The price must be above 0 NEAR.',
    ],
    [
      'the price has 5 decimals',
      { 'Price in NEAR': '1.00009' },
      'Price in NEAR',
      'Use at most 4 decimals.',
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

  it('says when the verifier account does not exist, and sends nothing', async () => {
    const services = await openOrganizer();
    fill({ ...VALID, 'Verifier account': 'teatro-typo.testnet' });
    expect(
      await screen.findByText('No account named teatro-typo.testnet exists on testnet.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Verifier account').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(createButton());
    expect(await screen.findByText(/nothing was sent/)).toBeTruthy();
    expect(services.wallet.sent).toEqual([]);
  });

  it('says when the verifier cannot be checked, sends nothing, and checks again on request', async () => {
    let fails = true;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      accountExists: (id) =>
        fails
          ? Promise.reject(new Error('every endpoint timed out'))
          : (fixtures.accountExists?.(id) ?? Promise.resolve(true)),
    };
    const services = await openOrganizer(
      testServices({ reader, wallet: createFixtureWallet(ORGANIZER) }),
    );
    fill(VALID);
    expect(await screen.findByText(/Could not check that teatro\.testnet exists/)).toBeTruthy();
    fireEvent.click(createButton());
    expect(services.wallet.sent).toEqual([]);
    fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Check the account again' }));
    await waitFor(() => expect(screen.queryByText(/Could not check that/)).toBeNull());
    fireEvent.click(createButton());
    expect(await screen.findByText('Event 9 created.')).toBeTruthy();
    expect(services.wallet.sent).toHaveLength(1);
  });

  it('keeps the button disabled while the verifier is being checked, and says why', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      accountExists: async (id) => {
        await gate;
        return (await fixtures.accountExists?.(id)) ?? true;
      },
    };
    await openOrganizer(testServices({ reader, wallet: createFixtureWallet(ORGANIZER) }));
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    const button = createButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe(
      'Checking that teatro.testnet exists on testnet…',
    );
    release();
    await waitFor(() => expect((createButton() as HTMLButtonElement).disabled).toBe(false));
  });

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

describe('/organizer: a create whose result is unknown', () => {
  /** A chain that does not answer until `up()`. */
  function silentChain() {
    let answering = false;
    const recorded = createFixtureRpc();
    const txRpc: TxStatusRpc = {
      viewTransactionStatusWithReceipts: (params) =>
        answering
          ? recorded.viewTransactionStatusWithReceipts(params)
          : Promise.reject(new Error('every endpoint timed out')),
    };
    return { txRpc, up: () => (answering = true) };
  }

  async function createUnconfirmed(services: ReturnType<typeof testServices>) {
    await openOrganizer(services);
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    fireEvent.click(createButton());
    const notice = await screen.findByText(/its result could not be read yet/);
    expect(screen.queryByRole('button', { name: /^Create the event/ })).toBeNull();
    return notice.closest('[role="alert"]') as HTMLElement;
  }

  it('asks the chain again first, and shows the result it now gives', async () => {
    const chain = silentChain();
    const services = testServices({ txRpc: chain.txRpc, wallet: createFixtureWallet(ORGANIZER) });
    const box = await createUnconfirmed(services);
    chain.up();
    fireEvent.click(within(box).getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Event 9 created\./)).toBeTruthy();
    // A second click would create a second event and spend a second budget.
    expect(screen.queryByRole('button', { name: /^Create the event/ })).toBeNull();
    expect(services.wallet.sent).toHaveLength(1);
  });

  it('when the chain still does not answer, brings the button back only after reading your events', async () => {
    let listFails = false;
    let lists = 0;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      listEvents: (from, limit) => {
        lists += 1;
        return listFails
          ? Promise.reject(new Error('the RPC is down'))
          : fixtures.listEvents(from, limit);
      },
    };
    const services = testServices({
      reader,
      txRpc: silentChain().txRpc,
      wallet: createFixtureWallet(ORGANIZER),
    });
    const box = await createUnconfirmed(services);

    listFails = true;
    fireEvent.click(within(box).getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/could not be read again/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Create the event/ })).toBeNull();

    listFails = false;
    const before = lists;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('button', { name: /^Create the event/ })).toBeTruthy();
    expect(lists).toBeGreaterThan(before);
    expect(services.wallet.sent).toHaveLength(1);
  });

  it('shows the new event in "Your events" after a create, from the re-read', async () => {
    const data = structuredClone(FIXTURES);
    const reader = createFixtureReader(data);
    const wallet = createFixtureWallet(ORGANIZER);
    wallet.answer = async () => {
      // The chain now holds event 9.
      const template = data.events.find((e) => e.event_id === 2);
      if (template) data.events.push({ ...template, event_id: 9, title: VALID.Title });
      return { txHash: TX_FIXTURES.eventCreated.hash, signerId: ORGANIZER };
    };
    await openOrganizer(testServices({ reader, wallet, fixtureMode: false }));
    const list = await screen.findByRole('list', { name: 'Your events' });
    expect(within(list).queryByText(VALID.Title)).toBeNull();
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    fireEvent.click(createButton());
    expect(await screen.findByText(/Event 9 created\./)).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'Your events' })).getByText(VALID.Title),
    ).toBeTruthy();
  });
});

describe('/organizer: cancel an event', () => {
  /** The row of the organizer's event with this title. */
  async function row(title: string): Promise<HTMLElement> {
    const list = await screen.findByRole('list', { name: 'Your events' });
    const item = within(list)
      .getAllByRole('listitem')
      .find((li) => li.querySelector('h3')?.textContent === title);
    if (!item) throw new Error(`no row for ${title}`);
    return item;
  }

  it('is offered only while the event is unresolved and before its deadline', async () => {
    await openOrganizer();
    const list = await screen.findByRole('list', { name: 'Your events' });
    const offered = within(list)
      .getAllByRole('listitem')
      .filter((li) => within(li).queryByRole('button', { name: 'Cancel event' }) !== null)
      .map((li) => li.querySelector('h3')?.textContent);
    expect(offered).toEqual([
      'Jazz night',
      'Poetry reading',
      'Chamber quartet',
      'Rock in the park',
      'Film premiere',
    ]);
  });

  it('asks once more and says what follows, then cancels', async () => {
    const services = await openOrganizer();
    const jazz = await row('Jazz night');
    fireEvent.click(within(jazz).getByRole('button', { name: 'Cancel event' }));
    const confirm = within(jazz).getByRole('region', { name: 'Confirm the cancellation' });
    expect(confirm.textContent).toContain(
      'Every holder can then claim their price back. This cannot be undone.',
    );
    expect(services.wallet.sent).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, cancel the event' }));
    expect(
      await within(jazz).findByText('Cancelled. Every holder can now claim their price back.'),
    ).toBeTruthy();
    expect(services.wallet.sent).toEqual([actions.cancelEvent(1, null)]);
    expect(within(jazz).queryByRole('button', { name: 'Cancel event' })).toBeNull();
  });

  it('"Keep the event" closes the box and sends nothing', async () => {
    const services = await openOrganizer();
    const jazz = await row('Jazz night');
    fireEvent.click(within(jazz).getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(within(jazz).getByRole('button', { name: 'Keep the event' }));
    expect(within(jazz).queryByRole('region', { name: 'Confirm the cancellation' })).toBeNull();
    expect(services.wallet.sent).toEqual([]);
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

  it('names the exact amount on the button and once sent', async () => {
    const data = structuredClone(FIXTURES);
    const row = data.accounting.find((a) => a.event_id === 7);
    if (row) row.organizer_available = '4500090000000000000000000';
    await openOrganizer(
      testServices({ reader: createFixtureReader(data), wallet: createFixtureWallet(ORGANIZER) }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Collect 4.50009 NEAR to org.testnet' }),
    );
    expect(await screen.findByText('Sent 4.50009 NEAR to org.testnet.')).toBeTruthy();
  });

  it('shows the exact amount on its way to the organizer', async () => {
    const data = structuredClone(FIXTURES);
    const row = data.accounting.find((a) => a.event_id === 7);
    if (row)
      Object.assign(row, {
        organizer_available: '0',
        organizer_pending: '4500090000000000000000000',
      });
    await openOrganizer(
      testServices({ reader: createFixtureReader(data), wallet: createFixtureWallet(ORGANIZER) }),
    );
    expect(await screen.findByText(/Sending 4\.50009 NEAR to org\.testnet/)).toBeTruthy();
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
