# The web's entry pass: one click to sign, the pass in the fragment, the door's verdict per device

Date: 2026-11-13. Author: lane P. Status: accepted.

## Context

Task P2 asks for "Show entry pass" on the ticket page, a pass view with a QR code, a countdown and "Sign a new pass", and a `/door` page that checks a pass and remembers admissions on the device. Left open: where the pass view lives, how a signed pass reaches it, what the door shows for a second scan, what a wallet's answer must satisfy before the page shows it, and which QR library.

## Decision

- **Routes.** The ticket page keeps a small "Entry pass" section. Its button asks the wallet to sign inside the click (popup blockers), then opens `/tickets/<id>/pass#p=<pass>`. That page shows the pass from the fragment; without one it offers the same button. `/door` reads `#p=<pass>`. Neither the holder's pass nor the door's input ever leaves the browser: a fragment is not sent to the server.
- **Who sees what.** The button exists only for the signed-in holder of a ticket whose status is `Active` and claim is not `Refunded` (the door's own rule); anyone else reads "Only the holder can show the entry pass for this ticket.", and the holder of a refunded or refunding ticket reads why there is no pass. The pass page shows a pass to whoever has its link, because the link is the pass; only the signed-in holder gets "Sign a new pass". When the chain says the signer no longer holds the ticket, the pass page says it will not admit.
- **The wallet's answer** must come from the signed-in account, and its signature must verify here (the door's `signature` check, run locally) before anything is shown. A wallet whose near-connect manifest lacks `signMessage` gets a sentence, before it opens. A closed popup gets "The wallet did not sign the pass, so nothing is shown. Try again."
- **The door's verdict** is one of three, large: "Admit" (with "Mark as admitted"), "Do not admit" with each failing sentence, or "Already admitted" when this device marked the ticket before ("Already admitted on this device at 21:03"). The five checks follow. "Check again" re-reads the chain and the clock; "Check another pass" clears the fragment and shows the paste box. Admissions live in `localStorage` under `ticket-escrow:admitted:<contract>`, one time per ticket, every access in try/catch; a browser that refuses storage still admits and says a second scan will not be flagged.
- **Demo mode.** The fixture wallet signs with `demoPassKey(account)` and the fixture chain (`createFixturePassChain`) lists that key as the account's only full-access key, so both pages work end to end on demo data; the demo banner marks them like every page.
- **QR.** `uqr` 0.1.3 (unjs, MIT, released 2026-04-03, no dependencies, ESM with types), drawn as one SVG path with low error correction: a door link is about 500 characters, and larger modules scan more easily from a screen.
- Styles live in their own file, `web/src/styles/pass.css`, so the pages do not touch `app.css` while lane W2 changes amounts across the web.

## Alternatives considered

- **Show the pass inside the ticket page.** The QR would share a narrow column with the money panel; a page of its own is what a holder holds up at the door.
- **Keep the signed pass in memory only.** A reload or a tab switch would lose it and send the holder back to the wallet; the fragment keeps it for its five minutes without any storage.
- **A second scan reads "Admit" with a note.** An attendant reads the big word; a second person on the same ticket must not see "Admit".

## Consequences

- The browser history holds pass links. Each expires five minutes after signing.
- Not verified here: a real wallet's `signMessage` (Meteor, Intear). The fixture wallet and a fake near-connect wallet cover the code paths; the near-cli-rs vector covers the signature format. Walter's rehearsal is the first real-wallet run.
  - 2026-11-14: Meteor Wallet's `signMessage` was tried by hand on the hosted site and the door page answered "Admit" ([README, Limits, 10](../../README.md#limits)). Intear's was not tried.
