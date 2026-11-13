# The ticket's metadata is derived when read: the web's claim words, a cut title, escaped text

Date: 2026-11-13. Author: lane C2. Status: accepted. Builds on `2026-11-12-token-metadata-derived-from-the-event.md`.

## Context

Interface v2 ("The ticket shows its state") fixes the description sentences, the `extra` fields, the amount format and a `media` image of at most 2 KB drawn from "the title, serial, amount, the claim word". It leaves open which word names each claim, how a 120-byte title fits a small image, and how free text from the organizer is put inside an SVG.

## Decision

- Nothing is stored: `nft_token`, `nft_tokens` and `nft_tokens_for_owner` build the metadata from the event and the ticket each time they are read (`contract/src/display.rs`). No change method computes it, so no change method pays gas for it.
- The claim words on the image are the web's (`packages/client/src/format.ts`): `Reserved`, `Claimable`, `Sending`, `Refunded`, `Released to the organizer`. One word, one meaning, in the wallet and on the site.
- The image shows at most 26 characters of the title, the last one an ellipsis when it is cut. Every text node is XML-escaped (`& < > " '`), and control characters, which XML forbids, become spaces. With the longest title made only of the character with the longest escape, the largest amount and a 12-byte symbol of `<`, the image stays under 2 KB (unit test `the_drawn_ticket_is_small_and_escaped_in_the_worst_case`).
- `extra` is serialized from a struct, so its keys come in the order the interface lists them: `event_id, serial, status, claim, outcome, principal, currency`.
- The description and the image use the event's currency through `format_amount`: `1.5 NEAR`, `10 tUSD`. The test `t22_standard_token_surface` changes accordingly: `media`, `media_hash` and `extra` are no longer null.

## Alternatives considered

- The enum names (`Refundable`, `RefundPending`) on the image: they read as code, and the web already says `Claimable` and `Sending`.
- Wrapping the title over two lines: more markup, and wallets show the full title in the metadata anyway.
- A per-claim image stored once: it would still need the amount and the title, which differ per event.

## Consequences

A wallet that caches token metadata can show an old state until it reads the token again; the description and the image are always right when read. The image is a plain SVG that wallets which support `data:` URLs can show; others still have the title and the description.
