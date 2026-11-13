# The agent's exposure counts money still in the contract, plus purchases not yet visible; writes run one at a time

Date: 2026-11-12. Author: Track M. Status: accepted.

## Context

The plan caps "the total principal of the tickets it holds, read from the chain each time" (`MAX_EXPOSURE_YOCTO`) but does not say which tickets count. A held ticket can be in any claim state (`Reserved`, `Refundable`, `RefundPending`, `Refunded`, `ReleasedToOrganizer`).

Two gaps would let the agent go above the cap while every single check passes:

- MCP clients may call tools in parallel. Two `buy_ticket` calls read the same ticket list, both pass, and both sign.
- A purchase that is signed but not yet in the list the next check reads: its final status did not arrive in time (`unconfirmed`), or the list came from an RPC node a block behind the one that confirmed it (`packages/client/src/tx.ts`, `trackTransaction` doc comment).

## Decision

- Exposure is the sum of `principal` over the agent's tickets whose claim is `Reserved`, `Refundable` or `RefundPending`: the money still inside the contract (`mcp/src/policy.ts`, `exposureOf`). `Refunded` came back; `ReleasedToOrganizer` paid for an event that took place.
- Every write (`buy_ticket`, `transfer_ticket`, `expire_event`, `claim_refund`) runs inside one queue per process, from the chain read to the final verdict (`mcp/src/agent.ts`, `serialized`).
- A purchase the agent signed stays counted until its ticket id appears in the agent's list. An unconfirmed one keeps counting until a later look at its hash shows it failed (then it stops counting) or shows the minted id (then it stops once that id is listed).
- The ticket list is read until an empty page, never stopped at a short page, so a contract page limit below ours cannot undercount.

## Alternatives considered

- Count every held ticket, including `Refunded` and `ReleasedToOrganizer`: the cap would then be a lifetime spending limit the agent can only reset by giving tickets away. The account balance already is the lifetime limit.
- No queue, only the chain read: fails the concurrency test (`mcp/src/tools.test.ts`, "two purchases asked for at once cannot both pass it"; removing the queue makes it fail).
- Forget a purchase once it is tracked as succeeded: undercounts when the list is read from a node that is behind.

## Consequences

- The cap holds within one server process. Two processes with the same key (two MCP sessions, or the server and a script that buys) do not share the queue: run one server per agent key. The refund watcher only expires and claims, which never raise exposure.
- A purchase whose ticket is transferred away before it ever shows in the list keeps counting until the process restarts. That errs toward denying, never toward overspending.
- Writes wait for one another; a slow transaction (up to about 40 seconds of tracking) delays the next write.
