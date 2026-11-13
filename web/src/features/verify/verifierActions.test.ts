import { type EventView, FIXTURES } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { verifierBlockers } from './verifierActions';

const VERIFIER = 'teatro.testnet';
const ORGANIZER = 'org.testnet';
const STARTS = 1_800_000_000_000;
const ENDS = STARTS + 3 * 3_600_000;
const DEADLINE = ENDS + 2 * 86_400_000;
const DEADLINE_PASSED =
  'The deadline passed: the event can only be expired, and every holder can claim.';

/** An unresolved event with fixed times, read at chain time `now`. */
function at(now: number, accepted = true): EventView {
  const template = FIXTURES.events.find((e) => e.event_id === 1);
  if (!template) throw new Error('no fixture event 1');
  return {
    ...template,
    organizer_id: ORGANIZER,
    verifier_id: VERIFIER,
    verifier_accepted: accepted,
    outcome: 'Unresolved',
    starts_at_ms: STARTS,
    ends_at_ms: ENDS,
    resolution_deadline_ms: DEADLINE,
    now_ms: now,
  };
}

const time = (ms: number) => `t${ms}`;
const forVerifier = (event: EventView) => verifierBlockers(event, VERIFIER, time);

// The contract's windows: accept while now < starts; confirm while ends <= now < deadline;
// cancel while now < deadline.
describe('verifierBlockers at the exact boundaries', () => {
  it('accept: open one millisecond before the start, closed at the start', () => {
    expect(forVerifier(at(STARTS - 1, false)).accept).toBeNull();
    expect(forVerifier(at(STARTS, false)).accept).toBe(
      'The event has started; the terms can no longer be accepted.',
    );
  });

  it('confirm: closed one millisecond before the end, open at the end', () => {
    expect(forVerifier(at(ENDS - 1)).attest).toBe(`Opens when the event ends: t${ENDS}.`);
    expect(forVerifier(at(ENDS)).attest).toBeNull();
  });

  it('confirm and cancel: open one millisecond before the deadline, closed at it', () => {
    expect(forVerifier(at(DEADLINE - 1)).attest).toBeNull();
    expect(forVerifier(at(DEADLINE - 1)).cancel).toBeNull();
    expect(forVerifier(at(DEADLINE)).attest).toBe(DEADLINE_PASSED);
    expect(forVerifier(at(DEADLINE)).cancel).toBe(DEADLINE_PASSED);
  });

  it('tells the organizer the same about the deadline', () => {
    expect(verifierBlockers(at(DEADLINE - 1), ORGANIZER, time).cancel).toBe(
      'As the organizer, you can cancel this event from the Organize page.',
    );
    expect(verifierBlockers(at(DEADLINE), ORGANIZER, time).cancel).toBe(DEADLINE_PASSED);
  });
});
