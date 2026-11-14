# Two events stay on sale through the judging days

Date: 2026-11-14. Author: the integrator, with Walter's OK. Status: accepted.

## Context

Every event on `ticket-escrow-v2.testnet` lasted minutes, so that a deadline could be watched. By the evening of 2026-11-14 all of them were resolved or about to be. Judging starts on 2026-11-16: someone who opened the hosted site then could read everything and buy nothing.

## Decision

Two events created on 2026-11-14 with `scripts/demo-event.sh`, organizer `te-d1-organizer.testnet`, verifier `te-d1-verifier.testnet`, 50 tickets each:

| Event | Title | Price | On sale until (UTC) | Deadline (UTC) |
|---|---|---|---|---|
| 13 | Closing night | 0.5 NEAR | 2026-11-26 00:00:31 | 2026-11-26 02:00:31 |
| 14 | Closing night in dollars | 10 tUSD | 2026-11-26 00:01:00 | 2026-11-26 02:01:00 |

Nobody will confirm them. After the deadline anyone can switch them to refunds, and each holder claims the price of their ticket.

```bash
# inside WSL, from the repository root; STARTS_IN_SECONDS is the time left until 2026-11-26 00:00 UTC
CONTRACT_ID=ticket-escrow-v2.testnet ORGANIZER_ID=te-d1-organizer.testnet VERIFIER_ID=te-d1-verifier.testnet \
  TITLE='Closing night' PRICE_NEAR=0.5 CAPACITY=50 STARTS_IN_SECONDS=<seconds> WINDOW_SECONDS=3600 \
  bash scripts/demo-event.sh
# the second one adds: TITLE='Closing night in dollars' CURRENCY=tusd.ticket-escrow-v2.testnet PRICE=10
```

The organizer prepays the storage of each event (1.29206 NEAR for 50 tickets) and held 1 NEAR, so `te-d1-anyone.testnet` sent it 2 NEAR first (transaction `6FnYkR5BCL6U3jMNunL8MYPPwVWvA4nd19d7NxNFiKjT`).

## Alternatives considered

- **Leave only resolved events.** A judge reads the history and cannot try the purchase on the hosted site.
- **A deadline inside the judging days**, so that the refund can be played there too. Whoever arrives after it finds the event closed. The refund within minutes is already covered by `scripts/direct-calls.sh` and `scripts/demo-event.sh`.
- **100 tickets each**, the contract's maximum. 2.56956 NEAR of storage per event, for a demand nobody expects.

## Consequences

The README's "Try it" starts with the hosted path and names both events; its real/simulated table says these two are the exception to "demo events last minutes". If one sells out, nothing in that currency is on sale: the same command creates another. Tickets bought there are refundable from 2026-11-26 02:00 UTC, from the web app while it stays up, or with the NEAR CLI.

The keys of the organizer and the verifier stay with us, so we could still cancel or confirm these events. The README says nobody will confirm them.
