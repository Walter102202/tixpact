import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  actions,
  createFixtureReader,
  createFixtureRpc,
  type EventTerms,
  FIXTURE_TOKEN_ID,
  FIXTURES,
  FIXTURES_WITH_TOKENS,
  type FixtureData,
  parseNear,
  type Reader,
  type RecordedTx,
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

/** Fills inputs by their label: the VALID fields, or "Price in <symbol>" for another currency. */
function fill(values: Partial<Record<Field | `Price in ${string}`, string>>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

/** VALID's times in the test zone, America/Santiago, which keeps UTC-3 in November. */
const VALID_TERMS: EventTerms = {
  title: VALID.Title,
  venue: VALID.Venue,
  starts_at_ms: Date.UTC(2026, 10, 20, 23, 0),
  ends_at_ms: Date.UTC(2026, 10, 21, 2, 0),
  resolution_deadline_ms: Date.UTC(2026, 10, 23, 2, 0),
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

/** What a create says in demo mode, where the recorded transaction creates nothing. */
const DEMO_CREATED = 'Demo: no event was created. Live, the new event opens from here.';

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
    expect(createButton().textContent).toBe(
      'Create the event at 1.5 NEAR a ticket and pay 0.7 NEAR of storage',
    );
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
    expect(await screen.findByText(DEMO_CREATED)).toBeTruthy();
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

  it('says when the storage budget cannot be read, and reads it again on request', async () => {
    let fails = true;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      quoteEventBudget: (capacity) =>
        fails ? Promise.reject(new Error('the RPC is down')) : fixtures.quoteEventBudget(capacity),
    };
    const services = await openOrganizer(
      testServices({ reader, wallet: createFixtureWallet(ORGANIZER) }),
    );
    fill(VALID);
    expect(await screen.findByText('Could not read the storage budget.')).toBeTruthy();
    const button = createButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toContain(
      'Could not read the storage budget.',
    );
    fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Storage budget: 0.7 NEAR')).toBeTruthy();
    expect((createButton() as HTMLButtonElement).disabled).toBe(false);
    expect(services.wallet.sent).toEqual([]);
  });

  it('waits for the budget before the button works, and says why', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      quoteEventBudget: async (capacity) => {
        await gate;
        return fixtures.quoteEventBudget(capacity);
      },
    };
    await openOrganizer(testServices({ reader, wallet: createFixtureWallet(ORGANIZER) }));
    fill(VALID);
    const button = createButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe(
      'Reading the storage budget…',
    );
    release();
    expect(await screen.findByText('Storage budget: 0.7 NEAR')).toBeTruthy();
    expect((createButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the budget quoted for the capacity now in the field', async () => {
    const services = await openOrganizer();
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    fill({ Capacity: '10' });
    expect(await screen.findByText('Storage budget: 0.18 NEAR')).toBeTruthy();
    expect(createButton().textContent).toBe(
      'Create the event at 1.5 NEAR a ticket and pay 0.18 NEAR of storage',
    );
    fireEvent.click(createButton());
    await screen.findByText(DEMO_CREATED);
    expect(services.wallet.sent).toEqual([
      actions.createEvent({ ...VALID_TERMS, capacity: 10 }, parseNear('0.18')),
    ]);
  });

  it('says in demo mode that no event was created, and links nowhere', async () => {
    await openOrganizer();
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    fireEvent.click(createButton());
    expect(await screen.findByText(DEMO_CREATED)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Open event/ })).toBeNull();
    expect(screen.queryByText(/\/verify\//)).toBeNull();
  });

  it('sends the terms with exactly the quoted budget and links the new event', async () => {
    const services = await openOrganizer(
      testServices({ fixtureMode: false, wallet: createFixtureWallet(ORGANIZER) }),
    );
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
    expect(await screen.findByText(DEMO_CREATED)).toBeTruthy();
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
    // The clicked button stays, so keyboard focus is not dropped while the box is open.
    expect(within(jazz).getByRole('button', { name: 'Cancel event' })).toBeTruthy();
    expect(services.wallet.sent).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, cancel the event' }));
    expect(
      await within(jazz).findByText('Cancelled. Every holder can now claim their price back.'),
    ).toBeTruthy();
    expect(services.wallet.sent).toEqual([actions.cancelEvent(1, null)]);
    expect(within(jazz).queryByRole('button', { name: 'Cancel event' })).toBeNull();
    // Demo data still says unresolved; the row follows the cancel that just succeeded.
    expect(jazz.textContent).toContain('Open for refunds: the organizer receives nothing.');
    expect(jazz.textContent).not.toContain('Nothing to collect until');
  });

  it.each([
    ['one millisecond before the deadline', -1, true],
    ['at the deadline', 0, false],
  ] as const)('%s, the row offers it: %s', async (_, offset, offered) => {
    const data = structuredClone(FIXTURES);
    const jazzEvent = data.events.find((e) => e.event_id === 1);
    if (jazzEvent) jazzEvent.now_ms = jazzEvent.resolution_deadline_ms + offset;
    await openOrganizer(
      testServices({ reader: createFixtureReader(data), wallet: createFixtureWallet(ORGANIZER) }),
    );
    const button = within(await row('Jazz night')).queryByRole('button', { name: 'Cancel event' });
    expect(button !== null).toBe(offered);
  });

  it('"Keep the event" closes the box and sends nothing', async () => {
    const services = await openOrganizer();
    const jazz = await row('Jazz night');
    fireEvent.click(within(jazz).getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(within(jazz).getByRole('button', { name: 'Keep the event' }));
    expect(within(jazz).queryByRole('region', { name: 'Confirm the cancellation' })).toBeNull();
    expect(document.activeElement).toBe(within(jazz).getByRole('button', { name: 'Cancel event' }));
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

  /** Collects event 7's 4.5 NEAR with a wallet that lends `recorded`'s hash. */
  async function collectWith(recorded: RecordedTx) {
    const wallet = createFixtureWallet(ORGANIZER);
    wallet.answer = async () => ({ txHash: recorded.hash, signerId: ORGANIZER });
    await openOrganizer(testServices({ wallet }));
    fireEvent.click(await screen.findByRole('button', { name: 'Collect 4.5 NEAR to org.testnet' }));
    const title = await screen.findByText('The payout did not complete.');
    return title.closest('[role="alert"]') as HTMLElement;
  }

  it('never says "Sent" when the transfer to the organizer failed, and offers it again', async () => {
    const box = await collectWith(TX_FIXTURES.payoutTransferFailed);
    expect(box.textContent).toContain('Failed step: the transfer to org.testnet.');
    expect(screen.queryByText(/^Sent /)).toBeNull();
    // The callback made the amount available again, and the re-read shows it.
    expect(screen.getByRole('button', { name: 'Collect 4.5 NEAR to org.testnet' })).toBeTruthy();
  });

  it('never says "Sent" when the confirmation failed, and says the payout stays pending', async () => {
    const box = await collectWith(TX_FIXTURES.payoutCallbackFailed);
    expect(box.textContent).toContain(
      "Failed step: the contract's confirmation after the transfer.",
    );
    expect(box.textContent).toContain(
      'The transfer to org.testnet ran, but the contract could not record it. The payout stays pending, so it cannot be paid twice.',
    );
    expect(screen.queryByText(/^Sent /)).toBeNull();
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
    // Unresolved, but nobody can confirm it any more.
    expect(item('Stand-up comedy')).toContain(
      'The deadline passed without a confirmation: the organizer receives nothing, and every holder can claim their price back.',
    );
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

describe('/organizer: events priced in a token', () => {
  const TUSD = FIXTURE_TOKEN_ID;
  const withTokens = (data: FixtureData = FIXTURES_WITH_TOKENS) =>
    testServices({ reader: createFixtureReader(data), wallet: createFixtureWallet(ORGANIZER) });

  it('picks the currency among those the contract accepts and takes the price in it', async () => {
    const services = await openOrganizer(withTokens());
    const picker = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      'NEAR',
      `tUSD (the token ${TUSD}, a test dollar with no value)`,
    ]);
    fireEvent.change(picker, { target: { value: TUSD } });
    const { 'Price in NEAR': _, ...rest } = VALID;
    fill({ ...rest, 'Price in tUSD': '12.5' });
    // The storage budget stays in NEAR whatever the currency.
    expect(await screen.findByText('Storage budget: 0.7 NEAR')).toBeTruthy();
    fireEvent.click(createButton());
    await screen.findByText(DEMO_CREATED);
    expect(services.wallet.sent).toEqual([
      {
        methodName: 'create_event',
        args: { terms: { ...VALID_TERMS, price: '12500000', currency: TUSD } },
        deposit: parseNear('0.7'),
        gas: '30000000000000',
      },
    ]);
  });

  it.each([
    ['1.00001', 'Use at most 4 decimals.'],
    ['1.0000001', 'Use at most 4 decimals.'],
    ['0', 'The price must be above 0 tUSD.'],
    ['ten', 'Enter a price in tUSD, like 1.5.'],
  ])('refuses the price %s in tUSD before anything is sent', async (price, message) => {
    const services = await openOrganizer(withTokens());
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: TUSD } });
    const { 'Price in NEAR': _, ...rest } = VALID;
    fill({ ...rest, 'Price in tUSD': price });
    await screen.findByText('Storage budget: 0.7 NEAR');
    fireEvent.click(createButton());
    expect(await screen.findByText(message)).toBeTruthy();
    expect(services.wallet.sent).toEqual([]);
  });

  it('names the price in its currency on the button, so a change of currency shows', async () => {
    await openOrganizer(withTokens());
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    expect(createButton().textContent).toBe(
      'Create the event at 1.5 NEAR a ticket and pay 0.7 NEAR of storage',
    );
    // The same "1.5", now in tUSD.
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: TUSD } });
    expect(createButton().textContent).toBe(
      'Create the event at 1.5 tUSD a ticket and pay 0.7 NEAR of storage',
    );
    // A price that is not valid names none.
    fill({ 'Price in tUSD': 'ten' });
    expect(createButton().textContent).toBe('Create the event and pay 0.7 NEAR of storage');
  });

  it('names a token without a test faucet by its symbol and account only', async () => {
    await openOrganizer(
      testServices({
        reader: createFixtureReader(FIXTURES_WITH_TOKENS),
        wallet: createFixtureWallet(ORGANIZER),
        faucets: [],
      }),
    );
    const picker = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect(picker.options[1]?.textContent).toBe(`tUSD (the token ${TUSD})`);
  });

  it('keeps NEAR as the default and sends the currency as null', async () => {
    const services = await openOrganizer(withTokens());
    fill(VALID);
    await screen.findByText('Storage budget: 0.7 NEAR');
    fireEvent.click(createButton());
    await screen.findByText(DEMO_CREATED);
    expect(services.wallet.sent[0]?.args).toEqual({ terms: { ...VALID_TERMS, currency: null } });
  });

  it('shows no currency picker when the contract accepts no token', async () => {
    const data = structuredClone(FIXTURES);
    data.config.tokens = [];
    await openOrganizer(withTokens(data));
    await screen.findByLabelText('Price in NEAR');
    expect(screen.queryByLabelText('Currency')).toBeNull();
  });

  it('offers to collect a confirmed tUSD event in tUSD, to an organizer the token knows', async () => {
    const services = await openOrganizer(withTokens());
    const button = await screen.findByRole('button', { name: 'Collect 25 tUSD to org.testnet' });
    expect(screen.getByRole('button', { name: 'Collect 4.5 NEAR to org.testnet' })).toBeTruthy();
    fireEvent.click(button);
    await screen.findByText('Sent 25 tUSD to org.testnet.');
    expect(services.wallet.sent).toEqual([actions.claimPayout(12)]);
  });

  it('offers the registration before a payout the token could not deliver', async () => {
    const data = structuredClone(FIXTURES_WITH_TOKENS);
    delete data.tokens[TUSD]?.balances[ORGANIZER];
    const services = await openOrganizer(withTokens(data));
    expect(
      await screen.findByText(
        /org\.testnet is not registered with tUSD, so the token cannot pay it/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collect 25 tUSD to org.testnet' })).toBeNull();
    // The NEAR payout needs no registration.
    expect(screen.getByRole('button', { name: 'Collect 4.5 NEAR to org.testnet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Register with tUSD for 0.00125 NEAR' }));
    await screen.findByText(/Demo: nothing was registered/);
    expect(services.wallet.sent).toEqual([
      actions.registerWithToken(TUSD, ORGANIZER, parseNear('0.00125')),
    ]);
  });

  it('a payout the token refused says nothing was paid, why, and offers the registration', async () => {
    // The page read org.testnet as registered; it unregistered from tUSD before collecting.
    let unregistered = false;
    const fixtures = createFixtureReader(FIXTURES_WITH_TOKENS);
    const reader: Reader = {
      ...fixtures,
      tokenRegistration: async (token, account) => {
        const found = await fixtures.tokenRegistration(token, account);
        return unregistered && account === ORGANIZER ? { ...found, registered: false } : found;
      },
    };
    const wallet = createFixtureWallet(ORGANIZER);
    wallet.answer = async () => ({
      txHash: TX_FIXTURES.tokenPayoutRefused.hash,
      signerId: TX_FIXTURES.tokenPayoutRefused.signerId,
    });
    await openOrganizer(testServices({ reader, wallet }));
    const collect = await screen.findByRole('button', { name: 'Collect 25 tUSD to org.testnet' });
    unregistered = true;
    fireEvent.click(collect);
    const title = await screen.findByText('The payout did not complete.');
    const box = title.closest('[role="alert"]') as HTMLElement;
    expect(box.textContent).toContain(
      'Nothing was paid and nothing was lost: tUSD could not pay org.testnet, which is not registered with it.',
    );
    expect(box.textContent).toContain(
      '25 tUSD is available to collect again. Register org.testnet with tUSD, then collect again.',
    );
    expect(box.textContent).not.toContain('Failed step');
    // The registration is read again: the one-step registration replaces the collect button.
    expect(
      await screen.findByRole('button', { name: 'Register with tUSD for 0.00125 NEAR' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collect 25 tUSD to org.testnet' })).toBeNull();
  });

  it('keeps the payout when the registration cannot be checked, and says what may happen', async () => {
    const reader: Reader = {
      ...createFixtureReader(FIXTURES_WITH_TOKENS),
      tokenRegistration: () => Promise.reject(new Error('down')),
    };
    await openOrganizer(testServices({ reader, wallet: createFixtureWallet(ORGANIZER) }));
    expect(
      await screen.findByText(/Could not check that org\.testnet is registered with tUSD/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collect 25 tUSD to org.testnet' })).toBeTruthy();
  });
});
