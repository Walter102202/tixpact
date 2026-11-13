import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  createFixtureReader,
  FIXTURE_TOKEN_ID,
  FIXTURES_WITH_TOKENS,
  type FixtureData,
  type Reader,
  TX_FIXTURES,
} from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { createFixtureWallet } from '../../lib/near/wallet';
import type { AppServices } from '../../services';
import { renderAt, testServices } from '../../test/render';

// Interface v2: events priced in the test dollar token (tUSD, 6 decimals). Event 10 is on sale at
// 10 tUSD, event 11 is open for refunds at 25 tUSD, event 12 is confirmed at 12.5 tUSD. Luis holds
// 40 tUSD, Ana 4, the organizer 0; Sofia is not registered with the token (fixtures.ts).

const TUSD = FIXTURE_TOKEN_ID;
const ESCROW = 'ticket-escrow.testnet';
const REGISTRATION_DEPOSIT = '1250000000000000000000';

function data(): FixtureData {
  return structuredClone(FIXTURES_WITH_TOKENS);
}

function services(as: string | null = 'luis.testnet', overrides: Partial<AppServices> = {}) {
  return testServices({
    reader: createFixtureReader(FIXTURES_WITH_TOKENS),
    wallet: createFixtureWallet(as),
    ...overrides,
  });
}

/** The value next to a label in a facts list. */
function fact(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
}

async function openEvent(id: number, s = services()) {
  renderAt(`/events/${id}`, s);
  await screen.findByRole('region', { name: 'Buy a ticket' });
  return s;
}

async function openTicket(id: string, s = services()) {
  renderAt(`/tickets/${id}`, s);
  await screen.findByRole('heading', { level: 1, name: `Ticket ${id}` });
  return s;
}

/** The disabled buy button's reason, read through its aria-describedby. */
function buyReason(name: string): string {
  const button = screen.getByRole('button', { name }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  const id = button.getAttribute('aria-describedby');
  return (id && document.getElementById(id)?.textContent) || '';
}

describe('an event priced in tUSD', () => {
  it('is listed with its price in tUSD', async () => {
    renderAt('/', services());
    const list = await screen.findByRole('list', { name: 'Events' });
    const row = within(list)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Indie showcase'));
    expect(row?.textContent).toContain('10 tUSD');
    const jazz = within(list)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Jazz night'));
    expect(jazz?.textContent).toContain('1.5 NEAR');
  });

  it('shows its price, what is reserved and which token it is paid in', async () => {
    await openEvent(10);
    expect(fact('Price')).toBe('10 tUSD');
    expect(fact('Reserved in the contract')).toBe('20 tUSD');
    expect(fact('Paid in')).toBe(`tUSD, the token ${TUSD}`);
  });

  it('names no token for an event priced in NEAR', async () => {
    await openEvent(1);
    expect(fact('Price')).toBe('1.5 NEAR');
    expect(screen.queryByText('Paid in', { selector: 'dt' })).toBeNull();
  });
});

describe('buying with tUSD', () => {
  it('shows the balance and sends exactly the price to the contract through the token', async () => {
    const s = await openEvent(10);
    expect(await screen.findByText('Your balance: 40 tUSD')).toBeTruthy();
    const note = screen.getByText(/Your wallet shows a call to the token/);
    expect(note.textContent).toContain(TUSD);
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 10 tUSD' }));
    expect(await screen.findByText('luis.testnet holds ticket 10-3.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open ticket 10-3' }).getAttribute('href')).toBe(
      '/tickets/10-3',
    );
    // Pinned to literals, not to actions.buyTicketWithToken, so a wrong builder cannot pass.
    expect(s.wallet.sent).toEqual([
      {
        methodName: 'ft_transfer_call',
        args: { receiver_id: ESCROW, amount: '10000000', memo: null, msg: '{"event_id":10}' },
        deposit: '1',
        gas: '100000000000000',
        receiverId: TUSD,
      },
    ]);
  });

  it('a purchase the contract refused says it did not happen and the money came back, with the reason', async () => {
    // The page read event 12 while it was on sale; by the time the purchase ran it had started.
    const stale = data();
    const event = stale.events.find((e) => e.event_id === 12);
    if (event) event.phase = 'OnSale';
    const wallet = createFixtureWallet('luis.testnet');
    wallet.answer = async () => ({
      txHash: TX_FIXTURES.tokenBuyRejected.hash,
      signerId: TX_FIXTURES.tokenBuyRejected.signerId,
    });
    await openEvent(12, services('luis.testnet', { wallet, reader: createFixtureReader(stale) }));
    await screen.findByText('Your balance: 40 tUSD');
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 12.5 tUSD' }));
    const title = await screen.findByText('The purchase did not happen.');
    const box = title.closest('[role="alert"]') as HTMLElement;
    expect(box.textContent).toContain('The contract refused it: It is too late for this action.');
    expect(box.textContent).toContain(
      'No ticket was bought. The token gave the 12.5 tUSD back to luis.testnet.',
    );
    // The transaction itself succeeded: the generic failed-step words would misname it.
    expect(box.textContent).not.toContain('Failed step');
    expect(screen.queryByText(/holds ticket/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open ticket/ })).toBeNull();
  });

  it('a transfer the token refused says nothing moved', async () => {
    // The page read Sofia as registered with money; the token did not know her.
    const stale = data();
    const ledger = stale.tokens[TUSD];
    if (ledger) ledger.balances['sofia.testnet'] = '40000000';
    const wallet = createFixtureWallet('sofia.testnet');
    wallet.answer = async () => ({
      txHash: TX_FIXTURES.tokenBuyUnfunded.hash,
      signerId: 'sofia.testnet',
    });
    await openEvent(10, services('sofia.testnet', { wallet, reader: createFixtureReader(stale) }));
    await screen.findByText('Your balance: 40 tUSD');
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 10 tUSD' }));
    const title = await screen.findByText('The purchase did not happen.');
    const box = title.closest('[role="alert"]') as HTMLElement;
    expect(box.textContent).toContain(`The token ${TUSD} refused the transfer.`);
    expect(box.textContent).toContain('The account sofia.testnet is not registered');
    expect(box.textContent).toContain('No tUSD left sofia.testnet, and no ticket was bought.');
    expect(box.textContent).not.toContain('gave the');
  });

  it('a short balance blocks the purchase, says why, and offers the test faucet', async () => {
    const s = await openEvent(10, services('ana.testnet'));
    expect(await screen.findByText('Your balance: 4 tUSD')).toBeTruthy();
    expect(buyReason('Buy for 10 tUSD')).toBe('Your balance is 4 tUSD; the price is 10 tUSD.');
    fireEvent.click(screen.getByRole('button', { name: 'Get 100 tUSD from the test faucet' }));
    expect(
      await screen.findByText(
        'Demo: nothing was sent. Live, the faucet sends 100 tUSD to ana.testnet.',
      ),
    ).toBeTruthy();
    expect(s.wallet.sent).toEqual([
      { methodName: 'faucet', args: {}, deposit: '0', gas: '30000000000000', receiverId: TUSD },
    ]);
  });

  it('a faucet result stays with the account it ran for', async () => {
    const s = await openEvent(10, services('ana.testnet'));
    await screen.findByText('Your balance: 4 tUSD');
    fireEvent.click(screen.getByRole('button', { name: 'Get 100 tUSD from the test faucet' }));
    await screen.findByText(
      'Demo: nothing was sent. Live, the faucet sends 100 tUSD to ana.testnet.',
    );
    // The demo selector switches to the organizer, who holds 0 tUSD.
    act(() => s.wallet.signInAs('org.testnet'));
    expect(await screen.findByText('Your balance: 0 tUSD')).toBeTruthy();
    expect(screen.queryByText(/the faucet sends/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Get 100 tUSD from the test faucet' })).toBeTruthy();
    expect(screen.getByText(/It sends 100 tUSD to org\.testnet\./)).toBeTruthy();
  });

  it('a registration result stays with the account it ran for', async () => {
    const s = await openEvent(10, services('sofia.testnet'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Register with tUSD for 0.00125 NEAR' }),
    );
    await screen.findByText(
      'Demo: nothing was registered. Live, sofia.testnet is then registered with tUSD.',
    );
    // teatro.testnet is not registered with tUSD either.
    act(() => s.wallet.signInAs('teatro.testnet'));
    expect(await screen.findByText(/teatro\.testnet is not registered with tUSD yet/)).toBeTruthy();
    expect(screen.queryByText(/Demo: nothing was registered/)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Register with tUSD for 0.00125 NEAR' }),
    ).toBeTruthy();
  });

  it('without a faucet, says where the money has to come from', async () => {
    await openEvent(10, services('ana.testnet', { faucets: [] }));
    expect(await screen.findByText('Your balance: 4 tUSD')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /test faucet/ })).toBeNull();
    expect(
      screen.getByText(`Send at least 10 tUSD to ana.testnet on the token ${TUSD}, then buy.`),
    ).toBeTruthy();
  });

  it('an account the token does not know is offered the one-step registration first', async () => {
    const s = await openEvent(10, services('sofia.testnet'));
    expect(await screen.findByText(/sofia\.testnet is not registered with tUSD yet/)).toBeTruthy();
    expect(buyReason('Buy for 10 tUSD')).toBe('Register with tUSD first.');
    expect(screen.queryByText(/Your balance/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Register with tUSD for 0.00125 NEAR' }));
    expect(
      await screen.findByText(
        'Demo: nothing was registered. Live, sofia.testnet is then registered with tUSD.',
      ),
    ).toBeTruthy();
    expect(s.wallet.sent).toEqual([
      {
        methodName: 'storage_deposit',
        args: { account_id: 'sofia.testnet', registration_only: true },
        deposit: REGISTRATION_DEPOSIT,
        gas: '30000000000000',
        receiverId: TUSD,
      },
    ]);
  });

  it('says when the balance cannot be read, and reads it again on request', async () => {
    let fail = true;
    const fixtures = createFixtureReader(FIXTURES_WITH_TOKENS);
    const reader: Reader = {
      ...fixtures,
      tokenBalance: (token, account) =>
        fail ? Promise.reject(new Error('down')) : fixtures.tokenBalance(token, account),
    };
    await openEvent(10, services('luis.testnet', { reader }));
    expect(await screen.findByText('Could not read your tUSD balance.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Buy for 10 tUSD' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Your balance: 40 tUSD')).toBeTruthy();
  });

  it('asks a signed-out visitor to sign in before reading any balance', async () => {
    await openEvent(10, services(null));
    expect(screen.getByRole('button', { name: 'Sign in to buy' })).toBeTruthy();
    expect(screen.queryByText(/balance/)).toBeNull();
  });

  it('reads the balance again after a purchase', async () => {
    let reads = 0;
    const fixtures = createFixtureReader(FIXTURES_WITH_TOKENS);
    const reader: Reader = {
      ...fixtures,
      tokenBalance: (token, account) => {
        reads += 1;
        return fixtures.tokenBalance(token, account);
      },
    };
    await openEvent(10, services('luis.testnet', { reader }));
    await screen.findByText('Your balance: 40 tUSD');
    const before = reads;
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 10 tUSD' }));
    await screen.findByText('luis.testnet holds ticket 10-3.');
    await waitFor(() => expect(reads).toBeGreaterThan(before));
  });
});

describe('holding a tUSD ticket', () => {
  it('lists it with its price in tUSD and its claim word', async () => {
    renderAt('/tickets', services());
    const list = await screen.findByRole('list', { name: 'Your tickets' });
    const row = (id: string) =>
      within(list)
        .getAllByRole('listitem')
        .find((li) => within(li).queryByRole('link', { name: `Ticket ${id}` }))?.textContent ?? '';
    expect(row('10-1')).toContain('10 tUSD');
    expect(row('11-1')).toContain('25 tUSD');
    expect(row('11-1')).toContain('Claimable');
    expect(row('1-3')).toContain('1.5 NEAR');
  });

  it('shows the price paid and where it is, in tUSD', async () => {
    await openTicket('10-1');
    expect(fact('Price paid')).toBe('10 tUSD');
    expect(fact('Reserved in the contract')).toBe('10 tUSD');
  });

  it('shows a tUSD refund in flight in tUSD', async () => {
    await openTicket('11-2');
    expect(screen.getByText(/A refund of 25 tUSD to luis\.testnet started on/)).toBeTruthy();
  });

  it('a registered holder claims the exact tUSD amount from the contract', async () => {
    const s = await openTicket('11-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Claim 25 tUSD to luis.testnet' }));
    expect(await screen.findByText('Refunded 25 tUSD to luis.testnet.')).toBeTruthy();
    // The claim goes to the escrow contract, which pays through the token.
    expect(s.wallet.sent).toEqual([
      {
        methodName: 'claim_refund',
        args: { token_id: '11-1' },
        deposit: '1',
        gas: '100000000000000',
      },
    ]);
  });

  it('a holder the token does not know is offered the registration before the claim', async () => {
    const s = await openTicket('11-4', services('sofia.testnet'));
    expect(
      await screen.findByText(
        /sofia\.testnet is not registered with tUSD, so the token cannot pay a refund to it yet/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Claim / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Register with tUSD for 0.00125 NEAR' }));
    await screen.findByText(/Demo: nothing was registered/);
    expect(s.wallet.sent).toEqual([
      {
        methodName: 'storage_deposit',
        args: { account_id: 'sofia.testnet', registration_only: true },
        deposit: REGISTRATION_DEPOSIT,
        gas: '30000000000000',
        receiverId: TUSD,
      },
    ]);
  });

  it('keeps the claim when the registration cannot be checked, and says what may happen', async () => {
    const reader: Reader = {
      ...createFixtureReader(FIXTURES_WITH_TOKENS),
      tokenRegistration: () => Promise.reject(new Error('down')),
    };
    await openTicket('11-1', services('luis.testnet', { reader }));
    expect(
      await screen.findByText(/Could not check that luis\.testnet is registered with tUSD/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claim 25 tUSD to luis.testnet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('checks no registration for a NEAR ticket', async () => {
    let asked = 0;
    const fixtures = createFixtureReader(FIXTURES_WITH_TOKENS);
    const reader: Reader = {
      ...fixtures,
      tokenRegistration: (token, account) => {
        asked += 1;
        return fixtures.tokenRegistration(token, account);
      },
    };
    await openTicket('8-1', services('luis.testnet', { reader }));
    expect(screen.getByRole('button', { name: 'Claim 1.5 NEAR to luis.testnet' })).toBeTruthy();
    expect(asked).toBe(0);
  });
});

describe('transferring a tUSD ticket', () => {
  function review(account: string) {
    fireEvent.change(screen.getByLabelText('Send to account'), { target: { value: account } });
    fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
  }

  it('warns when the receiver is not registered with the token, and offers to register it', async () => {
    const s = await openTicket('10-1');
    review('sofia.testnet');
    const confirm = await screen.findByRole('region', { name: 'Confirm the transfer' });
    expect(confirm.textContent).toContain('claim 10 tUSD');
    expect(confirm.textContent).toContain('sofia.testnet is not registered with tUSD.');
    expect(confirm.textContent).toContain('a refund to it fails until it registers');
    // The transfer stays possible: holding the ticket needs no registration.
    expect(
      within(confirm).getByRole('button', { name: 'Transfer ticket 10-1 to sofia.testnet' }),
    ).toBeTruthy();
    fireEvent.click(
      within(confirm).getByRole('button', {
        name: 'Register sofia.testnet with tUSD for 0.00125 NEAR',
      }),
    );
    await screen.findByText(/Demo: nothing was registered/);
    expect(s.wallet.sent).toEqual([
      {
        methodName: 'storage_deposit',
        args: { account_id: 'sofia.testnet', registration_only: true },
        deposit: REGISTRATION_DEPOSIT,
        gas: '30000000000000',
        receiverId: TUSD,
      },
    ]);
  });

  it('a registration done for one receiver is not shown for the next one', async () => {
    await openTicket('10-1');
    review('sofia.testnet');
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Register sofia.testnet with tUSD for 0.00125 NEAR',
      }),
    );
    await screen.findByText(/Demo: nothing was registered/);
    // teatro.testnet is not registered with tUSD either.
    review('teatro.testnet');
    const confirm = await screen.findByRole('region', { name: 'Confirm the transfer' });
    await within(confirm).findByText(/teatro\.testnet is not registered with tUSD\./);
    expect(confirm.textContent).not.toContain('sofia.testnet');
    expect(screen.queryByText(/Demo: nothing was registered/)).toBeNull();
    expect(
      within(confirm).getByRole('button', {
        name: 'Register teatro.testnet with tUSD for 0.00125 NEAR',
      }),
    ).toBeTruthy();
  });

  it('says nothing about registration when the receiver is registered', async () => {
    await openTicket('10-1');
    review('ana.testnet');
    const confirm = await screen.findByRole('region', { name: 'Confirm the transfer' });
    expect(confirm.textContent).not.toContain('registered');
    expect(within(confirm).queryByRole('button', { name: /^Register / })).toBeNull();
  });

  it('says when the registration cannot be checked, and still offers the transfer', async () => {
    const reader: Reader = {
      ...createFixtureReader(FIXTURES_WITH_TOKENS),
      tokenRegistration: () => Promise.reject(new Error('down')),
    };
    await openTicket('10-1', services('luis.testnet', { reader }));
    review('ana.testnet');
    const confirm = await screen.findByRole('region', { name: 'Confirm the transfer' });
    expect(confirm.textContent).toContain(
      'Could not check whether ana.testnet is registered with tUSD.',
    );
    expect(
      within(confirm).getByRole('button', { name: 'Transfer ticket 10-1 to ana.testnet' }),
    ).toBeTruthy();
  });
});

describe('the verifier page of a tUSD event', () => {
  it('shows the exact price in tUSD and the token, which the terms hash covers', async () => {
    renderAt('/verify/10', services('teatro.testnet'));
    await screen.findByRole('heading', { level: 1, name: 'Indie showcase' });
    expect(fact('Price')).toBe('10 tUSD');
    expect(fact('Paid in')).toBe(`tUSD, the token ${TUSD}`);
  });
});
