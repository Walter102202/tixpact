# Amounts round toward zero; times use a 24-hour clock with the zone name

Date: 2026-11-12. Author: Track W (Task W0). Status: accepted.

## Context

The plan fixes `formatNear(yocto, maxDecimals = 4)` and `formatDateTime(ms, timeZone)` but not how to round or what the output looks like.

## Decision

- `formatNear` rounds toward zero at `maxDecimals` and drops trailing zeros (`'1.5'`, `'123.4567'`). A non-zero amount too small to show is written `'<0.0001'` (`'<1'` at 0 decimals), never `'0'`. Input must be a canonical yoctoNEAR string; anything else throws.
- `parseNear` accepts digits with at most one dot and up to 24 decimals, trims spaces, and rejects everything else (`'1,5'`, `'1e3'`, `'.5'`, `'1.'`, a minus sign) with a `RangeError` whose message a form can show.
- `formatDateTime` uses English month names, a 24-hour clock and the short zone name: `'Nov 14, 2026, 17:00 GMT-3'`. It is assembled from `Intl.DateTimeFormat` parts so the output does not change with ICU spacing rules.

## Alternatives considered

- Round half up: can show more than the ticket holds, which is the one thing a money screen must not do.
- Locale formatting with thousands separators: the product is English-only and amounts are small; plain digits are easier to compare with the explorer.
- 12-hour clock: judges are international, and "17:00 GMT-3" is unambiguous.

## Consequences

A price with more than four decimals is shown truncated in lists; screens that must show the exact amount pass `maxDecimals = 24`.
