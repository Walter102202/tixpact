import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { CLAIM_LABELS, PHASE_LABELS } from '@ticket-escrow/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt } from '../../test/render';
import { AgentTerminal } from './AgentTerminal';
import { Replay } from './Replay';

const CAPTIONS = [
  'Ana buys a ticket. 1.5 NEAR is reserved in the contract.',
  'Ana gives the ticket to Luis. The refund right goes with it.',
  'The organizer goes silent. The deadline passes with no confirmation.',
  'Anyone switches the event to refunds.',
  'Luis claims. 1.5 NEAR goes back to luis.testnet.',
];

/** The browser asks for reduced motion. */
function reduceMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the landing', () => {
  it('opens with the problem: one line above the headline', () => {
    renderAt('/');
    expect(
      screen.getByText(
        'When an event is cancelled, your refund depends on the seller still having your money.',
      ),
    ).toBeTruthy();
  });

  it('shows its headings in order', () => {
    renderAt('/');
    const headings = screen
      .getAllByRole('heading')
      .filter((h) => h.tagName === 'H1' || h.tagName === 'H2')
      .map((h) => h.textContent);
    expect(headings).toEqual([
      'Event tickets whose price stays reserved until the event happens.',
      'A refund is only a promise.',
      'How it works',
      'An agent can hold tickets too.',
      'Events',
    ]);
  });

  it('states the problem with three sourced figures, each linking to its source', () => {
    renderAt('/');
    const problem = screen.getByRole('region', { name: 'A refund is only a promise.' });
    expect(problem.textContent).toContain(
      'Today the ticket money goes to the seller the day you pay. If the event is cancelled and the money is gone, nobody can give it back.',
    );
    const facts = within(problem).getAllByRole('listitem');
    expect(facts.map((f) => f.querySelector('.fact-figure')?.textContent)).toEqual([
      '$9 million',
      '$300,664',
      '620',
    ]);
    const links = facts.map((f) => within(f).getByRole('link'));
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      [
        'Washington State Attorney General, 2021',
        'https://atg.wa.gov/news/news-releases/ag-ferguson-brown-paper-tickets-will-fully-refund-event-organizers-ticket-buyers',
      ],
      [
        'ABC News, 2026',
        'https://www.abc.net.au/news/2026-06-11/byron-bay-bluesfest-report-reveals-debt/106769938',
      ],
      [
        'SERNAC, Chile’s consumer agency, 2026',
        'https://sernac.cl/portal/604/w3-article-89234.html',
      ],
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noreferrer');
    }
  });

  it('shows every section when IntersectionObserver is missing', () => {
    expect(typeof IntersectionObserver).toBe('undefined');
    renderAt('/');
    expect(document.querySelectorAll('.reveal').length).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll('.reveal-wait')).toHaveLength(0);
  });

  it('reveals each section the first time it scrolls into view', () => {
    const observers: Array<{ fire: () => void }> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private node: Element | null = null;
        constructor(private readonly callback: IntersectionObserverCallback) {
          observers.push({
            fire: () =>
              this.node &&
              this.callback(
                [{ isIntersecting: true, target: this.node } as IntersectionObserverEntry],
                this as unknown as IntersectionObserver,
              ),
          });
        }
        observe(node: Element) {
          this.node = node;
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      },
    );
    renderAt('/');
    expect(document.querySelectorAll('.reveal-wait').length).toBeGreaterThanOrEqual(4);
    act(() => {
      for (const observer of observers) observer.fire();
    });
    expect(document.querySelectorAll('.reveal-wait')).toHaveLength(0);
  });

  it('nothing waits to be revealed under reduced motion', () => {
    reduceMotion();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      },
    );
    renderAt('/');
    expect(document.querySelectorAll('.reveal-wait')).toHaveLength(0);
  });

  it('keeps the events list with price, verifier and status', async () => {
    renderAt('/');
    const list = await screen.findByRole('list', { name: 'Events' });
    const jazz = within(list)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Jazz night'));
    expect(jazz?.textContent).toContain('1.5 NEAR');
    expect(jazz?.textContent).toContain('teatro.testnet');
    expect(jazz?.textContent).toContain(PHASE_LABELS.OnSale);
  });
});

describe('the replay', () => {
  const stub = () =>
    screen.getByRole('figure', { name: 'Watch a ticket when the organizer disappears' });

  it('sits in a window whose address reads the ticket page, with Replay in its bar', () => {
    render(<Replay />);
    const chrome = stub().querySelector('.window-chrome') as HTMLElement;
    expect(chrome.textContent).toContain('/tickets/1-4');
    expect(within(chrome).getByRole('button', { name: 'Replay' })).toBeTruthy();
  });

  it('says it is a replay with demo data and links to the proof', () => {
    render(<Replay />);
    expect(stub().textContent).toContain(
      'A replay with demo data. The real transactions are on the Proof page.',
    );
    expect(within(stub()).getByRole('link', { name: 'Proof page' }).getAttribute('href')).toBe(
      '/proof',
    );
  });

  it('under reduced motion shows the last state and all five captions', () => {
    reduceMotion();
    render(<Replay />);
    const figure = stub();
    expect(figure.querySelector('.replay-claim')?.textContent).toBe(CLAIM_LABELS.Refunded);
    expect(figure.querySelector('.replay-holder')?.textContent).toContain('luis.testnet');
    const captions = within(figure)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(captions).toEqual(CAPTIONS);
    expect(within(figure).queryByRole('button', { name: 'Replay' })).toBeNull();
  });

  it('plays the beats in order, and "Replay" starts again from the first', () => {
    vi.useFakeTimers();
    render(<Replay />);
    const figure = stub();
    const caption = () => figure.querySelector('.replay-caption')?.textContent;
    const pill = () => figure.querySelector('.replay-pill')?.textContent;
    const claim = () => figure.querySelector('.replay-claim')?.textContent;
    const holder = () => figure.querySelector('.replay-holder')?.textContent ?? '';

    expect(caption()).toBe(CAPTIONS[0]);
    expect(pill()).toBe(PHASE_LABELS.OnSale);
    expect(claim()).toBe(CLAIM_LABELS.Reserved);
    expect(holder()).toContain('ana.testnet');
    const replay = within(figure).getByRole('button', { name: 'Replay' }) as HTMLButtonElement;
    expect(replay.disabled).toBe(true);

    act(() => vi.advanceTimersByTime(1800));
    expect(caption()).toBe(CAPTIONS[1]);
    expect(holder()).toContain('luis.testnet');
    expect(claim()).toBe(CLAIM_LABELS.Reserved);

    act(() => vi.advanceTimersByTime(1800));
    expect(caption()).toBe(CAPTIONS[2]);
    expect(pill()).toBe(PHASE_LABELS.Expirable);

    act(() => vi.advanceTimersByTime(1800));
    expect(caption()).toBe(CAPTIONS[3]);
    expect(pill()).toBe(PHASE_LABELS.Refundable);

    act(() => vi.advanceTimersByTime(1800));
    expect(caption()).toBe(CAPTIONS[4]);
    expect(claim()).toBe(CLAIM_LABELS.Refunded);

    act(() => vi.advanceTimersByTime(1800));
    expect(replay.disabled).toBe(false);
    fireEvent.click(replay);
    expect(caption()).toBe(CAPTIONS[0]);
    expect(holder()).toContain('ana.testnet');
  });
});

describe('the agent terminal', () => {
  const PURCHASE =
    'https://testnet.nearblocks.io/txns/Dj5bhTYztQbZgUt7wCpeuDXPyTBQk1fxTb2jf5J64J3j';
  const EXPIRE = 'https://testnet.nearblocks.io/txns/3zYb7PV3KjR2ePTSUexqVAyHHFGoA9Siw8887EnS4BGg';
  const CLAIM = 'https://testnet.nearblocks.io/txns/23DM83YCghZv1Ad3aDhVxhXDjHm9KXjnCtBApDEMmY3e';
  const terminal = () => screen.getByRole('figure', { name: 'The agent on NEAR testnet' });
  const panel = () => within(terminal()).getByRole('tabpanel');
  const links = () =>
    within(panel())
      .queryAllByRole('link')
      .map((a) => a.getAttribute('href'));

  it('says the output is real, and links to the proof', () => {
    reduceMotion();
    render(<AgentTerminal />);
    expect(terminal().textContent).toContain('Real output on NEAR testnet, 2026-11-13.');
    expect(within(terminal()).getByRole('link', { name: 'Proof page' }).getAttribute('href')).toBe(
      '/proof',
    );
  });

  it('under reduced motion shows the purchase within the caps at once', () => {
    reduceMotion();
    render(<AgentTerminal />);
    const tabs = within(terminal()).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      '/within-caps',
      '/over-the-cap',
      '/refund-watcher',
    ]);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(panel().textContent).toContain('Bought ticket 2-1 for 0.5 NEAR.');
    expect(links()).toEqual([PURCHASE]);
  });

  it('the chips switch the run that is shown', () => {
    reduceMotion();
    render(<AgentTerminal />);
    fireEvent.click(within(terminal()).getByRole('tab', { name: '/over-the-cap' }));
    expect(panel().textContent).toContain(
      'Denied: Exposure would be 1 NEAR (0.5 NEAR in tickets held plus 0.5 NEAR for this one), above the cap of 0.5 NEAR. Nothing was signed.',
    );
    expect(links()).toEqual([]);
    fireEvent.click(within(terminal()).getByRole('tab', { name: '/refund-watcher' }));
    expect(panel().textContent).toContain('expire_event 2: succeeded');
    expect(panel().textContent).toContain('claim_refund 2-1: succeeded');
    expect(links()).toEqual([EXPIRE, CLAIM]);
  });

  it('the chips work with the arrow keys, and only the selected one is in the tab order', () => {
    reduceMotion();
    render(<AgentTerminal />);
    const tab = (name: string) => within(terminal()).getByRole('tab', { name });
    expect(tab('/within-caps').tabIndex).toBe(0);
    expect(tab('/over-the-cap').tabIndex).toBe(-1);
    fireEvent.keyDown(tab('/within-caps'), { key: 'ArrowRight' });
    expect(tab('/over-the-cap').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('/over-the-cap'));
    fireEvent.keyDown(tab('/over-the-cap'), { key: 'ArrowLeft' });
    fireEvent.keyDown(tab('/within-caps'), { key: 'ArrowLeft' });
    expect(tab('/refund-watcher').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('/refund-watcher'), { key: 'Home' });
    expect(tab('/within-caps').getAttribute('aria-selected')).toBe('true');
  });

  it('with motion types the lines one by one', () => {
    vi.useFakeTimers();
    render(<AgentTerminal />);
    const lines = () => panel().querySelectorAll('.term-line').length;
    const first = lines();
    act(() => vi.advanceTimersByTime(700));
    expect(lines()).toBeGreaterThan(first);
    act(() => vi.advanceTimersByTime(20_000));
    expect(links()).toEqual([PURCHASE]);
  });

  it('shows the exposure cap as it stood in that run, in words as well as a bar', () => {
    render(<AgentTerminal />);
    const meter = screen.getByRole('figure', { name: 'Exposure cap' });
    expect(meter.textContent).toContain('0.5 NEAR of 5 NEAR in tickets');
    expect(meter.textContent).toContain('per-ticket cap 2 NEAR');
  });
});

describe('the header', () => {
  it('floats on the landing and is the plain one elsewhere', () => {
    const view = renderAt('/');
    expect(screen.getByRole('banner').classList.contains('site-header-floating')).toBe(true);
    view.unmount();
    renderAt('/proof');
    expect(screen.getByRole('banner').classList.contains('site-header-floating')).toBe(false);
  });
});

describe('the demo banner', () => {
  it('says the data is demo data, and leaves the variable to the README', () => {
    renderAt('/');
    const banner = screen.getByText(/^Demo data:/);
    expect(banner.textContent).toBe('Demo data: nothing on this page is on chain.');
  });
});
