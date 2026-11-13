# Token metadata is derived from the event, not stored per ticket

Date: 2026-11-12. Author: Track C. Status: accepted.

## Context

The standard token storage can keep a `TokenMetadata` per token (`near-contract-standards` 5.30.1, `core_impl.rs`, `token_metadata_by_id`). The plan asks for `nft_token` and `nft_metadata` to match the standard (`t22`) and for each event to prepay the worst-case storage of its tickets (R9). A ticket's title and description only repeat facts of its event, which never change (R5).

## Decision

- `NonFungibleToken` is built without the metadata prefix, so nothing is stored per token besides the owner and the owner index. Approvals are also off (no approval prefix).
- `nft_token`, `nft_tokens` and `nft_tokens_for_owner` return `metadata` built on the fly from the event and the ticket: `title` "<event title> - ticket <serial>" and a `description` with the serial, the capacity, the venue and the refund promise. Every other metadata field is `null`. `approved_account_ids` is `null`.
- `buy_ticket` calls `internal_mint_with_refund(token_id, buyer, None, None)`: no metadata to store and, above all, no refund account (the plan's trap: a refund account would send the principal back).

## Alternatives considered

- Store the metadata per token: about 300 more bytes per ticket for text that can never differ from the event's, and a second copy that could drift if a later change touched only one of them.

## Consequences

Wallets and explorers see a normal NEP-177 token. A field that needs the mint time (`issued_at`) is left out; the ticket history has it.
