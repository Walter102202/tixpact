import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  actions,
  CLAIM_LABELS,
  createFixtureReader,
  createFixtureRpc,
  FIXTURES,
  type FixtureData,
  formatDateTime,
  type Reader,
  type RecordedTx,
  TX_FIXTURES,
  type TxStatusRpc,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { createFixtureWallet } from '../../lib/near/wallet';
import { renderAt, TEST_TIME_ZONE, testServices } from '../../test/render';

const LUIS = 'luis.testnet';

function eventTitle(id: number): string {
  return FIXTURES.events.find((e) => e.event_id === id)?.title ?? '';
}

/** The value next to a label in the ticket's facts list. */
function fact(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
}

async function openTicket(id: string, services = testServices()) {
  const view = renderAt(`/tickets/${id}`, services);
  await screen.findByRole('heading', { level: 1, name: `Ticket ${id}` });
  return view;
}

/** Fixture data the test can change, e.g. to play what the chain shows after a transaction. */
function mutableFixtures(): FixtureData {
  return structuredClone(FIXTURES);
}

/** A status RPC that holds every answer until `release()`. */
function gatedRpc() {
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
  return { txRpc, release: () => release() };
}

/** A status RPC that never answers: the result of a sent transaction stays unknown. */
const deadRpc: TxStatusRpc = {
  viewTransactionStatusWithReceipts: () => Promise.reject(new Error('every endpoint timed out')),
};

/**
 * A live-mode reader over `data` whose event views carry a chain clock that moves on every read,
 * and that shows the change `apply` makes only from the third ticket read after `start()`.
 */
function laggingReader(data: FixtureData, apply: (data: FixtureData) => void) {
  const pending = structuredClone(data);
  apply(pending);
  let started = false;
  let reads = 0;
  let clock = 0;
  const live = () => createFixtureReader(started && reads >= 3 ? pending : data);
  const reader: Reader = {
    ...createFixtureReader(data),
    getTicket: async (id) => {
      if (started) reads += 1;
      return live().getTicket(id);
    },
    getEvent: async (id) => {
      clock += 1;
      const event = await live().getEvent(id);
      return event && { ...event, now_ms: event.now_ms + clock };
    },
    getTicketHistory: (id) => live().getTicketHistory(id),
    getOperation: (id) => live().getOperation(id),
  };
  return {
    reader,
    start: () => {
      started = true;
    },
  };
}

describe('/tickets', () => {
  it('lists the tickets the account holds with holder, principal and claim word', async () => {
    renderAt('/tickets');
    const list = await screen.findByRole('list', { name: 'Your tickets' });
    const items = within(list).getAllByRole('listitem');
    const held = FIXTURES.tickets.filter((t) => t.owner_id === LUIS);
    expect(items).toHaveLength(held.length);
    const row = (id: string) => {
      const item = items.find((li) => within(li).queryByRole('link', { name: `Ticket ${id}` }));
      if (!item) throw new Error(`ticket ${id} is not listed`);
      return item.textContent ?? '';
    };
    for (const ticket of held) {
      expect(row(ticket.token_id)).toContain(LUIS);
      expect(row(ticket.token_id)).toContain(eventTitle(ticket.event_id));
    }
    expect(row('1-3')).toContain('1.5 NEAR');
    expect(row('1-3')).toContain(CLAIM_LABELS.Reserved);
    expect(row('8-1')).toContain(CLAIM_LABELS.Refundable);
    expect(row('8-2')).toContain(CLAIM_LABELS.RefundPending);
    expect(row('8-3')).toContain(CLAIM_LABELS.Refunded);
    expect(row('7-1')).toContain(CLAIM_LABELS.ReleasedToOrganizer);
    // Past the deadline without confirmation the holder can claim: same word as Refundable.
    expect(row('6-1')).toContain('Claimable');
    expect(within(list).getByRole('link', { name: 'Ticket 1-3' }).getAttribute('href')).toBe(
      '/tickets/1-3',
    );
  });

  it('reads every page when the contract returns fewer tickets than asked', async () => {
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      listTicketsForOwner: (account, from, limit) =>
        fixtures.listTicketsForOwner(account, from, Math.min(limit, 2)),
    };
    renderAt('/tickets', testServices({ reader }));
    const list = await screen.findByRole('list', { name: 'Your tickets' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(
      FIXTURES.tickets.filter((t) => t.owner_id === LUIS).length,
    );
  });

  it('asks to sign in when no account is connected', async () => {
    renderAt('/tickets', testServices({ wallet: createFixtureWallet(null) }));
    expect(await screen.findByText('Sign in to see the tickets you hold.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in to see your tickets' })).toBeTruthy();
  });

  it('says so when the account holds no tickets', async () => {
    renderAt('/tickets', testServices({ wallet: createFixtureWallet('nobody.testnet') }));
    expect(await screen.findByText('nobody.testnet holds no tickets.')).toBeTruthy();
  });

  it('shows the error state when the chain cannot be read', async () => {
    const reader: Reader = {
      ...createFixtureReader(),
      listTicketsForOwner: () => Promise.reject(new Error('down')),
    };
    renderAt('/tickets', testServices({ reader }));
    expect(await screen.findByText('Could not read the chain.')).toBeTruthy();
  });

  it('is in the main navigation', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My tickets' }).getAttribute('href')).toBe(
      '/tickets',
    );
  });
});

describe('/tickets/:id', () => {
  it('shows the holder, the reserved amount and the history list', async () => {
    await openTicket('1-3');
    expect(fact('Holder')).toBe(LUIS);
    expect(fact('Reserved in the contract')).toBe('1.5 NEAR');
    expect(fact('Event')).toBe('Jazz night');
    expect(screen.getByText(/NEAR NFT \(NEP-171\)/)).toBeTruthy();
    const history = screen.getByRole('list', { name: 'History' });
    const entries = within(history).getAllByRole('listitem');
    expect(entries.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Bought by ana.testnet'),
      expect.stringContaining('Transferred to luis.testnet'),
    ]);
    const bought = FIXTURES.histories['1-3']?.entries[0]?.at_ms ?? 0;
    expect(entries[0]?.textContent).toContain(formatDateTime(bought, TEST_TIME_ZONE));
  });

  it('says how many history entries the contract no longer keeps', async () => {
    await openTicket('3-2');
    const history = screen.getByRole('list', { name: 'History' });
    const entries = within(history).getAllByRole('listitem');
    expect(entries[0]?.textContent).toContain('Bought by luis.testnet');
    expect(entries[1]?.textContent).toContain('5 earlier entries are not kept by the contract');
    expect(entries).toHaveLength(FIXTURES.config.history_cap + 1);
  });

  it('shows "There is no ticket" for an unknown id', async () => {
    renderAt('/tickets/1-99');
    expect(await screen.findByText('There is no ticket 1-99.')).toBeTruthy();
  });

  it('shows the error state when the chain cannot be read', async () => {
    const reader: Reader = {
      ...createFixtureReader(),
      getTicket: () => Promise.reject(new Error('down')),
    };
    renderAt('/tickets/1-3', testServices({ reader }));
    expect(await screen.findByText('Could not read the chain.')).toBeTruthy();
  });
});

describe('transferring a ticket', () => {
  function review(account: string) {
    fireEvent.change(screen.getByLabelText('Send to account'), { target: { value: account } });
    fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
  }

  it('shows the full destination account and the loss of the refund right, then sends it', async () => {
    const data = mutableFixtures();
    const wallet = createFixtureWallet();
    wallet.answer = async () => {
      const ticket = data.tickets.find((t) => t.token_id === '1-3');
      if (ticket) ticket.owner_id = 'ana.testnet';
      return { txHash: TX_FIXTURES.transferSucceeded.hash, signerId: LUIS };
    };
    await openTicket('1-3', testServices({ wallet, reader: createFixtureReader(data) }));
    review('ana.testnet');
    const confirm = screen.getByRole('region', { name: 'Confirm the transfer' });
    expect(confirm.textContent).toContain('ana.testnet');
    expect(confirm.textContent).toContain('You will lose the right to the refund');
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Transfer ticket 1-3 to ana.testnet' }),
    );
    expect(await screen.findByText('Ticket 1-3 now belongs to ana.testnet.')).toBeTruthy();
    expect(wallet.sent).toEqual([actions.transferTicket('1-3', 'ana.testnet')]);
    expect(fact('Holder')).toBe('ana.testnet');
    expect(screen.queryByLabelText('Send to account')).toBeNull();
  });

  it('writes a long account out in full', async () => {
    const long = 'a-very-long-account-name-that-takes-the-refund-right.testnet';
    await openTicket('1-3');
    review(long);
    const confirm = screen.getByRole('region', { name: 'Confirm the transfer' });
    expect(within(confirm).getByText(long)).toBeTruthy();
  });

  it('rejects an invalid account and the current holder before anything is sent', async () => {
    const services = testServices();
    await openTicket('1-3', services);
    review('Ana.Testnet');
    expect(screen.getByText('That is not a valid NEAR account id.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Confirm the transfer' })).toBeNull();
    review(LUIS);
    expect(screen.getByText('That account already holds this ticket.')).toBeTruthy();
    expect(services.wallet.sent).toEqual([]);
  });

  it.each(['ana', 'ana.testne'])('refuses %s: not a testnet account', async (typo) => {
    const services = testServices();
    await openTicket('1-3', services);
    review(typo);
    expect(screen.getByText('Testnet accounts end in .testnet.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Confirm the transfer' })).toBeNull();
    expect(services.wallet.sent).toEqual([]);
  });

  it.each([
    ['a 64-hex implicit account', '9f'.repeat(32)],
    ['an 0x implicit account', `0x${'ab'.repeat(20)}`],
  ])('accepts %s', async (_, account) => {
    await openTicket('1-3');
    review(account);
    expect(screen.getByRole('region', { name: 'Confirm the transfer' }).textContent).toContain(
      account,
    );
  });

  it('waits for the new holder to show even though now_ms changes on every read', async () => {
    const { reader, start } = laggingReader(mutableFixtures(), (next) => {
      const ticket = next.tickets.find((t) => t.token_id === '1-3');
      if (ticket) ticket.owner_id = 'ana.testnet';
    });
    const wallet = createFixtureWallet();
    wallet.answer = async () => {
      start();
      return { txHash: TX_FIXTURES.transferSucceeded.hash, signerId: LUIS };
    };
    await openTicket('1-3', testServices({ fixtureMode: false, reader, wallet }));
    review('ana.testnet');
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ticket 1-3 to ana.testnet' }));
    expect(await screen.findByText('Ticket 1-3 now belongs to ana.testnet.')).toBeTruthy();
    expect(fact('Holder')).toBe('ana.testnet');
  });

  it('while the transfer is in flight shows no confirm box and no second button', async () => {
    const { txRpc, release } = gatedRpc();
    await openTicket('1-3', testServices({ txRpc }));
    review('ana.testnet');
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ticket 1-3 to ana.testnet' }));
    await screen.findByText('Sending');
    expect(screen.queryByRole('region', { name: 'Confirm the transfer' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Transfer ticket/ })).toBeNull();
    release();
    await screen.findByText(/now belongs to ana\.testnet/);
  });

  it('keeps the confirm box hidden while the result is unknown, until the page is read again', async () => {
    const services = testServices({ fixtureMode: false, txRpc: deadRpc });
    await openTicket('1-3', services);
    review('ana.testnet');
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ticket 1-3 to ana.testnet' }));
    const notice = await screen.findByText(/its result could not be read yet/);
    expect(screen.queryByRole('region', { name: 'Confirm the transfer' })).toBeNull();
    const input = () => screen.getByLabelText('Send to account') as HTMLInputElement;
    expect(input().disabled).toBe(true);
    const box = notice.closest('[role="alert"]') as HTMLElement;
    expect(
      within(box).getByRole('link', { name: 'View the transaction in the explorer' }),
    ).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(input().disabled).toBe(false));
    // The reviewed account was cleared when it was sent: a second transfer starts from review.
    expect(screen.queryByRole('region', { name: 'Confirm the transfer' })).toBeNull();
    expect(services.wallet.sent).toHaveLength(1);
  });

  it('is disabled after the event starts, with the reason', async () => {
    await openTicket('5-1');
    const button = screen.getByRole('button', { name: 'Review transfer' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe(
      'Transfers closed when the event started.',
    );
    expect((screen.getByLabelText('Send to account') as HTMLInputElement).disabled).toBe(true);
  });

  it('is not offered to someone who does not hold the ticket', async () => {
    await openTicket('1-3', testServices({ wallet: createFixtureWallet('ana.testnet') }));
    expect(screen.queryByLabelText('Send to account')).toBeNull();
    expect(
      screen.getByText('Only the holder, luis.testnet, can transfer or claim this ticket.'),
    ).toBeTruthy();
  });
});

describe('claiming a refund', () => {
  it('offers "Claim 1.5 NEAR to <account>" on a refundable ticket and confirms the payment', async () => {
    const data = mutableFixtures();
    const wallet = createFixtureWallet();
    wallet.answer = async () => {
      const ticket = data.tickets.find((t) => t.token_id === '8-1');
      if (ticket) Object.assign(ticket, { status: 'Refunded', claim: 'Refunded' });
      return { txHash: TX_FIXTURES.refundSettled.hash, signerId: LUIS };
    };
    await openTicket('8-1', testServices({ wallet, reader: createFixtureReader(data) }));
    expect(screen.getByText('Claimable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    expect(await screen.findByText('Refunded 1.5 NEAR to luis.testnet.')).toBeTruthy();
    expect(wallet.sent).toEqual([actions.claimRefund('8-1')]);
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
  });

  it('offers the claim once the deadline passed without confirmation, and says so', async () => {
    await openTicket('6-1');
    expect(screen.getByText('The deadline passed without confirmation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claim 1.2 NEAR to luis.testnet' })).toBeTruthy();
  });

  it('offers no claim while the event can still be confirmed', async () => {
    await openTicket('1-3');
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
    expect(screen.getByText(CLAIM_LABELS.Reserved, { selector: '.claim-word' })).toBeTruthy();
  });

  it('asks a signed-out holder to sign in first', async () => {
    await openTicket('8-1', testServices({ wallet: createFixtureWallet(null) }));
    expect(screen.getByRole('button', { name: 'Sign in to claim' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
  });

  it('Review Focus 1: a failed callback shows "The payment did not complete" with the step, never "Refunded"', async () => {
    const data = mutableFixtures();
    const wallet = createFixtureWallet();
    wallet.answer = async () => {
      // What the chain shows after t11: the transfer ran, the callback did not, the ticket stays locked.
      const ticket = data.tickets.find((t) => t.token_id === '8-1');
      if (ticket) {
        Object.assign(ticket, {
          status: 'RefundPending',
          claim: 'RefundPending',
          pending_operation_id: 8,
        });
      }
      return { txHash: TX_FIXTURES.refundCallbackFailed.hash, signerId: LUIS };
    };
    await openTicket('8-1', testServices({ wallet, reader: createFixtureReader(data) }));
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    const failure = await screen.findByText('The payment did not complete.');
    const box = failure.closest('[role="alert"]');
    expect(box?.textContent).toContain(
      "Failed step: the contract's confirmation after the transfer.",
    );
    expect(box?.textContent).toContain(
      'The transfer to luis.testnet ran, but the contract could not record it. The ticket stays locked.',
    );
    expect(screen.queryByText(/Refunded/)).toBeNull();
    expect(await screen.findByText('Sending', { selector: '.claim-word' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
  });

  it('treats a claim whose contract answered false as not paid', async () => {
    const settled = structuredClone(TX_FIXTURES.refundSettled);
    const FALSE = { SuccessValue: 'ZmFsc2U=' };
    settled.status.status = FALSE;
    const receipts = settled.status.receipts_outcome as Array<{ outcome: { status: unknown } }>;
    const callback = receipts[2];
    if (callback) callback.outcome.status = FALSE;
    const recorded: Record<string, RecordedTx> = { settled };
    const wallet = createFixtureWallet();
    wallet.answer = async () => ({ txHash: settled.hash, signerId: LUIS });
    await openTicket('8-1', testServices({ wallet, txRpc: createFixtureRpc(recorded) }));
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    expect(await screen.findByText('The payment did not complete.')).toBeTruthy();
    expect(screen.queryByText(/Refunded/)).toBeNull();
  });

  it('with RefundPending shows "Sending", where the money goes, and no second button', async () => {
    await openTicket('8-2');
    expect(screen.getByText('Sending', { selector: '.claim-word' })).toBeTruthy();
    expect(screen.getByText(/A refund of 1\.5 NEAR to luis\.testnet started/)).toBeTruthy();
    // No promise of a later confirmation: after a failed callback none comes (t11).
    expect(screen.queryByText(/once the transfer is confirmed/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
  });

  it('a claim whose transfer failed says the payment did not complete, with the transfer step', async () => {
    const tx = TX_FIXTURES.refundTransferFailed;
    const wallet = createFixtureWallet();
    wallet.answer = async () => ({ txHash: tx.hash, signerId: LUIS });
    await openTicket('8-1', testServices({ wallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    const failure = await screen.findByText('The payment did not complete.');
    const box = failure.closest('[role="alert"]');
    expect(box?.textContent).toContain('Failed step: the transfer to vanishing-holder.testnet.');
    expect(screen.queryByText(/Refunded/)).toBeNull();
  });

  it('says the contract could not be read again instead of claiming it was', async () => {
    let fail = false;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      getTicket: (id) => (fail ? Promise.reject(new Error('down')) : fixtures.getTicket(id)),
    };
    const wallet = createFixtureWallet();
    wallet.answer = async () => {
      fail = true;
      return { txHash: TX_FIXTURES.refundCallbackFailed.hash, signerId: LUIS };
    };
    await openTicket('8-1', testServices({ reader, wallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    const failure = await screen.findByText('The payment did not complete.');
    const box = failure.closest('[role="alert"]');
    expect(box?.textContent).toContain('The contract could not be read again; reload this page.');
    expect(box?.textContent).not.toContain('read again from the contract');
  });

  it('waits for the refund to show even though now_ms changes on every read', async () => {
    const { reader, start } = laggingReader(mutableFixtures(), (next) => {
      const ticket = next.tickets.find((t) => t.token_id === '8-1');
      if (ticket) Object.assign(ticket, { status: 'Refunded', claim: 'Refunded' });
    });
    const wallet = createFixtureWallet();
    wallet.answer = async () => {
      start();
      return { txHash: TX_FIXTURES.refundSettled.hash, signerId: LUIS };
    };
    await openTicket('8-1', testServices({ fixtureMode: false, reader, wallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    expect(await screen.findByText('Refunded 1.5 NEAR to luis.testnet.')).toBeTruthy();
    expect(screen.getByText('Refunded', { selector: '.claim-word' })).toBeTruthy();
  });

  it('while the claim is in flight shows no claim button', async () => {
    const { txRpc, release } = gatedRpc();
    await openTicket('8-1', testServices({ txRpc }));
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    await screen.findByText('Sending', { selector: 'strong' });
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
    release();
    await screen.findByText('Refunded 1.5 NEAR to luis.testnet.');
  });

  it('keeps the claim hidden while the result is unknown, until the page is read again', async () => {
    const services = testServices({ fixtureMode: false, txRpc: deadRpc });
    await openTicket('8-1', services);
    fireEvent.click(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }));
    const notice = await screen.findByText(/its result could not be read yet/);
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
    const box = notice.closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Check again' }));
    expect(
      await screen.findByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' }),
    ).toBeTruthy();
    expect(services.wallet.sent).toHaveLength(1);
  });

  it('shows a claimable ticket to someone else without a claim button', async () => {
    await openTicket('8-1', testServices({ wallet: createFixtureWallet('ana.testnet') }));
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in to claim' })).toBeNull();
    expect(
      screen.getByText('Only the holder, luis.testnet, can transfer or claim this ticket.'),
    ).toBeTruthy();
  });

  it('reads "Reserved", not "Claimable", for a refundable ticket locked by a transfer', async () => {
    const data = mutableFixtures();
    const ticket = data.tickets.find((t) => t.token_id === '8-1');
    if (ticket) ticket.status = 'TransferPending';
    await openTicket('8-1', testServices({ reader: createFixtureReader(data) }));
    expect(screen.getByText('Reserved', { selector: '.claim-word' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
  });

  it('shows the exact amount on the claim button', async () => {
    const data = mutableFixtures();
    const ticket = data.tickets.find((t) => t.token_id === '8-1');
    if (ticket) ticket.principal = '1234560000000000000000000';
    await openTicket('8-1', testServices({ reader: createFixtureReader(data) }));
    expect(screen.getByRole('button', { name: 'Claim 1.23456 NEAR to luis.testnet' })).toBeTruthy();
  });

  it('says a released ticket was released, not that the organizer was paid', async () => {
    await openTicket('7-1');
    expect(fact('Released to the organizer')).toBe('1.5 NEAR');
    expect(screen.queryByText(/Paid to the organizer/)).toBeNull();
  });

  it('says a refunded ticket was refunded and offers nothing', async () => {
    await openTicket('8-3');
    expect(screen.getByText('Refunded', { selector: '.claim-word' })).toBeTruthy();
    expect(fact('Refunded')).toBe('1.5 NEAR');
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
    expect(screen.queryByLabelText('Send to account')).toBeNull();
  });
});
