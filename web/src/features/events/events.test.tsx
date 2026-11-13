import { fireEvent, screen, within } from '@testing-library/react';
import {
  createFixtureReader,
  createFixtureRpc,
  ERROR_MESSAGES,
  explorerTxUrl,
  FIXTURES,
  formatDateTime,
  PHASE_LABELS,
  PROMISE_TEXT,
  type Reader,
  TX_FIXTURES,
  type TxStatusRpc,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { createFixtureWallet } from '../../lib/near/wallet';
import { renderAt, TEST_TIME_ZONE, testServices } from '../../test/render';

function eventFixture(id: number) {
  const event = FIXTURES.events.find((e) => e.event_id === id);
  if (!event) throw new Error(`no fixture event ${id}`);
  return event;
}

/** The value next to a label in the event's facts list. */
function fact(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!value) throw new Error(`no value for ${label}`);
  return value.textContent ?? '';
}

async function openEvent(id: number, services = testServices()) {
  const view = renderAt(`/events/${id}`, services);
  await screen.findByRole('heading', { level: 1, name: eventFixture(id).title });
  return view;
}

describe('shell', () => {
  it('shows the network badge and the signed-in account', async () => {
    renderAt('/');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('testnet')).toBeTruthy();
    expect(within(banner).getByText('luis.testnet')).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('says plainly when the page runs on demo data', () => {
    renderAt('/');
    expect(screen.getByText(/Demo data: nothing on this page is on chain/)).toBeTruthy();
  });

  it('on demo data lets the viewer act as each demo account', () => {
    renderAt('/');
    const picker = screen.getByLabelText('Demo account') as HTMLSelectElement;
    expect([...picker.options].filter((o) => o.value !== '').map((o) => o.value)).toEqual([
      'luis.testnet',
      'ana.testnet',
      'org.testnet',
      'teatro.testnet',
    ]);
    fireEvent.change(picker, { target: { value: 'org.testnet' } });
    expect(within(screen.getByRole('banner')).getByText('org.testnet')).toBeTruthy();
  });

  it('shows no demo account picker on live data', () => {
    renderAt('/', testServices({ fixtureMode: false }));
    expect(screen.queryByLabelText('Demo account')).toBeNull();
  });
});

describe('/ lists the events', () => {
  it('with price, verifier and phase', async () => {
    renderAt('/');
    const list = await screen.findByRole('list', { name: 'Events' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(FIXTURES.events.length);
    for (const event of FIXTURES.events) {
      const item = items.find((li) => li.textContent?.includes(event.title));
      if (!item) throw new Error(`event ${event.title} is not listed`);
      expect(item.textContent).toContain(event.verifier_id);
      expect(item.textContent).toContain(PHASE_LABELS[event.phase]);
    }
    const jazz = items.find((li) => li.textContent?.includes('Jazz night'));
    expect(jazz?.textContent).toContain('1.5 NEAR');
    expect(within(list).getByRole('link', { name: 'Jazz night' }).getAttribute('href')).toBe(
      '/events/1',
    );
  });

  it('shows the error state when the chain cannot be read', async () => {
    const failing = {
      ...createFixtureReader(),
      listEvents: () => Promise.reject(new Error('down')),
    };
    renderAt('/', testServices({ reader: failing as Reader }));
    expect(await screen.findByText('Could not read the chain.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('/events/:id', () => {
  it('shows price, reserved amount, verifier, times in the viewer zone and the promise', async () => {
    await openEvent(1);
    const event = eventFixture(1);
    expect(fact('Price')).toBe('1.5 NEAR');
    expect(fact('Reserved in the contract')).toBe('6 NEAR');
    expect(fact('Tickets sold')).toBe('4 of 50');
    expect(fact('Verifier')).toContain('teatro.testnet');
    expect(fact('Starts')).toBe(formatDateTime(event.starts_at_ms, TEST_TIME_ZONE));
    expect(fact('Ends')).toBe(formatDateTime(event.ends_at_ms, TEST_TIME_ZONE));
    expect(fact('Confirmation deadline')).toBe(
      formatDateTime(event.resolution_deadline_ms, TEST_TIME_ZONE),
    );
    expect(fact('Starts')).toContain('GMT-3');
    expect(screen.getByText(PROMISE_TEXT)).toBeTruthy();
    expect(screen.queryByText(/Confirmed by/)).toBeNull();
  });

  it('says "Confirmed by" only after the verifier confirmed, and "Awaiting verifier" before', async () => {
    const completed = await openEvent(7);
    expect(screen.getByText('Confirmed by teatro.testnet')).toBeTruthy();
    expect(fact('Evidence')).toBe('https://teatro.example/reports/opera-gala');
    completed.unmount();
    await openEvent(2);
    expect(fact('Verifier')).toContain('Awaiting verifier');
  });

  it('shows the reference of a cancellation as its reason, as text', async () => {
    const reader = createFixtureReader({
      ...FIXTURES,
      events: FIXTURES.events.map((e) =>
        e.event_id === 8 ? { ...e, evidence_ref: 'https://example.org/storm-warning' } : e,
      ),
    });
    await openEvent(8, testServices({ reader }));
    expect(fact('Reason')).toBe('https://example.org/storm-warning');
    expect(screen.queryByRole('link', { name: 'https://example.org/storm-warning' })).toBeNull();
    expect(screen.getByText('Cancelled by org.testnet')).toBeTruthy();
  });

  it('offers "Buy for 1.5 NEAR" while on sale', async () => {
    await openEvent(1);
    const button = screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('disables the buy button outside OnSale and says why', async () => {
    for (const event of FIXTURES.events.filter((e) => e.phase !== 'OnSale')) {
      const view = await openEvent(event.event_id);
      const button = screen.getByRole('button', { name: /^Buy for / }) as HTMLButtonElement;
      expect(button.disabled, event.title).toBe(true);
      const reasonId = button.getAttribute('aria-describedby');
      const reason = reasonId ? document.getElementById(reasonId)?.textContent : '';
      expect(reason?.length, event.title).toBeGreaterThan(10);
      view.unmount();
    }
  });

  it('shows "There is no event" for an unknown id', async () => {
    renderAt('/events/99');
    expect(await screen.findByText('There is no event 99.')).toBeTruthy();
  });
});

describe('buying a ticket', () => {
  it('a rejected wallet popup leaves the page unchanged with a dismissible notice', async () => {
    const wallet = createFixtureWallet();
    wallet.answer = () => Promise.reject(new Error('User rejected the request'));
    await openEvent(1, testServices({ wallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('The wallet returned no transaction.');
    // A wallet can fail after broadcasting; a blind second click could pay twice.
    expect(notice.textContent).toContain(
      'If you did approve it, reload this page before trying again.',
    );
    expect(fact('Tickets sold')).toBe('4 of 50');
    const button = screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sends exactly the price, shows "Sending", then the new ticket', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recorded = createFixtureRpc();
    const txRpc: TxStatusRpc = {
      async viewTransactionStatusWithReceipts(params) {
        await gate;
        return recorded.viewTransactionStatusWithReceipts(params);
      },
    };
    const services = testServices({ txRpc });
    await openEvent(1, services);
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    expect(await screen.findByText('Sending')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buy for 1.5 NEAR' })).toBeNull();
    release();
    // The success line names the account that signed, captured at the click.
    expect(await screen.findByText('luis.testnet holds ticket 1-4.')).toBeTruthy();
    // Pinned to literals, not to actions.buyTicket, so a wrong builder cannot pass its own test.
    expect(services.wallet.sent).toEqual([
      {
        methodName: 'buy_ticket',
        args: { event_id: 1 },
        deposit: '1500000000000000000000000',
        gas: '50000000000000',
      },
    ]);
    expect(screen.getByRole('link', { name: 'Open ticket 1-4' }).getAttribute('href')).toBe(
      '/tickets/1-4',
    );
  });

  it('a failed purchase says the payment did not complete, with the step and the reason', async () => {
    const wallet = createFixtureWallet();
    wallet.answer = async () => ({
      txHash: TX_FIXTURES.buyRejected.hash,
      signerId: TX_FIXTURES.buyRejected.signerId,
    });
    await openEvent(1, testServices({ wallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    const failure = await screen.findByText('The payment did not complete.');
    const box = failure.closest('[role="alert"]');
    expect(box?.textContent).toContain(ERROR_MESSAGES.ERR_SOLD_OUT);
    expect(box?.textContent).toContain('Failed step: the contract call');
    expect(screen.queryByText(/holds ticket/)).toBeNull();
  });

  it('says the page has not caught up when the chain still shows the old numbers', async () => {
    await openEvent(1, testServices({ fixtureMode: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    expect(await screen.findByText('luis.testnet holds ticket 1-4.')).toBeTruthy();
    expect(screen.getByText(/has not caught up with the chain/)).toBeTruthy();
  });

  it('waits for the sale to show even though now_ms changes on every read', async () => {
    // Live views carry the chain clock: a whole-view comparison would call the first stale read new.
    let bought = false;
    let readsSinceBuy = 0;
    let clock = 0;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      getEvent: async (id) => {
        const event = await fixtures.getEvent(id);
        if (!event) return null;
        clock += 1;
        if (bought) readsSinceBuy += 1;
        const sold = bought && readsSinceBuy >= 3 ? event.sold + 1 : event.sold;
        return { ...event, now_ms: event.now_ms + clock, sold };
      },
    };
    const wallet = createFixtureWallet();
    wallet.answer = async () => {
      bought = true;
      return { txHash: TX_FIXTURES.buySucceeded.hash, signerId: 'luis.testnet' };
    };
    await openEvent(1, testServices({ fixtureMode: false, reader, wallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    expect(await screen.findByText('luis.testnet holds ticket 1-4.')).toBeTruthy();
    expect(fact('Tickets sold')).toBe('5 of 50');
    expect(screen.queryByText(/has not caught up with the chain/)).toBeNull();
  });

  it('keeps the buy button hidden while the result is unknown, until the page is read again', async () => {
    const txRpc: TxStatusRpc = {
      viewTransactionStatusWithReceipts: () =>
        Promise.reject(new Error('every endpoint timed out')),
    };
    const services = testServices({ fixtureMode: false, txRpc });
    await openEvent(1, services);
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    const notice = await screen.findByText(/its result could not be read yet/);
    const box = notice.closest('[role="alert"]') as HTMLElement;
    expect(screen.queryByRole('button', { name: 'Buy for 1.5 NEAR' })).toBeNull();
    expect(
      within(box)
        .getByRole('link', { name: 'View the transaction in the explorer' })
        .getAttribute('href'),
    ).toBe(explorerTxUrl(TX_FIXTURES.buySucceeded.hash));
    fireEvent.click(within(box).getByRole('button', { name: 'Read the page again' }));
    expect(await screen.findByRole('button', { name: 'Buy for 1.5 NEAR' })).toBeTruthy();
    expect(services.wallet.sent).toHaveLength(1);
  });

  it('shows the exact amount on the button, and the rounded one in the facts', async () => {
    const data = structuredClone(FIXTURES);
    const event = data.events.find((e) => e.event_id === 1);
    if (event) event.price = '1234560000000000000000000';
    await openEvent(1, testServices({ reader: createFixtureReader(data) }));
    expect(screen.getByRole('button', { name: 'Buy for 1.23456 NEAR' })).toBeTruthy();
    expect(fact('Price')).toBe('1.2345 NEAR');
  });

  it('moves focus to the transaction status when the clicked button goes away', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recorded = createFixtureRpc();
    const txRpc: TxStatusRpc = {
      async viewTransactionStatusWithReceipts(params) {
        await gate;
        return recorded.viewTransactionStatusWithReceipts(params);
      },
    };
    await openEvent(1, testServices({ txRpc }));
    const regions = screen.getAllByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    await screen.findByText('Sending');
    const region = document.activeElement as HTMLElement;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toContain('Sending');
    // The same region the page had before the click, not a new one per state.
    expect(regions).toContain(region);
    release();
    await screen.findByText('luis.testnet holds ticket 1-4.');
    expect(region.isConnected).toBe(true);
  });

  it('on demo data reads once and does not wait for a chain that is not there', async () => {
    let reads = 0;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      getEvent: (id) => {
        reads += 1;
        return fixtures.getEvent(id);
      },
    };
    await openEvent(1, testServices({ reader }));
    const before = reads;
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 1.5 NEAR' }));
    expect(await screen.findByText('luis.testnet holds ticket 1-4.')).toBeTruthy();
    expect(screen.queryByText(/has not caught up with the chain/)).toBeNull();
    expect(reads - before).toBe(1);
  });

  it('asks to sign in first, inside the click', async () => {
    const wallet = createFixtureWallet(null);
    await openEvent(1, testServices({ wallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to buy' }));
    expect(await screen.findByRole('button', { name: 'Buy for 1.5 NEAR' })).toBeTruthy();
    expect(wallet.getAccountId()).toBe('luis.testnet');
  });
});
