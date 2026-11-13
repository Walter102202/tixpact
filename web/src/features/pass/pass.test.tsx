import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  createFixtureReader,
  decodePass,
  demoPassKey,
  type EntryPass,
  encodePass,
  FIXTURE_CONTRACT_ID,
  FIXTURES,
  type FixtureData,
  nep413Hash,
  type PassChain,
  passMessage,
  passRequest,
  signPassWithKey,
} from '@ticket-escrow/client';
import { base64Encode } from 'near-api-js';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import {
  createFixtureWallet,
  type FixtureWallet,
  MessageSigningUnsupported,
} from '../../lib/near/wallet';
import { renderAt, testServices } from '../../test/render';
import { CANNOT_SIGN, ONLY_HOLDER } from './passFlow';

const LUIS = 'luis.testnet';
const ANA = 'ana.testnet';
/** 21:03 in the tests' zone (America/Santiago, UTC-3 in November). */
const NOW = Date.parse('2026-11-14T00:03:00.000Z');

beforeEach(() => {
  // Only the clock and the countdown's interval are fake: Testing Library keeps its real timers.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function servicesAs(accountId: string | null, overrides: Parameters<typeof testServices>[0] = {}) {
  return testServices({ wallet: createFixtureWallet(accountId), ...overrides });
}

/** A pass signed by `accountId`'s demo key, as the fixture wallet signs it. */
function demoPass(accountId = LUIS, ticket = '1-3', issuedAtMs = Date.now()): EntryPass {
  const request = passRequest({ contract: FIXTURE_CONTRACT_ID, ticket, issuedAtMs });
  return signPassWithKey(request, accountId, demoPassKey(accountId));
}

/** Fixture data in which ticket 1-3 now belongs to ana.testnet. */
function transferredToAna(): FixtureData {
  const data = structuredClone(FIXTURES);
  data.tickets = data.tickets.map((t) => (t.token_id === '1-3' ? { ...t, owner_id: ANA } : t));
  return data;
}

async function openTicket(id: string, services: ReturnType<typeof testServices>) {
  renderAt(`/tickets/${id}`, services);
  await screen.findByRole('heading', { level: 1, name: `Ticket ${id}` });
}

const verdict = () =>
  screen.findByText(
    /^(Demo: would |Demo: )?(admit|not admit|already admitted|Admit|Do not admit|Already admitted)$/,
    {
      selector: '.verdict-word',
    },
  );

/** Live mode (not demo data), signed out: how an attendant's phone opens the door page. */
const live = (overrides: Parameters<typeof testServices>[0] = {}) =>
  servicesAs(null, { fixtureMode: false, ...overrides });

const CHECKING_SITE = `Checking site: ${window.location.origin}. Open this page yourself, from your own bookmark: a link or code the holder shows you can lead to a copy of this site that admits anyone.`;

describe('the ticket page offers the entry pass', () => {
  it('to the signed-in holder of an active ticket', async () => {
    await openTicket('1-3', servicesAs(LUIS));
    const section = screen.getByRole('region', { name: 'Entry pass' });
    expect(within(section).getByRole('button', { name: 'Show entry pass' })).toBeTruthy();
  });

  it('and to nobody else', async () => {
    await openTicket('1-3', servicesAs(ANA));
    expect(screen.getByText(ONLY_HOLDER)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show entry pass' })).toBeNull();
    cleanup();
    await openTicket('1-3', servicesAs(null));
    expect(screen.getByText(ONLY_HOLDER)).toBeTruthy();
  });

  it('not for a refunded ticket, even to its holder', async () => {
    await openTicket('8-3', servicesAs(LUIS));
    expect(screen.getByText('This ticket was refunded, so it has no entry pass.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show entry pass' })).toBeNull();
  });

  it('signs with the wallet and opens the pass page with the pass in the fragment', async () => {
    const services = servicesAs(LUIS);
    await openTicket('1-3', services);
    fireEvent.click(screen.getByRole('button', { name: 'Show entry pass' }));
    await screen.findByRole('heading', { level: 1, name: 'Entry pass' });

    expect(services.wallet.messages).toHaveLength(1);
    expect(services.wallet.messages[0]).toMatchObject({
      message: passMessage({ contract: FIXTURE_CONTRACT_ID, ticket: '1-3', issuedAtMs: NOW }),
      recipient: FIXTURE_CONTRACT_ID,
    });
    expect(window.location.pathname).toBe('/tickets/1-3/pass');
    const pass = decodePass(window.location.hash);
    expect(pass).toMatchObject({ ticket: '1-3', account: LUIS, issuedAtMs: NOW });

    expect(
      screen.getByRole('img', { name: 'QR code of the entry pass for ticket 1-3' }),
    ).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('Admits for 5:00');
    const link = screen.getByRole('link', { name: 'Open the door check in a new tab' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('href')).toBe(
      `${window.location.origin}/door#p=${encodePass(pass as EntryPass)}`,
    );
  });

  it('a wallet that cannot sign messages gets a sentence, not an error', async () => {
    const services = servicesAs(LUIS);
    services.wallet.answerMessage = async () => {
      throw new MessageSigningUnsupported('Some wallet cannot sign messages.');
    };
    await openTicket('1-3', services);
    fireEvent.click(screen.getByRole('button', { name: 'Show entry pass' }));
    expect((await screen.findByRole('alert')).textContent).toBe(CANNOT_SIGN);
    expect(window.location.pathname).toBe('/tickets/1-3');
  });

  it('so does a wallet without message signing at all', async () => {
    const { signMessage: _absent, ...withoutMessages } = createFixtureWallet(LUIS);
    await openTicket('1-3', testServices({ wallet: withoutMessages as unknown as FixtureWallet }));
    fireEvent.click(screen.getByRole('button', { name: 'Show entry pass' }));
    expect((await screen.findByRole('alert')).textContent).toBe(CANNOT_SIGN);
  });

  it('refuses an answer signed by another account than the one signed in', async () => {
    const services = servicesAs(LUIS);
    services.wallet.answerMessage = async (request) => {
      const key = demoPassKey(ANA);
      return {
        accountId: ANA,
        publicKey: key.getPublicKey().toString(),
        signature: base64Encode(key.sign(nep413Hash(request)).signature),
      };
    };
    await openTicket('1-3', services);
    fireEvent.click(screen.getByRole('button', { name: 'Show entry pass' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The wallet signed as ana.testnet, but luis.testnet is signed in here. Sign the pass with luis.testnet.',
    );
  });

  it('refuses a signature that does not verify, before anyone reaches the door', async () => {
    const services = servicesAs(LUIS);
    const honest = services.wallet.answerMessage;
    services.wallet.answerMessage = async (request) => ({
      ...(await honest(request)),
      signature: base64Encode(new Uint8Array(64)),
    });
    await openTicket('1-3', services);
    fireEvent.click(screen.getByRole('button', { name: 'Show entry pass' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      "The wallet's answer is not a signature the door can check",
    );
  });

  it('a closed wallet popup leaves the page as it was, with a sentence', async () => {
    const services = servicesAs(LUIS);
    services.wallet.answerMessage = async () => {
      throw new Error('User rejected the request');
    };
    await openTicket('1-3', services);
    fireEvent.click(screen.getByRole('button', { name: 'Show entry pass' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The wallet did not sign the pass, so nothing is shown. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Show entry pass' })).toBeTruthy();
  });
});

describe('the pass page', () => {
  it('counts down, expires, and signs a new pass', async () => {
    const services = servicesAs(LUIS);
    const first = demoPass();
    renderAt(`/tickets/1-3/pass#p=${encodePass(first)}`, services);
    expect((await screen.findByRole('timer')).textContent).toBe('Admits for 5:00');

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('timer').textContent).toBe('Admits for 4:00');

    act(() => vi.advanceTimersByTime(4 * 60_000 + 1_000));
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
    expect(
      screen.getByText('This pass expired at 21:08. Sign a new one to show at the door.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign a new pass' }));
    expect((await screen.findByRole('timer')).textContent).toBe('Admits for 5:00');
    expect(services.wallet.messages).toHaveLength(1);
    const second = decodePass(window.location.hash);
    expect(second?.issuedAtMs).toBe(NOW + 5 * 60_000 + 1_000);
    expect(second?.nonce).not.toBe(first.nonce);
  });

  it('shows the pass to anyone with the link, but only the holder can sign a new one', async () => {
    renderAt(
      `/tickets/1-3/pass#p=${encodePass(demoPass(LUIS, '1-3', NOW - 6 * 60_000))}`,
      servicesAs(null),
    );
    await screen.findByText(/This pass expired at/);
    expect(screen.getByText(ONLY_HOLDER)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign a new pass' })).toBeNull();
  });

  it('says so when whoever signed the pass no longer holds the ticket', async () => {
    const reader = createFixtureReader(transferredToAna());
    renderAt(`/tickets/1-3/pass#p=${encodePass(demoPass())}`, servicesAs(LUIS, { reader }));
    expect(
      await screen.findByText(
        'luis.testnet signed this pass but no longer holds the ticket, so it will not admit. The holder is ana.testnet.',
      ),
    ).toBeTruthy();
  });

  it('shows no QR and says why once the ticket was refunded or a refund is in flight', async () => {
    for (const change of [{ status: 'Refunded' }, { status: 'RefundPending' }] as const) {
      const data = structuredClone(FIXTURES);
      data.tickets = data.tickets.map((t) => (t.token_id === '1-3' ? { ...t, ...change } : t));
      const reader = createFixtureReader(data);
      renderAt(`/tickets/1-3/pass#p=${encodePass(demoPass())}`, servicesAs(LUIS, { reader }));
      expect(
        await screen.findByText(/so it has no entry pass\. This pass will not admit\./),
      ).toBeTruthy();
      expect(screen.queryByRole('timer')).toBeNull();
      expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
      cleanup();
    }
  });

  it('ignores a pass for another ticket or another contract', async () => {
    const otherTicket = demoPass(LUIS, '1-4');
    const otherContract = signPassWithKey(
      passRequest({ contract: 'other.testnet', ticket: '1-3', issuedAtMs: NOW }),
      LUIS,
      demoPassKey(LUIS),
    );
    for (const pass of [otherTicket, otherContract]) {
      renderAt(`/tickets/1-3/pass#p=${encodePass(pass)}`, servicesAs(LUIS));
      expect(await screen.findByRole('button', { name: 'Show entry pass' })).toBeTruthy();
      expect(screen.queryByRole('timer')).toBeNull();
      cleanup();
    }
  });

  it('without a pass, offers the holder to sign one', async () => {
    renderAt('/tickets/1-3/pass', servicesAs(LUIS));
    fireEvent.click(await screen.findByRole('button', { name: 'Show entry pass' }));
    expect((await screen.findByRole('timer')).textContent).toBe('Admits for 5:00');
    expect(decodePass(window.location.hash)?.ticket).toBe('1-3');
  });
});

describe('the door', () => {
  it('admits a valid pass, and a second scan on this device reads "Already admitted"', async () => {
    const pass = demoPass();
    renderAt(`/door#p=${encodePass(pass)}`, live());
    expect((await verdict()).textContent).toBe('Admit');
    expect(screen.getByText('Ticket 1-3 · luis.testnet')).toBeTruthy();
    const checks = within(screen.getByRole('list', { name: 'The five checks' }));
    expect(checks.getAllByRole('listitem').map((li) => li.textContent?.slice(0, 2))).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
    ]);

    // Recorded with the verdict, not on a button.
    expect(
      screen.getByText(/This device now remembers ticket 1-3 as admitted at 21:03:00/),
    ).toBeTruthy();

    cleanup();
    act(() => vi.advanceTimersByTime(30_000));
    renderAt(`/door#p=${encodePass(pass)}`, live());
    expect((await verdict()).textContent).toBe('Do not admit');
    expect(screen.getByText('Already admitted on this device at 21:03:00.')).toBeTruthy();
  });

  it('a NEW pass for a ticket already admitted here reads "Do not admit"', async () => {
    renderAt(`/door#p=${encodePass(demoPass())}`, live());
    expect((await verdict()).textContent).toBe('Admit');
    cleanup();
    act(() => vi.advanceTimersByTime(70_000));
    const fresh = demoPass(LUIS, '1-3', Date.now());
    renderAt(`/door#p=${encodePass(fresh)}`, live());
    expect((await verdict()).textContent).toBe('Do not admit');
    expect(screen.getByText('Already admitted on this device at 21:03:00.')).toBeTruthy();
  });

  it('a chain that cannot be read reads "Do not admit"', async () => {
    const passChain: PassChain = {
      accessKey: async () => {
        throw new Error('rpc down');
      },
      ticket: async () => {
        throw new Error('rpc down');
      },
    };
    renderAt(`/door#p=${encodePass(demoPass())}`, live({ passChain }));
    expect((await verdict()).textContent).toBe('Do not admit');
    expect(window.localStorage.length).toBe(0);
  });

  it('starts a new check when the pass in an open door tab changes', async () => {
    renderAt(`/door#p=${encodePass(demoPass(LUIS, '1-3', NOW - 6 * 60_000))}`, live());
    expect((await verdict()).textContent).toBe('Do not admit');
    act(() => {
      window.location.hash = `p=${encodePass(demoPass())}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByText('Admit', { selector: '.verdict-word' })).toBeTruthy();
  });

  it('admits once under React StrictMode, which runs the check twice', async () => {
    window.history.pushState(null, '', `/door#p=${encodePass(demoPass())}`);
    render(
      <StrictMode>
        <App services={live()} />
      </StrictMode>,
    );
    expect((await verdict()).textContent).toBe('Admit');
  });

  it('keeps demo admissions apart from live ones', async () => {
    renderAt(`/door#p=${encodePass(demoPass())}`, servicesAs(null));
    expect((await verdict()).textContent).toBe('Demo: would admit');
    cleanup();
    renderAt(`/door#p=${encodePass(demoPass())}`, live());
    expect((await verdict()).textContent).toBe('Admit');
  });

  it('undoes a scan made by mistake', async () => {
    const pass = demoPass();
    renderAt(`/door#p=${encodePass(pass)}`, live());
    await verdict();
    fireEvent.click(screen.getByRole('button', { name: 'Undo: scanned by mistake' }));
    expect(
      screen.getByText('Undone: this device no longer remembers ticket 1-3 as admitted.'),
    ).toBeTruthy();
    cleanup();
    renderAt(`/door#p=${encodePass(pass)}`, live());
    expect((await verdict()).textContent).toBe('Admit');
  });

  it('does not admit a pass once the ticket was transferred after signing', async () => {
    const pass = demoPass();
    const reader = createFixtureReader(transferredToAna());
    renderAt(`/door#p=${encodePass(pass)}`, live({ reader }));
    expect((await verdict()).textContent).toBe('Do not admit');
    const sentence =
      'luis.testnet signed this pass but no longer holds ticket 1-3. The holder is ana.testnet.';
    expect(screen.getAllByText(sentence)).toHaveLength(2); // in the verdict and in the checks
  });

  it('does not admit an expired pass, and says why', async () => {
    renderAt(`/door#p=${encodePass(demoPass(LUIS, '1-3', NOW - 6 * 60_000))}`, live());
    expect((await verdict()).textContent).toBe('Do not admit');
    expect(
      screen.getAllByText(
        'This pass expired 1 min ago: a pass admits for 5 minutes after it is signed. Ask the holder to sign a new one.',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('reads the chain it is given: a function-call key does not admit', async () => {
    const reader = createFixtureReader();
    const passChain: PassChain = {
      accessKey: async () => 'function-call',
      ticket: (id) => reader.getTicket(id),
    };
    renderAt(`/door#p=${encodePass(demoPass())}`, live({ passChain }));
    expect((await verdict()).textContent).toBe('Do not admit');
  });

  it('without a pass, explains itself and checks a pasted link', async () => {
    renderAt('/door', live());
    expect(screen.getByRole('heading', { level: 1, name: 'Door check' })).toBeTruthy();
    const input = screen.getByLabelText('Pass or door link');
    fireEvent.change(input, { target: { value: 'not a pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check the pass' }));
    expect(
      screen.getByText('That is not an entry pass. Paste the whole link or pass.'),
    ).toBeTruthy();

    fireEvent.change(input, {
      target: { value: `https://tickets.example/door#p=${encodePass(demoPass())}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check the pass' }));
    expect((await verdict()).textContent).toBe('Admit');
  });

  it('says so when the link carries no readable pass', () => {
    renderAt('/door#p=garbage', live());
    expect(screen.getByRole('alert').textContent).toBe(
      'This link does not carry a readable entry pass. Ask the holder to show it again.',
    );
  });

  it('is marked as demo data in demo mode, like every page', () => {
    renderAt('/door', servicesAs(null));
    expect(screen.getByText('Demo data: nothing on this page is on chain.')).toBeTruthy();
    expect(screen.getByText(/It is checked against demo data, not the chain/)).toBeTruthy();
  });

  it('names the checking site and tells the attendant to open it from their own bookmark', async () => {
    renderAt('/door', live());
    expect(document.querySelector('.door-site')?.textContent).toBe(CHECKING_SITE);
    expect(document.body.textContent).not.toMatch(/camera/i);
    cleanup();
    renderAt(`/door#p=${encodePass(demoPass(LUIS, '1-3', NOW - 6 * 60_000))}`, live());
    await verdict();
    expect(screen.getByRole('status').querySelector('.door-site')?.textContent).toBe(CHECKING_SITE);
  });

  it('in demo mode never says a bare "Admit": the verdict reads as a demo result', async () => {
    renderAt(`/door#p=${encodePass(demoPass())}`, servicesAs(null));
    expect((await verdict()).textContent).toBe('Demo: would admit');
    const status = within(screen.getByRole('status'));
    expect(status.getByText('Demo data, not the chain: this result admits no one.')).toBeTruthy();
    expect(screen.getByRole('status').querySelector('.door-site')?.textContent).toBe(CHECKING_SITE);
    expect(screen.queryByText('Admit', { selector: '.verdict-word' })).toBeNull();
    cleanup();
    renderAt(`/door#p=${encodePass(demoPass(LUIS, '1-3', NOW - 6 * 60_000))}`, servicesAs(null));
    expect((await verdict()).textContent).toBe('Demo: would not admit');
  });

  it('still works when the browser refuses to store anything', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });
    renderAt(`/door#p=${encodePass(demoPass())}`, live());
    expect((await verdict()).textContent).toBe('Admit');
    expect(
      screen.getByText(
        'This browser would not store the admission, so a second scan here will not be flagged.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo: scanned by mistake' })).toBeNull();
  });
});
