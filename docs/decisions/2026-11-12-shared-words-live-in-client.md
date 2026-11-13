# The promise sentence and the phase and claim words live in the client package

Date: 2026-11-12. Author: Track W (Task W0). Status: accepted.

## Context

Shared strings have one copy, in `packages/client`, and nobody but the integrator may edit that package after Task W0 is merged (plan, Working conventions). The Track W decisions fix the promise sentence and the words "Reserved", "Claimable", "Sending", "Refunded", "Awaiting confirmation", and the MCP tools describe the same events and tickets. Task W0's export list does not mention them.

## Decision

`@ticket-escrow/client` also exports `PROMISE_TEXT` (the plan's sentence, verbatim, pinned by a test), `PHASE_LABELS` and `CLAIM_LABELS`. Claim words: Reserved, Claimable, Sending, Refunded, Released to the organizer. Phase words: Awaiting verifier, On sale, Sold out, In progress, Awaiting confirmation, Deadline passed, Completed, Refunds open. Every label is distinct, and a test scans every exported string for the word "NFT".

Other additions beyond the plan's list, for the same reason (both consumers need them): `createRpc`, `Reader.contractId`, `createReader({ contractId, rpc })` for an injected provider, `FailedReceipt.executorId`, `TX_FIXTURES` with `createFixtureRpc`, and the `actions` namespace (`actions.buyTicket(...)`, `actions.GAS_TGAS`).

## Alternatives considered

- Words in `web/`: the MCP server would copy them, and the copies drift.
- Wait for W1 to ask the integrator: costs a round trip on the critical path for a few constants.

## Consequences

A wording change is an integrator edit in one file. W1 and M1 import these instead of writing their own.
