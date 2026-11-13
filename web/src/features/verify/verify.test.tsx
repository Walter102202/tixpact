import { act, fireEvent, screen, within } from '@testing-library/react';
import { actions, createFixtureReader, FIXTURES, formatDateTime } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { createFixtureWallet } from '../../lib/near/wallet';
import { renderAt, TEST_TIME_ZONE, testServices } from '../../test/render';

const VERIFIER = 'teatro.testnet';
const ACTIONS = ['Accept', 'Confirm the event took place', 'Declare cancelled'] as const;
type Action = (typeof ACTIONS)[number];

function eventFixture(id: number) {
  const event = FIXTURES.events.find((e) => e.event_id === id);
  if (!event) throw new Error(`no fixture event ${id}`);
  return event;
}

async function openVerify(id: number, account: string | null = VERIFIER) {
  const services = testServices({ wallet: createFixtureWallet(account) });
  const view = renderAt(`/verify/${id}`, services);
  await screen.findByRole('heading', { level: 1, name: eventFixture(id).title });
  return { ...view, services };
}

function button(action: Action): HTMLButtonElement {
  return screen.getByRole('button', { name: action }) as HTMLButtonElement;
}

/** The reason shown under a disabled action, or null when it is enabled. */
function reason(action: Action): string | null {
  const target = button(action);
  if (!target.disabled) return null;
  const id = target.getAttribute('aria-describedby');
  return (id && document.getElementById(id)?.textContent) || '(no reason given)';
}

function enabled(): Action[] {
  return ACTIONS.filter((action) => !button(action).disabled);
}

describe('/verify/:id shows the terms', () => {
  it('with times in the viewer zone, the price, the capacity and the full terms hash', async () => {
    await openVerify(2);
    const event = eventFixture(2);
    const terms = screen.getByRole('region', { name: 'The terms' });
    expect(terms.textContent).toContain('0.5 NEAR');
    expect(terms.textContent).toContain('20 tickets');
    expect(terms.textContent).toContain('org.testnet');
    expect(terms.textContent).toContain(formatDateTime(event.starts_at_ms, TEST_TIME_ZONE));
    expect(terms.textContent).toContain(formatDateTime(event.ends_at_ms, TEST_TIME_ZONE));
    expect(terms.textContent).toContain(
      formatDateTime(event.resolution_deadline_ms, TEST_TIME_ZONE),
    );
    expect(within(terms).getByText(event.terms_hash)).toBeTruthy();
  });

  it('shows the exact price, even with more decimals than the form allows', async () => {
    const data = structuredClone(FIXTURES);
    const event = data.events.find((e) => e.event_id === 2);
    if (event) event.price = '1000090000000000000000000';
    renderAt(
      '/verify/2',
      testServices({ reader: createFixtureReader(data), wallet: createFixtureWallet(VERIFIER) }),
    );
    const terms = await screen.findByRole('region', { name: 'The terms' });
    expect(terms.textContent).toContain('1.00009 NEAR');
  });

  it('shows "There is no event" for an unknown id', async () => {
    renderAt('/verify/99');
    expect(await screen.findByText('There is no event 99.')).toBeTruthy();
  });

  it('is linked from the event page for the verifier only', async () => {
    const asVerifier = renderAt(
      '/events/2',
      testServices({ wallet: createFixtureWallet(VERIFIER) }),
    );
    const link = await screen.findByRole('link', { name: 'Open the verifier page' });
    expect(link.getAttribute('href')).toBe('/verify/2');
    asVerifier.unmount();
    renderAt('/events/2');
    await screen.findByRole('heading', { level: 1, name: eventFixture(2).title });
    expect(screen.queryByRole('link', { name: 'Open the verifier page' })).toBeNull();
  });
});

describe('/verify/:id enables each action only for the verifier and only in its window', () => {
  it('awaiting acceptance: Accept and Declare cancelled', async () => {
    await openVerify(2);
    expect(enabled()).toEqual(['Accept', 'Declare cancelled']);
    expect(reason('Confirm the event took place')).toBe('Accept the terms first.');
  });

  it('on sale: only Declare cancelled; confirming opens when the event ends', async () => {
    await openVerify(1);
    expect(enabled()).toEqual(['Declare cancelled']);
    expect(reason('Accept')).toBe('You accepted these terms.');
    expect(reason('Confirm the event took place')).toBe(
      `Opens when the event ends: ${formatDateTime(eventFixture(1).ends_at_ms, TEST_TIME_ZONE)}.`,
    );
  });

  it('after the end and before the deadline: Confirm and Declare cancelled', async () => {
    await openVerify(5);
    expect(enabled()).toEqual(['Confirm the event took place', 'Declare cancelled']);
  });

  it('past the deadline: nothing, and the reason says why', async () => {
    await openVerify(6);
    expect(enabled()).toEqual([]);
    expect(reason('Declare cancelled')).toBe(
      'The deadline passed: the event can only be expired, and every holder can claim.',
    );
    expect(reason('Confirm the event took place')).toBe(
      'The deadline passed: the event can only be expired, and every holder can claim.',
    );
  });

  it('resolved: nothing, and the outcome is named', async () => {
    await openVerify(7);
    expect(enabled()).toEqual([]);
    expect(reason('Declare cancelled')).toBe('The event is resolved: Confirmed by teatro.testnet.');
  });

  it('another account: nothing, with who can act', async () => {
    await openVerify(5, 'luis.testnet');
    expect(enabled()).toEqual([]);
    expect(reason('Accept')).toBe('Only teatro.testnet can accept or confirm this event.');
    expect(reason('Confirm the event took place')).toBe(
      'Only teatro.testnet can accept or confirm this event.',
    );
    expect(reason('Declare cancelled')).toBe(
      'Only teatro.testnet or the organizer, org.testnet, can cancel this event.',
    );
  });

  it('the organizer: nothing here, and where to cancel', async () => {
    await openVerify(5, 'org.testnet');
    expect(enabled()).toEqual([]);
    expect(reason('Accept')).toBe('Only teatro.testnet can accept or confirm this event.');
    expect(reason('Declare cancelled')).toBe(
      'As the organizer, you can cancel this event from the Organize page.',
    );
  });

  it('says who can do what', async () => {
    await openVerify(5);
    const lead = document.querySelector('.lead')?.textContent ?? '';
    expect(lead).toContain(
      'Only that account can accept the terms or confirm the event. It or the organizer, org.testnet, can declare it cancelled.',
    );
  });

  it('signed out: nothing, and a way to sign in', async () => {
    await openVerify(5, null);
    expect(enabled()).toEqual([]);
    expect(reason('Accept')).toBe('Sign in as teatro.testnet to act on this event.');
    expect(screen.getByRole('button', { name: 'Sign in as the verifier' })).toBeTruthy();
  });
});

describe('/verify/:id actions', () => {
  it('Accept echoes the terms hash', async () => {
    const { services } = await openVerify(2);
    fireEvent.click(button('Accept'));
    expect(
      await screen.findByText('You accepted the terms. Tickets can now be sold.'),
    ).toBeTruthy();
    expect(services.wallet.sent).toEqual([
      actions.acceptVerification(2, eventFixture(2).terms_hash),
    ]);
  });

  it('Declare cancelled asks once more, then sends the reason', async () => {
    const { services } = await openVerify(1);
    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: 'Storm warning' },
    });
    fireEvent.click(button('Declare cancelled'));
    expect(services.wallet.sent).toEqual([]);
    const confirm = screen.getByRole('region', { name: 'Confirm the cancellation' });
    expect(confirm.textContent).toContain('This cannot be undone.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, declare it cancelled' }));
    expect(
      await screen.findByText('Cancelled. Every holder can now claim their price back.'),
    ).toBeTruthy();
    expect(services.wallet.sent).toEqual([actions.cancelEvent(1, 'Storm warning')]);
  });

  it('Confirm the event took place asks once more, then sends no evidence when none is given', async () => {
    const { services } = await openVerify(5);
    fireEvent.click(button('Confirm the event took place'));
    const confirm = screen.getByRole('region', { name: 'Confirm the attestation' });
    expect(confirm.textContent).toContain('the organizer can collect');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, it took place' }));
    expect(
      await screen.findByText('Confirmed. The organizer can now collect the ticket money.'),
    ).toBeTruthy();
    expect(services.wallet.sent).toEqual([actions.attestCompleted(5, null)]);
  });

  it('sends the reason that was checked, shows it in the box, and locks the field meanwhile', async () => {
    const { services } = await openVerify(1);
    const field = () => screen.getByLabelText('Reason (optional)') as HTMLInputElement;
    fireEvent.change(field(), { target: { value: 'Storm warning' } });
    fireEvent.click(button('Declare cancelled'));
    const confirm = screen.getByRole('region', { name: 'Confirm the cancellation' });
    expect(confirm.textContent).toContain('Reason kept on chain: Storm warning');
    expect(field().disabled).toBe(true);
    // A paste after the check, over the contract's limit, must not be what is sent.
    fireEvent.change(field(), { target: { value: 'x'.repeat(300) } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, declare it cancelled' }));
    await screen.findByText('Cancelled. Every holder can now claim their price back.');
    expect(services.wallet.sent).toEqual([actions.cancelEvent(1, 'Storm warning')]);
  });

  it('says in the box when no evidence is kept', async () => {
    await openVerify(5);
    fireEvent.click(button('Confirm the event took place'));
    const confirm = screen.getByRole('region', { name: 'Confirm the attestation' });
    expect(confirm.textContent).toContain('No evidence is kept on chain.');
  });

  it('closes the box when the account changes, so another account cannot sign it', async () => {
    const { services } = await openVerify(1);
    fireEvent.click(button('Declare cancelled'));
    expect(screen.getByRole('region', { name: 'Confirm the cancellation' })).toBeTruthy();
    act(() => services.wallet.signInAs('org.testnet'));
    expect(screen.queryByRole('region', { name: 'Confirm the cancellation' })).toBeNull();
    act(() => services.wallet.signInAs(VERIFIER));
    expect(screen.queryByRole('region', { name: 'Confirm the cancellation' })).toBeNull();
    expect(services.wallet.sent).toEqual([]);
  });

  it('closes the box when another decision is sent', async () => {
    const { services } = await openVerify(2);
    fireEvent.click(button('Declare cancelled'));
    expect(screen.getByRole('region', { name: 'Confirm the cancellation' })).toBeTruthy();
    fireEvent.click(button('Accept'));
    await screen.findByText('You accepted the terms. Tickets can now be sold.');
    expect(screen.queryByRole('region', { name: 'Confirm the cancellation' })).toBeNull();
    expect(services.wallet.sent).toEqual([
      actions.acceptVerification(2, eventFixture(2).terms_hash),
    ]);
    // Accepting gives the event no outcome: it can still be cancelled.
    expect(enabled()).toEqual(['Declare cancelled']);
  });

  it('offers no other decision once the event has an outcome from this page', async () => {
    // Demo data never changes, and a live re-read can lag: neither may offer a second outcome.
    const { services } = await openVerify(5);
    fireEvent.click(button('Confirm the event took place'));
    const confirm = screen.getByRole('region', { name: 'Confirm the attestation' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, it took place' }));
    await screen.findByText('Confirmed. The organizer can now collect the ticket money.');
    expect(enabled()).toEqual([]);
    expect(reason('Declare cancelled')).toBe('Done: this event now has an outcome.');
    expect(services.wallet.sent).toHaveLength(1);
  });

  it('rejects a reference longer than the contract keeps, before anything is sent', async () => {
    const { services } = await openVerify(1);
    const max = FIXTURES.config.max_ref_bytes;
    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: 'x'.repeat(max + 1) },
    });
    fireEvent.click(button('Declare cancelled'));
    expect(screen.getByText(`The reason is ${max + 1} bytes; the limit is ${max}.`)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Confirm the cancellation' })).toBeNull();
    expect(services.wallet.sent).toEqual([]);
  });
});
