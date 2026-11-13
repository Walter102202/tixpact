# The ticket page shows the ticket as wallets show it, checked against its hash

Date: 2026-11-13. Author: lane W2 (task W9). Status: accepted.

## Context

Contract v2 computes each ticket's NEP-177 metadata from its state at every read (plan v2, "The ticket shows its state"; `contract/src/display.rs`). The description ends with where the money stands, and the media is a drawn SVG with its SHA-256 in `media_hash`. Until now no screen of the app showed it, so a judge had to open a wallet to see it. Task W9 asks for it on `/tickets/:id`. It leaves open the reader's shape for odd answers, how demo mode draws, and what the page says.

## Decision

1. **Client.**
   - `Reader.ticketDisplay(tokenId)` reads `nft_token` at `final` and returns `{ title, description, media, mediaHash }`, each `null` when the metadata leaves it out, or `null` for a missing ticket.
   - `media` is kept only when it is `data:image/svg+xml;base64,` followed by base64. Any other value, a non-string included, reads as `null`, never an error.
   - The method is optional on `Reader`, like `readGroupVerifier`, so the agent's and the tests' hand-built readers stay valid. Both real readers implement it.
   - `mediaMatchesHash` checks SHA-256 of the SVG bytes against `mediaHash`, with the same `@noble/hashes` the entry pass uses. It needs no `crypto.subtle`, which is missing outside secure contexts.
2. **Demo mode draws as the chain.**
   - `drawTicket` and `ticketDisplayFor` mirror `ticket_svg`, `description`, `escape_xml` and `short_title`: the same words (`CLAIM_LABELS`), colours, sentences and 26-character title cut, counted in code points as Rust counts `chars`.
   - A test rebuilds ticket 3-1 of `te-d5-escrow.testnet` (read on 2026-11-13, refunded, 10 tUSD) and gets the chain's 711 bytes and `media_hash` exactly.
3. **The page.**
   - A section "As wallets show it" sits under the ticket's facts. It shows the picture in an `<img>`, never as inline markup, with the description as alt text. Below come the description sentence and one line: "The contract computes the picture and this sentence at every read, so they change with the ticket. The picture matches the hash the contract gives."
   - A picture whose hash does not match is not shown, and the section says so.
   - The read has its own load. While it loads, or if it fails, the section is absent and the rest of the page is unaffected.
   - Its key includes the ticket's holder, status and claim, so a claim or a transfer that the page reads back reads the picture again.
4. **Hosting.** Nothing blocks a `data:` image on the hosted build: `vercel.json` sets no headers, `index.html` has no Content-Security-Policy, and its favicon is already a `data:image/svg+xml`. No CSP is added.

## Alternatives considered

- Rendering the SVG inline (`dangerouslySetInnerHTML`): it would run whatever markup a hostile contract or a node in the middle put there; an `<img>` runs no script.
- Hashing with `crypto.subtle`: unavailable on plain `http` origins and in some test environments; the noble hash is already in the client.
- A required `Reader` method: it would break readers written for the agent's tests, for no gain on the page, which treats a missing display like a failed one.

## Consequences

Before a v2 deployment is live, demo mode is where a judge sees the drawn ticket. On a v1 contract `nft_token` has no media, and the section shows only the description, if there is one.
