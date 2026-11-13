# The home page lists the newest event first

Date: 2026-11-13. Author: integrator. Status: accepted.

## Context

The contract returns events by id, oldest first, and the home page showed them in that order. On the released contract the first rows are the proof stories, all settled; an event that is still on sale was the last row, under a list a visitor had to scroll through.

## Decision

`HomePage` sorts what it read by event id, highest first. Nothing else changes: the contract's order, the pages by id and the proof page stay as they are.

## Alternatives considered

- **Group by phase (on sale first).** Closer to what a buyer wants, but a second ordering rule to explain and test; with ids growing over time, newest first gives almost the same list.
- **Leave the contract's order.** No code, and the one event a visitor can act on stays at the bottom.

## Consequences

`events.test.tsx` pins the order. The demo data shows its events in the same way.
