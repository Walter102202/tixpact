# Fixtures: FIXTURES stays the NEAR chain, FIXTURES_WITH_TOKENS adds three tUSD events

Date: 2026-11-13. Author: lane K2 (task K1). Status: accepted.

## Context

The plan asks the fixtures to gain "one event priced in tUSD (6 decimals) with tickets in each claim state, token balances and one unregistered account". Two things stand in the way:

- A ticket's claim follows its event's outcome: `Reserved` needs an unresolved event, `ReleasedToOrganizer` a completed one, `Refundable`, `RefundPending` and `Refunded` a refundable one. One event cannot hold all five.
- The web's tests read `FIXTURES` with hard-coded counts (`/proof` expects "Events read: 8"; the organizer and verifier pages count org.testnet's and teatro.testnet's events). Any event added to `FIXTURES` turns `bash scripts/gate.sh web` red, and `web/` belongs to lane W2.

## Decision

- `FIXTURES` keeps its eight NEAR events, tickets and ledgers, in the v2 shapes (`currency: null`), with `Config.tokens` listing tUSD and a token ledger in which the contract holds 0 tUSD.
- `FIXTURES_WITH_TOKENS` is `FIXTURES` plus three tUSD events, one per outcome: 10 on sale (10 tUSD), 11 cancelled with refunds open (25 tUSD: Luis holds one `Refundable`, one `RefundPending` with operation 12, one `Refunded`; Sofia holds one `Refundable` and is not registered with tUSD), 12 completed (12.5 tUSD, 25 tUSD for the organizer to collect). Id 9 is left free because the recorded `create_event` transaction returns 9 and both the web and the agent tests add their own event 9.
- `FIXTURE_TOKEN_ID` is `tusd.testnet`. Ledgers: Luis 40 tUSD, Ana 4 tUSD (less than one ticket to event 10, the faucet case), org.testnet registered with 0, Sofia not registered, the contract exactly what tUSD events owe. Minimum registration deposit 0.00125 NEAR.
- Both sets are built by one function, so the contract's NEAR balance and token balance always follow from the events in the set. The tests check both sets against the schemas, the accounting identity per event in its own currency, and the currency of every ticket, row and operation against its event.
- `TX_FIXTURES` gains three token purchases: bought (Luis, 10-3), rejected by the contract after the token moved the money (Ana, event 12, `ERR_TOO_LATE`, refunded by the resolver), refused by the token before the contract ran (Sofia, not registered).

## Alternatives considered

- Add the events to `FIXTURES` and let lane W2 fix its counts: every commit of this lane must pass the web gate, and the two lanes run at the same time.
- One tUSD event with inconsistent claims: the fixture tests derive each claim from the outcome, which is what keeps fixture mode honest.

## Consequences

- Lane W2 switches fixture mode to `createFixtureReader(FIXTURES_WITH_TOKENS)` when its screens are ready and updates its counts in the same commit.
- Recorded statuses are hand-built from near-contract-standards' `ft_transfer_call`; replace them with captures once v2 and the test token are on testnet.
