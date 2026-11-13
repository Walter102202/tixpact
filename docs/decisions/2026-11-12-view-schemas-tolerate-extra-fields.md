# View schemas drop unknown fields; what we send is strict

Date: 2026-11-12. Author: Track W (Task W0). Status: accepted.

## Context

Every RPC response is parsed with a Zod schema before use (plan, Quality bar). The plan does not say whether a view that carries a field the frozen interface does not list should be rejected.

## Decision

- Views (`EventView`, `TicketView`, `AccountingView`, `OperationView`, `TicketHistory`, `Config`) use `z.object`: every listed field is required with its exact type, optional fields must be present as `null`, enums are the frozen lists, and unknown extra fields are dropped.
- `EventTerms`, the one shape the client sends, uses `z.strictObject`: an extra field is an error.
- Amounts are canonical decimal strings (no sign, no leading zeros) no larger than `u128::MAX`. Account ids follow the protocol's account id rule. Ticket ids are `<event_id>-<serial>`. The terms hash is 64 lowercase hex characters.
- Action builders parse their inputs with the same schemas, so a malformed amount or id throws before it reaches a wallet.

## Alternatives considered

- Strict views: an added field in the contract would take the whole web down during the demo, for no gain; a missing or mistyped field already fails.
- No runtime validation: violates the quality bar and hides seam mismatches until a wrong number is on screen.

## Consequences

A contract that adds a field is read fine; one that renames or retypes a field fails loudly with the method name in the error, which is what the G3 seam review wants to see.
