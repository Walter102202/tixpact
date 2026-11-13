# The door checks every new fragment, dates every verdict, and Undo says what it did

Date: 2026-11-13. Author: lane P. Status: accepted. Adds to `2026-11-13-door-records-admission-with-the-verdict.md` (its Undo and its "Check again" sentence are replaced here).

## Context

The integrator's final review of lane P: the check was keyed by the pass, so the same pass arriving again with a changed link (`&x=1`) ran no new check and an old "Admit" stayed; "Check again" after an Admit lost the Undo; a failed Undo changed nothing on screen; after a successful Undo the big word still read "Admit".

## Decision

- The check is keyed by the URL fragment: any change of it starts a new check. Every verdict ends with "Checked at HH:MM:SS", so a verdict left open from earlier shows its age. (A browser fires no event when the identical link is opened again in the same tab; the time is what shows that.)
- Undo removes the admission this door check recorded, on the verdict that recorded it and on the "Do not admit" of a later "Check again" in the same check. An admission recorded by another check (another visit, another fragment) has no Undo: it is what the door must flag.
- After a successful Undo the verdict becomes "Admission removed": "This device no longer remembers ticket 1-3 as admitted. Check the pass again before letting anyone in.", with "Check again". A failed Undo says "The admission could not be removed: it stays recorded on this device." and keeps the verdict.

## Alternatives considered

- **Say only that the admission stays recorded after "Check again".** The attendant who scanned by mistake would have no way back from that screen.

## Consequences

- Tests: the same pass with `&x=1` (fails if the check is keyed by the pass), "Check again" after an Admit, Undo there, a failed Undo, "Admission removed".
