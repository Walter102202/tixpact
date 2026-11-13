import { describe, expect, it } from 'vitest';
import { parseLocalTime } from './terms';

describe('parseLocalTime reads the wall clock in the zone it is given', () => {
  it('runs in UTC (vitest.config.ts), away from every zone below, so no answer comes from the process', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    expect(new Date(2026, 10, 20, 20, 0).getTime()).toBe(Date.UTC(2026, 10, 20, 20, 0));
  });

  it.each([
    // Santiago keeps summer time (UTC-3) in November and winter time (UTC-4) in July.
    ['2026-11-20T20:00', 'America/Santiago', Date.UTC(2026, 10, 20, 23, 0)],
    ['2026-07-01T20:00', 'America/Santiago', Date.UTC(2026, 6, 2, 0, 0)],
    ['2026-11-20T20:00', 'Europe/Madrid', Date.UTC(2026, 10, 20, 19, 0)],
    ['2026-11-20T20:00', 'UTC', Date.UTC(2026, 10, 20, 20, 0)],
    ['2026-11-20T20:00:30', 'America/Santiago', Date.UTC(2026, 10, 20, 23, 0, 30)],
  ])('%s in %s', (value, zone, expected) => {
    expect(parseLocalTime(value, zone)).toBe(expected);
  });

  it.each(['', 'tomorrow', '2026-11-20', '2026-02-30T10:00', '2026-11-20T24:00'])(
    'refuses %j',
    (value) => {
      expect(parseLocalTime(value, 'America/Santiago')).toBeNull();
    },
  );
});
