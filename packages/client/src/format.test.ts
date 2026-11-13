import { describe, expect, it } from 'vitest';
import { CLAIM_LABELS, formatDateTime, formatNear, PHASE_LABELS, parseNear } from './format.js';
import { ClaimSchema, PhaseSchema } from './schemas.js';

describe('formatNear', () => {
  it('formats yoctoNEAR as NEAR without trailing zeros', () => {
    expect(formatNear('1500000000000000000000000')).toBe('1.5');
    expect(formatNear('1000000000000000000000000')).toBe('1');
    expect(formatNear('0')).toBe('0');
    expect(formatNear('700000000000000000000000')).toBe('0.7');
  });

  it('rounds toward zero at maxDecimals, so it never shows more than the amount', () => {
    expect(formatNear('123456789000000000000000000')).toBe('123.4567');
    expect(formatNear('123456789000000000000000000', 2)).toBe('123.45');
    expect(formatNear('1999999999999999999999999', 0)).toBe('1');
    expect(formatNear('1000000000000000000000001', 24)).toBe('1.000000000000000000000001');
  });

  it('never shows a non-zero amount as zero', () => {
    expect(formatNear('1')).toBe('<0.0001');
    expect(formatNear('1', 0)).toBe('<1');
  });

  it('rejects anything that is not a yoctoNEAR amount', () => {
    for (const bad of ['1.5', '-1', '', 'abc', '01']) {
      expect(() => formatNear(bad)).toThrow();
    }
    expect(() => formatNear('1', -1)).toThrow(RangeError);
    expect(() => formatNear('1', 25)).toThrow(RangeError);
  });
});

describe('parseNear', () => {
  it('parses NEAR into yoctoNEAR with bigint arithmetic only', () => {
    expect(parseNear('1.5')).toBe('1500000000000000000000000');
    expect(parseNear(' 2 ')).toBe('2000000000000000000000000');
    expect(parseNear('0.000000000000000000000001')).toBe('1');
  });

  it('keeps decimal amounts exact (0.1 + 0.2 is 0.3)', () => {
    expect(BigInt(parseNear('0.1')) + BigInt(parseNear('0.2'))).toBe(BigInt(parseNear('0.3')));
  });

  it('round-trips with formatNear at full precision', () => {
    for (const yocto of ['0', '1', '1500000000000000000000000', '123456789012345678901234567']) {
      expect(parseNear(formatNear(yocto, 24))).toBe(yocto);
    }
  });

  it('rejects text that is not a plain NEAR amount', () => {
    for (const bad of [
      '',
      ' ',
      '1,5',
      '-1',
      '1e3',
      '1.',
      '.5',
      'abc',
      '0.0000000000000000000000001',
    ]) {
      expect(() => parseNear(bad)).toThrow(RangeError);
    }
  });
});

describe('formatDateTime', () => {
  it('formats in the given time zone with a 24-hour clock and the zone name', () => {
    const ms = Date.UTC(2026, 10, 14, 20, 0);
    expect(formatDateTime(ms, 'America/Santiago')).toBe('Nov 14, 2026, 17:00 GMT-3');
    expect(formatDateTime(ms, 'UTC')).toBe('Nov 14, 2026, 20:00 UTC');
  });

  it('rejects an unknown time zone', () => {
    expect(() => formatDateTime(0, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('labels', () => {
  it('name every phase and every claim state', () => {
    expect(Object.keys(PHASE_LABELS).sort()).toEqual([...PhaseSchema.options].sort());
    expect(Object.keys(CLAIM_LABELS).sort()).toEqual([...ClaimSchema.options].sort());
  });

  it('use the plan words, one meaning each', () => {
    expect(CLAIM_LABELS.Reserved).toBe('Reserved');
    expect(CLAIM_LABELS.Refundable).toBe('Claimable');
    expect(CLAIM_LABELS.RefundPending).toBe('Sending');
    expect(CLAIM_LABELS.Refunded).toBe('Refunded');
    expect(PHASE_LABELS.AwaitingAttestation).toBe('Awaiting confirmation');
    expect(PHASE_LABELS.AwaitingVerifier).toBe('Awaiting verifier');
    const all = [...Object.values(PHASE_LABELS), ...Object.values(CLAIM_LABELS)];
    expect(new Set(all).size).toBe(all.length);
  });
});
