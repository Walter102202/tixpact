# Without a contract id the web runs on demo data, and says so on every page

Date: 2026-11-12. Author: Track W. Status: accepted.

## Context

The plan defines fixture mode as `VITE_FIXTURES=1` (plan, "Decisions already taken"). It does not say what the web does when `VITE_CONTRACT_ID` is missing; reading a contract that is not named can only fail. Fixture data also never changes, so the re-read after a transaction (`readUntilChanged`, 5 reads 1 s apart) would always end in "The page has not caught up with the chain yet".

## Decision

- `readConfig` (`web/src/config.ts`) turns fixture mode on when `VITE_FIXTURES` is `1` or `VITE_CONTRACT_ID` is empty. The only network accepted is `testnet`.
- In fixture mode every page shows, under the header: "Demo data: nothing on this page is on chain. Set VITE_CONTRACT_ID to read the testnet contract." Explorer links are hidden, because the recorded hashes are not on chain.
- In fixture mode the fixture wallet answers with the recorded transactions in `packages/client` (`buySucceeded`, `refundSettled`), and after a transaction the page reads once instead of waiting for a change (`web/src/lib/near/useTx.ts`).

## Alternatives considered

- Fail at start without a contract id: a fresh clone shows a blank page, which is the worst first impression for a judge.
- Make the fixtures change after a demo transaction: a stateful fake chain to write and test, for a mode the banner already marks as not real.

## Consequences

A deployment that forgets `VITE_CONTRACT_ID` shows demo data, but with the banner on every page, so it cannot pass for the real contract. The hosted demo (Task I2) must set the variable.
