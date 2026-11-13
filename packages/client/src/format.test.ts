import { describe, expect, it } from 'vitest';
import { FIXTURES } from './fixtures.js';
import {
  CLAIM_LABELS,
  formatAmount,
  formatDateTime,
  formatNear,
  NEAR_UNIT,
  PHASE_LABELS,
  parseAmount,
  parseNear,
  type Unit,
  unitOf,
} from './format.js';
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

const TUSD: Unit = { symbol: 'tUSD', decimals: 6 };
const WHOLE: Unit = { symbol: 'PTS', decimals: 0 };

describe('unitOf', () => {
  it('is NEAR with 24 decimals for a null currency', () => {
    expect(unitOf(FIXTURES.config, null)).toEqual({ symbol: 'NEAR', decimals: 24 });
    expect(NEAR_UNIT).toEqual({ symbol: 'NEAR', decimals: 24 });
  });

  it('is the token the config lists, with its symbol and decimals', () => {
    expect(unitOf(FIXTURES.config, 'tusd.testnet')).toEqual({ symbol: 'tUSD', decimals: 6 });
  });

  it('throws for a token the deployment does not accept', () => {
    expect(() => unitOf(FIXTURES.config, 'other-token.testnet')).toThrow(
      /other-token.testnet is not one of the tokens/,
    );
  });
});

describe('formatAmount', () => {
  it('writes amounts the way the contract does: no trailing zeros, then the symbol', () => {
    expect(formatAmount('500000000000000000000000', NEAR_UNIT)).toBe('0.5 NEAR');
    expect(formatAmount('1500000000000000000000000', NEAR_UNIT)).toBe('1.5 NEAR');
    expect(formatAmount('10000000', TUSD)).toBe('10 tUSD');
    expect(formatAmount('12500000', TUSD)).toBe('12.5 tUSD');
    expect(formatAmount('1', TUSD)).toBe('0.000001 tUSD');
    expect(formatAmount('0', TUSD)).toBe('0 tUSD');
    expect(formatAmount('7', WHOLE)).toBe('7 PTS');
  });

  it('is exact by default, never rounding an amount to look smaller or larger', () => {
    expect(formatAmount('1000000000000000000000001', NEAR_UNIT)).toBe(
      '1.000000000000000000000001 NEAR',
    );
    expect(formatAmount(((1n << 128n) - 1n).toString(), TUSD)).toBe(
      '340282366920938463463374607431768.211455 tUSD',
    );
  });

  it('rounds toward zero at maxDecimals and never shows dust as zero', () => {
    expect(formatAmount('123456789000000000000000000', NEAR_UNIT, 4)).toBe('123.4567 NEAR');
    expect(formatAmount('12999999', TUSD, 2)).toBe('12.99 tUSD');
    expect(formatAmount('1', NEAR_UNIT, 4)).toBe('<0.0001 NEAR');
    expect(formatAmount('1', TUSD, 0)).toBe('<1 tUSD');
    expect(formatAmount('1', TUSD, 10)).toBe('0.000001 tUSD');
    expect(formatAmount('0', NEAR_UNIT, 4)).toBe('0 NEAR');
  });

  it('refuses what is not an amount, and a unit with impossible decimals', () => {
    for (const bad of ['', '1.5', '-1', '01', '1e6', ' 1']) {
      expect(() => formatAmount(bad, TUSD), bad).toThrow(RangeError);
    }
    expect(() => formatAmount('1', { symbol: 'X', decimals: 25 })).toThrow(RangeError);
    expect(() => formatAmount('1', { symbol: 'X', decimals: 1.5 })).toThrow(RangeError);
    expect(() => formatAmount('1', TUSD, -1)).toThrow(RangeError);
  });

  it('matches formatNear for NEAR amounts', () => {
    for (const yocto of ['0', '1', '700000000000000000000000', '123456789000000000000000000']) {
      expect(formatAmount(yocto, NEAR_UNIT)).toBe(`${formatNear(yocto, 24)} NEAR`);
    }
  });
});

describe('parseAmount', () => {
  it('reads an amount typed in the unit into its smallest units', () => {
    expect(parseAmount('10', TUSD)).toBe('10000000');
    expect(parseAmount('12.5', TUSD)).toBe('12500000');
    expect(parseAmount('0.000001', TUSD)).toBe('1');
    expect(parseAmount(' 3 ', TUSD)).toBe('3000000');
    expect(parseAmount('0', TUSD)).toBe('0');
    expect(parseAmount('1.5', NEAR_UNIT)).toBe(parseNear('1.5'));
    expect(parseAmount('7', WHOLE)).toBe('7');
  });

  it('returns null for anything that is not an amount in the unit', () => {
    for (const bad of [
      '',
      ' ',
      '-1',
      '+1',
      '1e3',
      '1.',
      '.5',
      '1,5',
      '1.2.3',
      '10 tUSD',
      'ten',
      '0.0000001',
      '7.0',
    ]) {
      expect(parseAmount(bad, bad === '7.0' ? WHOLE : TUSD), bad).toBeNull();
    }
    expect(parseAmount('340282366920938463463374607431768.211456', TUSD)).toBeNull();
  });

  it('reads back exactly what formatAmount writes', () => {
    for (const amount of ['0', '1', '12500000', '999999999999', ((1n << 128n) - 1n).toString()]) {
      const text = formatAmount(amount, TUSD).replace(/ tUSD$/, '');
      expect(parseAmount(text, TUSD)).toBe(amount);
    }
  });
});
