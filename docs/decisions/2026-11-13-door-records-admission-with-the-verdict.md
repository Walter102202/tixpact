# The door records an admission with its "Admit" verdict; a ticket admitted here reads "Do not admit"

Date: 2026-11-13. Author: lane P. Status: accepted. Replaces the door's "Mark as admitted" button and "Already admitted" verdict in `2026-11-13-web-entry-pass-pages.md`.

## Context

The integrator's review of P2: "Already admitted" alone read as an OK; the admission was recorded only on a button the attendant could forget, so a screenshot shown again within five minutes read "Admit"; the storage key did not include the mode, so a demo on localhost marked the live ticket 1-3; and the pass page kept a QR for a ticket refunded after signing.

## Decision

- **Recorded with the verdict.** When the five checks pass and this device has no admission of the ticket, the check records `{ at, check }` under the ticket in `localStorage` and the verdict says "This device now remembers ticket 1-3 as admitted at 21:03:10", with "Undo: scanned by mistake", which forgets it only if this check recorded it. A browser that refuses storage gets the sentence that a second scan will not be flagged.
- **Check ids.** React runs a page's effects twice in development (`StrictMode` in `main.tsx`), so a check runs twice. Each check has a random id (per page visit and attempt); a record carrying the check's own id is its own, not an earlier admission. A test renders the door under `StrictMode`; without the ids it reads "Do not admit".
- **A ticket admitted here.** Any later pass of that ticket, even a new one, reads "Do not admit" (or "Demo: would not admit"), with "Already admitted on this device at 21:03:10." under it. "Check again" after an "Admit" is a new check, so it reads the same.
- **Per mode.** The key is `ticket-escrow:admitted:<demo|live>:<contract>`.
- **The pass page** shows no QR, countdown or door link when the ticket read at load is refunded, being refunded, on its way to another account, or held by another account; it says why. It reads the ticket once per load.

## Alternatives considered

- **Keep the button.** The forgotten press is the failure the review found.
- **Record when the attendant leaves the verdict.** No reliable event on a phone; a closed tab would admit twice.

## Consequences

- A mistaken scan admits the ticket on this device until "Undo" is pressed on that verdict; after that the record stays until the browser's data is cleared.
- Records written by the P2 commit (a bare number per ticket, under a key without the mode) are not read. Nothing was released with them.
