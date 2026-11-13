# Agent writes return one of five statuses; the chain is checked before the policy, and nothing is signed unless both pass

Date: 2026-11-12. Author: Track M. Status: accepted.

## Context

The plan fixes that a write above a cap "returns `denied`" and that the server is read-only without a key, but not what the other outcomes look like, nor whether the server checks the contract's own rules before signing. A call the contract will reject still costs the agent gas and gives the model a raw panic message.

## Decision

Every write tool returns, as `structuredContent` and never as a protocol error, one `WriteResult` (`mcp/src/schemas.ts`) with `status`:

- `denied`: this server's rules refused it: no key, no caps, the contract or method allowlist, the gas table, a deposit on a call other than `buy_ticket`, the per-ticket cap or the exposure cap. Nothing signed.
- `not_sent`: the chain says the contract would reject it: the event does not exist or is not on sale, the agent does not hold the ticket, the ticket is locked or not claimable, the deadline has not passed. Nothing signed. The contract stays the authority; these checks only save gas and give a plain reason.
- `succeeded` / `failed`: signed, then judged by re-reading the transaction by hash with every receipt (`trackTransaction`, `docs/decisions/2026-11-12-tx-tracking-judged-at-final.md`). A claim succeeds only when `moneyMoved` is true.
- `unconfirmed`: signed, no final status in time; the result carries the hash and the explorer link.

Order of checks in every write: the key, the caps, the chain checks, then the policy (`evaluate`), then the signer. Read tools report a missing event or ticket as a tool error (`isError`) with one sentence.

The text view uses exact NEAR (24 decimals, trailing zeros dropped) so an amount is never rounded to look within a cap, and UTC times.

## Alternatives considered

- Report denials as `isError`: the SDK skips output-schema validation for errors and a client may drop `structuredContent`, so the reason and the amounts would not be typed.
- Let the contract reject everything: each rejected call costs the agent gas and the model a panic string.
- Policy before the chain checks: when an event is both sold out and above the cap, "sold out" is the fact that matters; the cap test uses an event that is on sale.

## Consequences

The chain checks read the same views as the web (`phase`, `claim`, `now_ms`), so a view one block stale can refuse a call that would just have worked; the model calls again. They can never let through a call the policy denies.
