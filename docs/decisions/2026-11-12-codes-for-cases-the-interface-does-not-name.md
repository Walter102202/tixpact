# Error codes and behaviour for the cases the frozen interface does not name

Date: 2026-11-12. Author: Track C. Status: accepted.

## Context

The frozen interface lists 21 error codes and the main behaviour of each method (plan, "Frozen interface (v1)"). Writing the contract met cases it does not name. Adding a code changes the frozen list, so each case reuses the closest existing code.

## Decision

| Case | Behaviour |
|---|---|
| Title or venue longer than 120 bytes | `ERR_LIMIT`, like every other byte limit (`max_*_bytes`). `create_event_rejects_bad_terms` pins the 121-byte title. |
| Empty title or venue (after trimming spaces) | `ERR_INVALID_TERMS`. |
| Verifier equal to this contract | `ERR_INVALID_TERMS`, like a verifier equal to the organizer: the contract can never accept, so the event could never sell. |
| `price * capacity` does not fit in a `u128` | `ERR_INVALID_TERMS`, so no ledger sum of the event can overflow. |
| Any amount arithmetic that would overflow or go below zero | `ERR_LIMIT: amount out of range`. Unreachable by construction (money only moves between buckets that hold it); the check turns a bug into a reverted call instead of a wrapped amount. |
| `nft_transfer` to the current holder or to this contract | `ERR_UNAUTHORIZED`. A ticket held by the contract could never be claimed. |
| `accept_verification` called again with the right hash after acceptance | Succeeds and changes nothing (no second event log). |
| `claim` of a ticket locked by a transfer to a contract while its event is `Refundable` | `Refundable`: `claim` describes the right, `status: TransferPending` shows the lock. |
| `nft_tokens`, `nft_tokens_for_owner` | At most `max_page` items (a `null` limit means `max_page`), an empty list past the end or for a zero limit. The standard implementation panics in those two cases and has no page bound. |
| Check order inside a method | The 1-yocto deposit first, then argument limits, then existence, then the caller's role, then the ticket's lock, then the event's outcome, then the time window, then acceptance and capacity; the amount of a `buy_ticket` or `create_event` deposit is checked last. A call that breaks several rules reports the first one in this order. |

Panics raised by the SDK itself before our code runs (malformed JSON arguments, a deposit on a non-payable method, a direct call to a `#[private]` method) keep the SDK's own message; they never change state.

## Alternatives considered

- New codes such as `ERR_INVALID_RECEIVER`: a change to the frozen interface and to every client for cases a user rarely meets.
- Reporting `ERR_TICKET_LOCKED` only after the outcome and time checks: a contract re-entering during `nft_transfer_call` would then see `ERR_NOT_REFUNDABLE` instead of the lock that `t12` asks for.

## Consequences

`parseContractError` in `packages/client` already has one sentence per frozen code, so no client change is needed. If a judge or a user finds one of these confusing, a later version can add a code; the order rule above keeps the reported code stable meanwhile.
