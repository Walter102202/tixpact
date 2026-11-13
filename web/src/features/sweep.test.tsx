import { fireEvent, render, screen, within } from '@testing-library/react';
import { createFixtureReader, type Reader } from '@ticket-escrow/client';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createFixtureWallet } from '../lib/near/wallet';
import { renderAt, testServices } from '../test/render';
import { ErrorBoundary } from '../ui/ErrorBoundary';

// The state sweep of Task W4: every route has a loading state, an error state that shows no
// stale data, and a way back; navigation moves focus; a render error does not blank the page.

const ROUTES = [
  ['/', 'luis.testnet'],
  ['/events/1', 'luis.testnet'],
  ['/tickets', 'luis.testnet'],
  ['/tickets/1-3', 'luis.testnet'],
  ['/organizer', 'org.testnet'],
  ['/verify/1', 'teatro.testnet'],
  ['/proof', 'luis.testnet'],
] as const;

/** A reader whose every method answers with `answer()`. */
function readerAnswering(answer: () => Promise<never>): Reader {
  const fixtures = createFixtureReader();
  const methods = Object.fromEntries(
    Object.entries(fixtures)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => [name, answer]),
  );
  return { ...fixtures, ...methods } as Reader;
}

describe('every route', () => {
  it.each(ROUTES)('%s shows a loading state while the chain is read', async (path, account) => {
    const reader = readerAnswering(() => new Promise<never>(() => {}));
    renderAt(path, testServices({ reader, wallet: createFixtureWallet(account) }));
    // A page may read two things at once (the organizer page: limits and events); each says so.
    const statuses = await screen.findAllByRole('status');
    for (const status of statuses) {
      expect(status.getAttribute('aria-busy')).toBe('true');
      expect(status.textContent).toMatch(/^Reading /);
    }
  });

  it.each(ROUTES)(
    '%s shows "Could not read the chain." and a retry when reads fail',
    async (path, account) => {
      const reader = readerAnswering(() => Promise.reject(new Error('down')));
      renderAt(path, testServices({ reader, wallet: createFixtureWallet(account) }));
      const alerts = await screen.findAllByText('Could not read the chain.');
      for (const alert of alerts) {
        const box = alert.closest('[role="alert"]');
        expect(box).toBeTruthy();
        expect(within(box as HTMLElement).getByRole('button', { name: 'Try again' })).toBeTruthy();
      }
    },
  );

  it('an unknown address says there is no such page and links home', () => {
    renderAt('/nope');
    expect(screen.getByText('There is no page at /nope.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the events' }).getAttribute('href')).toBe('/');
  });
});

describe('navigation', () => {
  it('moves focus to the page content after following a link', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Proof' }));
    await screen.findByText('Code hash', { selector: 'dt' });
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('leaves focus alone on the first load, even under strict mode', async () => {
    window.history.pushState(null, '', '/events/1');
    render(
      <StrictMode>
        <App services={testServices()} />
      </StrictMode>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Jazz night' });
    expect(document.activeElement).toBe(document.body);
  });

  it('offers a skip link to the content', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
      '#main',
    );
  });
});

function Broken(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('replaces a crashed page with a sentence and a reload button', () => {
    const original = console.error;
    console.error = () => {};
    try {
      render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      );
    } finally {
      console.error = original;
    }
    expect(screen.getByText('This page hit an error and stopped.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
  });
});
