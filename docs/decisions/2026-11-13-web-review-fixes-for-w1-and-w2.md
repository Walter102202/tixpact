# After a transaction the page compares only what it changed, and an unknown result holds every action

Date: 2026-11-13. Author: Track W. Status: accepted. Refines `2026-11-12-web-ticket-page-claims-and-transfers.md` and `2026-11-12-web-demo-data-without-a-contract-id.md`.

## Context

The W1 and W2 reviews (integrator messages of 2026-11-12 and `C:\dev\near-project-reports\review-w2.md`) found, and the integrator verified: every live view carries `now_ms`, so comparing whole views made `readUntilChanged` call the first stale read new; a sent transaction with an unknown result left its button enabled, so a second click could pay twice; money buttons rounded to 4 decimals; the transfer form accepted ids nobody can sign for on testnet; several texts claimed more than the chain said.

## Decision

1. `Refresh` (`web/src/lib/near/useTx.ts`) takes a required `key`: the part of the page the transaction must change. Purchase: `event.sold` and the accounting row. Claim and transfer: the ticket's owner, status, claim and pending operation. Payout: the accounting row. Verifier decisions: acceptance, outcome, reason and reference. The re-read reports `caught-up`, `behind` or `failed`, and every page says which.
2. A transaction whose result cannot be read (`unconfirmed`) counts as busy: every action that could send money stays hidden. The page is read once at that moment; "Read the page again" reads it again and only a successful read brings the actions back. The explorer link is shown.
3. A failure note that says the page was read again appears only when it was; otherwise "The contract could not be read again; reload this page."
4. A button that moves money shows the amount with every digit (`nearExact`); lists and facts keep 4 decimals.
5. Transfers and verifier fields accept only `.testnet` ids, 64-hex implicit ids and `0x` + 40-hex ids ("Testnet accounts end in .testnet.").
6. The success line names the account that signed, from the wallet's answer at the click. The fixture wallet signs as the account signed in.
7. One live region per transaction (`role="status"`, present before the click); failures inside it are alerts. When the clicked button disappears, focus moves to it.
8. Wording: a released ticket reads "Released to the organizer" (R11); a pending refund no longer promises a later confirmation; a failed callback adds "The transfer to <account> ran, but the contract could not record it. The ticket stays locked."; a refundable ticket that cannot be claimed reads "Reserved".

## Alternatives considered

- Strip `now_ms` before a whole-view comparison: any other field that moves on its own (a sale by someone else) would still count as this transaction's change.
- Let the person dismiss an unknown result without a read: the dismissal itself would bring back the button that can pay twice.

## Consequences

Each new transaction on a page must name its key; forgetting is a type error. A page whose re-read keeps failing keeps its actions hidden until it is reloaded.
