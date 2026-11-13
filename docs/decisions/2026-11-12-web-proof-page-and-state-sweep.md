# The proof page reads everything fresh, and every route fails the same visible way

Date: 2026-11-12. Author: Track W. Status: accepted.

## Context

Task W4 asks for a proof page (contract account, code hash, key count, balance, reserved principal over all events, block height, explorer links, "Could not read the chain" with no stale numbers) and a sweep of every route (plan, "Task W4"). Open: what to compare the balance with, how "no stale numbers" is enforced, and what the sweep fixes beyond loading and error states.

## Decision

1. `/proof` reads `getAccountProof(contractId)` and `principal_reserved` of every event (list read to its last page) in one load. It states one comparison: "The balance covers the reserved ticket principal." or "The balance is below the reserved ticket principal.", and says the balance also pays for storage and holds what organizers have yet to collect. The block height is the one `getAccountProof` read the account at; the event reads are separate `final` reads.
2. No stale numbers: `useLoad` drops the data when a read starts, so "Read again" or a failure never shows the old figures next to the error. Bounded time comes from `createRpc` (8 s per endpoint for reads).
3. The key line is "0 keys: nobody can change this contract", "1 key: this deployment can still be changed", or "N keys: this deployment can still be changed".
4. Sweep: every route shows "Reading …" while it reads and "Could not read the chain." with "Try again" when reads fail (one test per route); an unknown address links back to the events; after an in-app navigation focus moves to the page content, and never on the first load, even under React strict mode; a render error replaces the page with "This page hit an error and stopped." and a reload button, reset on the next route.

## Alternatives considered

- Compare the balance with everything the contract owes (reserved + refund pending + organizer available and pending + storage): closer to the contract's liquidity check, but four numbers a judge cannot check against one view. The page shows the one figure the promise is about.
- Keep the last good read on screen with a warning when a fresh read fails: a judge could quote a number the chain no longer confirms.

## Consequences

The comparison is between two reads that may be a block apart; on testnet during the demo that difference is a purchase or two. The production bundle is one 662 kB JavaScript file, 198 kB gzipped (mostly near-api-js and near-connect); splitting the wallet code out is left for after submission.
