import { createFixtureReader, type Reader } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { money, moneyExact, NEAR_UNIT, readConfigOnce, unitFor } from './money';

const TUSD = { symbol: 'tUSD', decimals: 6 };

describe('money', () => {
  it('rounds toward zero at 4 decimals, as the NEAR amounts always were', () => {
    expect(money('1500000000000000000000000', NEAR_UNIT)).toBe('1.5 NEAR');
    expect(money('1234560000000000000000000', NEAR_UNIT)).toBe('1.2345 NEAR');
    expect(money('0', NEAR_UNIT)).toBe('0 NEAR');
    expect(money('10000000', TUSD)).toBe('10 tUSD');
    expect(money('10123456', TUSD)).toBe('10.1234 tUSD');
  });

  it('never shows a non-zero amount as 0', () => {
    expect(money('1', NEAR_UNIT)).toBe('<0.0001 NEAR');
    expect(money('99', TUSD)).toBe('<0.0001 tUSD');
  });

  it('shows every digit of a unit with 4 decimals or fewer', () => {
    expect(money('12345', { symbol: 'CENT', decimals: 2 })).toBe('123.45 CENT');
    expect(money('7', { symbol: 'WHOLE', decimals: 0 })).toBe('7 WHOLE');
  });
});

describe('moneyExact', () => {
  it('shows every digit, for a button that moves money', () => {
    expect(moneyExact('1234560000000000000000000', NEAR_UNIT)).toBe('1.23456 NEAR');
    expect(moneyExact('1', NEAR_UNIT)).toBe('0.000000000000000000000001 NEAR');
    expect(moneyExact('10123456', TUSD)).toBe('10.123456 tUSD');
  });
});

describe('unitFor', () => {
  it('needs no read for a NEAR amount', async () => {
    let reads = 0;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      getConfig: () => {
        reads += 1;
        return fixtures.getConfig();
      },
    };
    expect(await unitFor(reader, null)).toEqual(NEAR_UNIT);
    expect(reads).toBe(0);
  });

  it("reads a token's symbol and decimals from the contract's list, once per reader", async () => {
    let reads = 0;
    const fixtures = createFixtureReader();
    const config = await fixtures.getConfig();
    const token = config.tokens[0];
    if (!token) throw new Error('the fixtures list no token');
    const reader: Reader = {
      ...fixtures,
      getConfig: () => {
        reads += 1;
        return fixtures.getConfig();
      },
    };
    expect(await unitFor(reader, token.account_id)).toEqual({
      symbol: token.symbol,
      decimals: token.decimals,
    });
    await unitFor(reader, token.account_id);
    await readConfigOnce(reader);
    expect(reads).toBe(1);
  });

  it('reads again after a failed read instead of keeping the failure', async () => {
    let fail = true;
    const fixtures = createFixtureReader();
    const reader: Reader = {
      ...fixtures,
      getConfig: () => (fail ? Promise.reject(new Error('down')) : fixtures.getConfig()),
    };
    await expect(readConfigOnce(reader)).rejects.toThrow('down');
    fail = false;
    expect((await readConfigOnce(reader)).tokens.length).toBeGreaterThan(0);
  });
});
