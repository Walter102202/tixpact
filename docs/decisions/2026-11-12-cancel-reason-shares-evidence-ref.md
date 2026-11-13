# A cancellation's reason is stored in `evidence_ref`

Date: 2026-11-12. Author: integrator. Status: accepted.

## Context

`cancel_event(event_id, reason_ref)` takes an optional reference, but `EventView` has one field for references, `evidence_ref`, and nothing named after the cancel reason (plan, "Methods" and "JSON shapes"). Raised by Track W in its W0 report, item 3, before Track C wrote any code.

## Decision

`EventView.evidence_ref` is the reference given by whoever resolved the event: the verifier's `evidence_ref` on `attest_completed`, the `reason_ref` on `cancel_event`, and `null` on expiry or when none was given. `outcome_reason` (`Attested`, `Cancelled`, `Expired`) says which one it is. Both are limited to `max_ref_bytes`. The plan's behaviour list now says so.

## Alternatives considered

- A second field `reason_ref` in `EventView`: one of the two would always be `null`, and it changes a frozen shape the client already implements.
- Only log the reason in the `event_resolved` event: the web has no indexer, so it could never show it.

## Consequences

The web labels the field from `outcome_reason` ("Evidence" or "Reason"). The reference is free text chosen by the caller: the web shows it as text and never as a link it vouches for.
