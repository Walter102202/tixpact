# The landing states the problem and plays the refund: the choices the plan left open

Date: 2026-11-13. Author: Track W. Status: accepted. Applies `docs/plans/2026-11-13-landing-problem-and-motion.md` (Task W5); this record covers only what that plan did not fix.

## Decisions

1. **Motion is decided once, when the page mounts.** Content is visible by default. A section waits hidden (`reveal-wait`) only when `IntersectionObserver` exists and reduced motion is not requested; both are read at mount, so a section never hides after it has been shown. Under `prefers-reduced-motion: reduce` the CSS also turns every transition and animation off, as a second guard.
2. **The floating header is `position: sticky`, not `fixed`.** It stays in the document flow, so the demo banner and the hero need no top offset and the other routes are untouched. Under 760 px the header wraps to three rows, so there it floats at the top of the page but does not follow the scroll: a sticky header would cover about a fifth of a phone screen.
3. **Section eyebrows.** "01 · The problem" as the plan writes it, because its heading is a claim ("A refund is only a promise."). Sections 02 and 03 show only the number: their headings already are the plan's titles, and repeating them in the eyebrow would say the same thing twice.
4. **The claim word at beat 3 is "Claimable".** The plan fixes the pill (the label of `Expirable`) but not the claim word. Past the deadline the holder can already claim, and the ticket page shows `CLAIM_LABELS.Refundable` ("Claimable") in that state, so the replay shows the same word.
5. **The terminal adds only lines that start with `#`.** The over-the-cap run used an exposure cap of 0.5 NEAR, and the watcher run depends on event 2's deadline; a muted `#` line says so before each. Every other line is copied from `docs/mcp.md`, section "Verification", and every hash is a real link to the explorer.
6. **The cap meter is a `figure` with its numbers in text.** "0.5 NEAR of 5 NEAR in tickets" and "per-ticket cap 2 NEAR" are text; the bar is `aria-hidden`. Biome rejects `role="group"` on a `div` (`useSemanticElements`), and a figure with a label is the right element for a captioned graphic.
7. **"Replay" appears when the replay ends.** While it plays the button is disabled and transparent; under reduced motion there is no replay, so there is no button.
8. **The event facts sit in fixed columns, only in the events list.** On a wide screen price, verifier and status take 7.5, 12.5 and 12.5 rem, and the status pill does not wrap. Below 1080 px the facts move under the title before the columns get squeezed. At 760 px and below, price and status share a row (2fr and 3fr, wide enough for "Awaiting confirmation" at 375 px) and the verifier takes the next row, in every row. The rule is scoped to `.event-row`, so "My tickets", which reuses the class with other facts, keeps its layout.
9. **The press response covers `.btn`, the chips and the Replay button**, never a disabled control (`:active:not(:disabled)`).
10. **Styles live in `web/src/styles/landing.css`**, imported after `app.css`. Four tokens were added to `tokens.css`: `--ease`, `--radius-pill`, `--float-shadow` and `--window-shadow`. No animation library.

## Checked in a browser

Production build, 1280 px and 375 px, with and without reduced motion:
- the header floats and stays on top at 1280 px; `/proof` keeps the plain header;
- the replay plays its five beats, then shows "Replay";
- the chips switch the run by click and by arrow key, with focus following;
- the event facts line up in every row at both widths;
- no horizontal scroll, and no console warning or error.

## Consequences

- The landing's look now depends on `landing.css`. The tests check structure and text, not layout. The column alignment was checked by measuring in the browser.
- If a status label grows longer than "Awaiting confirmation", the 12.5 rem column must grow with it.
