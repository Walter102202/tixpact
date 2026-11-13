# The token list given to `new` is checked strictly, and the currency is stored once per event

Date: 2026-11-13. Author: lane C2. Status: accepted.

## Context

Interface v2 (`docs/plans/2026-11-13-pass-group-verifier-dollars.md`, "Currencies") fixes the shape of `TokenSpec` and says "symbol 1..=12 ASCII bytes, decimals <= 24", "at most 4, no duplicates". It names no error code for a bad list, does not say whether "no duplicates" means the account, the symbol or both, and does not say where the currency of an operation in flight is kept.

## Decision

- `new` rejects more than 4 tokens with `ERR_LIMIT`, like every other count limit. Every other problem is `ERR_INVALID_TERMS`: a symbol that is empty, longer than 12 bytes or has a byte that is not printable ASCII (`is_ascii_graphic`: no space, no control character); a symbol equal to `NEAR` in any case; more than 24 decimals; the escrow's own account as a token; a token account or a symbol (compared without case) listed twice.
- The event record stores `currency: Option<AccountId>`. An operation in flight does not: `get_operation`, the callbacks and the settlement logs read the currency from the operation's event, which can never change (R5).
- `EventTerms.currency` may be left out of the JSON: serde reads a missing `Option` as `null`, so a v1 client still creates NEAR events. `deny_unknown_fields` stays.
- `storage_per_event` is measured with the currency set to a 64-character token id: 1,213 bytes, 1,456 with the 20% margin (was 1,144 and 1,373). The currency adds exactly its Borsh string (4 + 64 bytes); the unit test asserts it. `storage_per_ticket` does not change, because neither the ticket nor its operation stores the currency.

## Alternatives considered

- Accept any ASCII symbol: a space, a newline or `<` would end up in the token metadata and the drawn ticket, and a token called `NEAR` would make `10 NEAR` mean ten tokens on chain.
- Allow two tokens with the same symbol: `10 tUSD` would no longer say which token was paid.
- Store the currency in each operation: a second copy of a fact the event already holds, and 69 more bytes in the worst-case ticket for nothing.

## Consequences

The deployer cannot list a token whose symbol has spaces or collides with another; such a token would need a different symbol in its `TokenSpec`, which only changes how amounts are written. Nobody can change the list after `new` (R10).
