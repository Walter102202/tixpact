# The entry pass and the prices in dollars share one demo reader

Date: 2026-11-13. Author: lane W2 (task W8, merge of track/i2 into track/w2). Status: accepted.

## Context

Lane P's door checks a pass against a pass chain built from the demo reader, and lane W2 switched the demo reader to `FIXTURES_WITH_TOKENS`. The merge had to pick which reader the door reads in demo mode and in tests. It also had to deal with one of lane P's tests that failed only in the full suite.

## Decision

1. **One reader.** Demo mode builds one reader from `FIXTURES_WITH_TOKENS` and gives it to the pages and to `createFixturePassChain`. `testServices` builds the pass chain from the test's own reader, so a test that reads tUSD events checks tUSD tickets at the door too. A ticket of a tUSD event gets its pass and is admitted exactly as a NEAR one; `pass.test.tsx` pins this with ticket 10-1.
2. **The countdown test waits for its interval.** "counts down, expires, and signs a new pass" failed in about one full run in three.
   - The timer shows on the render that loads the ticket, but the effect that starts its interval runs a moment later.
   - A probe showed no interval registered when the timer appeared in the failing run. `advanceTimersByTime` ticked nothing and the page still read "5:00".
   - The test now waits, on the real clock and for at most a second, until the interval exists, instead of being rerun.
   - The page is unchanged: in a browser the effect runs within milliseconds.
3. **The client keeps K2's latest recordings.** `packages/client` merged cleanly. It keeps `tokenClaimRefused` and `tokenPayoutRefused` (K2 commit 004093d), which track/i2 did not have yet and which the web's refusal tests use.

## Consequences

Demo mode shows passes for tUSD tickets. Five full runs and two gates in a row passed after the wait.
