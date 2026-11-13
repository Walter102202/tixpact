# The refund watcher backs off a failing call, gives it up after five, and stops before the next call

Date: 2026-11-13. Author: Track M. Status: accepted. Adds to `2026-11-12-agent-exposure-and-one-write-at-a-time.md` (the watcher part).

## Context

The M2 review (`C:\dev\near-project-reports\review-m2.md`, findings 1, 2 and 6):

- A claim or expiry that fails on chain was signed again every 30 s, for ever: up to 2,880 paid transactions a day per stuck ticket, with no model in the loop. For example, the contract checks liquidity after it writes the reservation and reverts.
- Ctrl+C aborted a signal that `watchOnce` never saw, so a round signed every remaining claim.
- Every write read the agent's whole ticket list, so anyone able to push thousands of tickets to the agent blocked every claim and watcher round.

## Decision

- The watcher keeps a failure count per call ("claim_refund 8-1", "expire_event 6") across rounds.
- Only a result that cost a transaction counts as a failure (`failed`, `unconfirmed`). A call refused before signing (`denied`, `not_sent`) costs nothing and is not counted.
- After failure n (n = 1 to 4), the call waits 2^n rounds: 60, 120, 240 and 480 s at the 30 s interval. The fifth failure gives the call up until the watcher restarts, with one log line that says why. A success clears the count.
- The stop signal is checked before every call; once it aborts, the round sends nothing more and logs one line.
- Only `buy_ticket` reads the exposure. The watcher reads tickets a page at a time and handles each page before reading the next, so a list that cannot be read to the end still gets the claims it could read. A round reads at most 100 pages.

## Alternatives considered

- Retry until the ticket's view changes: a stuck liquidity check does not change the view, so it never stops.
- A time-based back-off: rounds are the watcher's clock already, and counting rounds keeps it testable without timers.

## Consequences

- At most 5 paid failures per call per watcher run.
- A call given up stays given up until restart, even if the cause clears; the log line says to restart.
- Successful claims of near-worthless tickets someone pushed to the agent still cost a fee each (the sender pays more). There is no minimum value for a claim yet.
