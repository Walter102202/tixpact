# The ticket page: when the claim and the transfer are offered, and what counts as paid

Date: 2026-11-12. Author: Track W. Status: accepted.

## Context

Task W2 fixes the claim button and the transfer sentence (plan, "Task W2") and the integrator fixed when the claim shows (`2026-11-12-claim-shown-when-event-is-expirable.md`). Five details were still open: the word for a `Reserved` ticket that can be claimed, what the page shows once a claim or a transfer was sent, how a transfer is confirmed, how much of a paginated view is read, and where the claim rule lives.

## Decision

1. `canClaimRefund(ticket, event)` lives in `@ticket-escrow/client` (`packages/client/src/rules.ts`), so the MCP server can use the same rule. It also requires ticket `status` `Active`: a ticket locked by a transfer or a refund is never claimable.
2. The claim word is "Claimable" whenever `canClaimRefund` is true, so a `Reserved` ticket past the deadline reads "Claimable" in `/tickets` and on its page. "Claimable" keeps one meaning: you can claim it now.
3. A claim counts as paid only when `moneyMoved(result)`: every receipt succeeded and the contract returned `true`. Anything else shows "The payment did not complete." with the failed step when there is one, and the page re-reads the ticket. After a paid claim the button is not offered again on that page, even if the re-read is stale.
4. A transfer takes two clicks: "Review transfer" checks the account id (protocol rules, not the current holder) and shows a box with the account in full and "You will lose the right to the refund."; only "Transfer ticket 1-3 to <account>" sends it. The form exists only for the holder of a `Reserved` ticket and is disabled, with the reason, when R6 forbids the transfer (after the start, or with a transfer or refund in flight).
5. `/` and `/tickets` read their paginated view to the first empty page (`web/src/lib/pages.ts`), because the contract may answer with fewer than the limit asked (`max_page`).

## Alternatives considered

- Show "Reserved" for an expirable ticket and rely on the deadline line: the list would hide that money is waiting for the holder.
- Treat `result.ok` as paid: misses a callback that returned `false`, which the reviewer reproduced in W0.
- One-click transfer: a typo would hand the refund right to a stranger with no chance to look.
- Check that the destination account exists before the transfer: worth doing, but it needs a reader call that tells "no such account" from "RPC down", which the client does not expose yet. Left for after submission; the confirmation box writes the account out in full.

## Consequences

A ticket sent to a mistyped account that does not exist is lost to its sender; the refund to it would fail and restore the claim (t10). In fixture mode the data does not change, so after a demo claim the page shows "Refunded 1.5 NEAR to luis.testnet." under a ticket that still reads "Claimable"; the demo banner covers it.
