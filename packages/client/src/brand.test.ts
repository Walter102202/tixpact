import { describe, expect, it } from 'vitest';
import { APP_NAME, PROMISE_TEXT } from './brand.js';

describe('brand', () => {
  it('has a display name', () => {
    expect(APP_NAME.trim().length).toBeGreaterThan(0);
  });

  it('states the promise verbatim', () => {
    expect(PROMISE_TEXT).toBe(
      'Your ticket keeps its price reserved. If the event is cancelled, or the deadline passes without the agreed confirmation, whoever holds the ticket can claim it.',
    );
  });
});
