# Times are shown in the viewer's time zone, with the offset written out

Date: 2026-11-12. Author: integrator. Status: accepted.

## Context

Task W1 asked for start, end and deadline "in the event's time zone", but `EventTerms` and `EventView` carry no time zone (plan, "JSON shapes"), and the interface is frozen. Raised by Track W in its W0 report, item 2.

## Decision

Every time is shown in the zone of the viewer's browser, always with the UTC offset in the text ("Nov 14, 2026, 17:00 GMT-3"), through `formatDateTime(ms, timeZone)` from `@ticket-escrow/client`. The MCP server prints UTC. No time zone field is added.

## Alternatives considered

- A fixed demo zone (America/Santiago): wrong for every judge outside Chile, with nothing on the page saying so.
- A `time_zone` field in the terms: changes the frozen interface and the terms hash for a display detail.

## Consequences

Two people in different zones read different clock times for the same instant; the written offset makes that visible. A venue-local time would need a new terms field after the hackathon.
