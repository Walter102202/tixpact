# The door page is one the attendant opens; it names its site, and demo verdicts read as demo

Date: 2026-11-13. Author: lane P. Status: accepted. Replaces the door's intro and verdict words in `2026-11-13-web-entry-pass-pages.md`.

## Context

The integrator's review of P2 (verified against `web/src/features/pass/DoorPage.tsx`): the door's intro said "Scan the holder's entry pass with this phone's camera". A phone's camera opens whatever site the QR names, and the holder makes the QR, so the holder chose the checker. This repository is public; served in demo mode from the holder's own domain, the door said "Admit" in the same words as the live site, and `FIXTURE_CONTRACT_ID` is the live contract id.

## Decision

- The intro no longer mentions the camera: the attendant pastes the pass or its link into a door page they opened themselves.
- The intro and every verdict show the checking site (`window.location.origin`) and one sentence: "Open this page yourself, from your own bookmark: a link or code the holder shows you can lead to a copy of this site that admits anyone."
- In demo mode the verdict words are "Demo: would admit" and "Demo: would not admit", with "Demo data, not the chain: this result admits no one."; the intro and the loading line say "demo data, not the chain".
- `docs/threat-model.md`, "What a pass does not stop", item 7, states the attack and that the attendant's bookmark and address bar stop it, not the page's text.

## Alternatives considered

- **Keep the camera instruction and warn about the address bar.** The attendant would still land on the holder's page; a warning on a page the holder controls proves nothing.
- **Refuse demo passes on non-local hosts.** A copy is modified code; it can remove any such check.

## Consequences

- Without a scanner inside the page, the attendant needs the pass as text (pasted). The plan's last item, a scanner in the door page, closes that gap where the browser can.
- The QR on the holder's pass page still carries a door link: it is what a scanner reads (`decodePass` ignores the host), and a link the attendant can compare with their bookmark.
