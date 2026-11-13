import { describe, expect, it } from 'vitest';
import { ZodType } from 'zod';
import { APP_NAME, PROMISE_TEXT } from './brand.js';
import * as client from './index.js';

/** Every string reachable from the package's exported values, skipping functions and schemas. */
function exportedStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  if (value instanceof ZodType) return [];
  seen.add(value);
  const keys = Array.isArray(value) ? [] : Object.keys(value);
  return [...keys, ...Object.values(value)].flatMap((v) => exportedStrings(v, seen));
}

describe('brand', () => {
  it('has a display name', () => {
    expect(APP_NAME.trim().length).toBeGreaterThan(0);
  });

  it('never calls the ticket an NFT', () => {
    expect(APP_NAME).not.toMatch(/nft/i);
  });

  it('states the promise verbatim', () => {
    expect(PROMISE_TEXT).toBe(
      'Your ticket keeps its price reserved. If the event is cancelled, or the deadline passes without the agreed confirmation, whoever holds the ticket can claim it.',
    );
  });

  it('exports no string that says NFT (method names such as nft_transfer are fine)', () => {
    const strings = exportedStrings(client);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter((s) => /\bnfts?\b/i.test(s))).toEqual([]);
  });
});
