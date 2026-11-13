# Task W5: the landing states the problem and plays the refund

Addendum to `2026-11-12-ticket-escrow-mvp-plan.md`, Track W. Written on 2026-11-13. The working conventions, the quality bar and the definition of done of that plan apply here unchanged.

**Why.** On 2026-11-13 Walter looked at the landing. He likes the look. Two things are missing: the page opens with the solution and never states the problem, and he asked for the kind of motion used on the landing of another project of his.

**Reference, read-only.** `C:\dev\dealingwith-si\apps\web\src\landing\`: `Reveal.tsx`, the "Motion" block of `Landing.module.css`, `AppReplay.tsx`, `AgentTerminal.tsx`, `Story.tsx`. Read those files only; never an `.env` file. Port the ideas into this project's plain CSS and tokens; copy no brand, colour or font from there.

**Files.** New folder `web/src/features/landing/` (`Problem.tsx`, `Replay.tsx`, `AgentTerminal.tsx`, `Reveal.tsx`, `landing.test.tsx`). Modify `web/src/features/events/HomePage.tsx`, `web/src/styles/app.css` (or a new `web/src/styles/landing.css`), the banner in `web/src/ui/Shell.tsx`.

## Global constraints

- Tokens only: no new colour, font, radius or shadow outside `web/src/styles/tokens.css`. No animation library.
- Every motion is switched off under `prefers-reduced-motion: reduce`, and nothing is ever hidden when `IntersectionObserver` is missing: content is visible by default in that case.
- The replay and the terminal are illustrations. Each one says so in visible text and links to `/proof`. Words for phases and claims come from `@ticket-escrow/client` (`PHASE_LABELS`, the claim words), never retyped.
- The three facts below are the only numbers in the problem section. Use these exact words and links; they were checked against their sources on 2026-11-12. Add no other figure and no sentence that says more than the source.

## The landing, in order

1. **Hero.** Keep the headline and the ticket stub. Add one line above the headline (an eyebrow): "When an event is cancelled, your refund depends on the seller still having your money." The text and the stub rise in on load.
2. **01 · The problem.** Title: "A refund is only a promise." Lede: "Today the ticket money goes to the seller the day you pay. If the event is cancelled and the money is gone, nobody can give it back." Three cards, each with a large figure, one sentence and a source link (`target="_blank" rel="noreferrer"`):

   | Figure | Sentence | Source label | Link |
   |---|---|---|---|
   | $9 million | A ticketing company "relied on incoming funds from new ticket sales to cover its costs and debts". It was ordered to pay about $9 million to an estimated 45,000 organizers and buyers. | Washington State Attorney General, 2021 | `https://atg.wa.gov/news/news-releases/ag-ferguson-brown-paper-tickets-will-fully-refund-event-organizers-ticket-buyers` |
   | $300,664 | A festival's operator "owed more than $7 million to over 900 creditors" with "only $300,664 in the bank". | ABC News, 2026 | `https://www.abc.net.au/news/2026-06-11/byron-bay-bluesfest-report-reveals-debt/106769938` |
   | 620 | About 620 complaints for one cancelled match remain unresolved, most of them for money not refunded; one of the producers could not be found. | SERNAC, Chile's consumer agency, 2026 | `https://sernac.cl/portal/604/w3-article-89234.html` |

3. **02 · How it works.** The three steps that exist today, and next to them a replay titled "Watch a ticket when the organizer disappears". It is the ticket stub and the status pill of the real pages, played through these beats, each with one caption:
   1. "Ana buys a ticket. 1.5 NEAR is reserved in the contract." (pill: the label of `OnSale`; claim word of `Reserved`)
   2. "Ana gives the ticket to Luis. The refund right goes with it." (holder changes to `luis.testnet`)
   3. "The organizer goes silent. The deadline passes with no confirmation." (label of `Expirable`)
   4. "Anyone switches the event to refunds." (label of `Refundable`)
   5. "Luis claims. 1.5 NEAR goes back to luis.testnet." (claim word of `Refunded`)

   It starts the first time it scrolls into view, takes about 9 seconds, and has a "Replay" button. Under reduced motion it shows the last state and the five captions as a plain list. Below it: "A replay with demo data. The real transactions are on the Proof page." with the link.
4. **03 · An agent can hold tickets too.** A terminal that types the agent's real testnet output, taken from `docs/mcp.md`, section "Verification": the purchase within the caps, the denial by the exposure cap, and the watcher's `expire_event` and `claim_refund` lines with their explorer links as real links. Label: "Real output on NEAR testnet, 2026-11-13." Under reduced motion all lines are shown at once. Do this section last; leave it out, and say so in the report, if it would put the rest at risk.
5. **Events.** Unchanged content. The three facts of each row (price, verifier, status) sit in the same columns in every row on a wide screen, and wrap the same way in every row at 375 px.

Sections 2 to 5 rise out of a soft blur the first time they scroll into view (the `Reveal` idea), with a short stagger between the cards of one section.

## Motion and shape from David Astudillo's landing (added 2026-11-13 10:20)

Walter asked again, by name, for the effects David Astudillo built for that landing (its commit `441c687`: "pill controls and an editorial landing"). Bring these five, each adapted to this project's tokens:

1. **Floating translucent header.** On the landing the header is a pill that floats over the page, with a blurred translucent background, a hairline ring and a soft shadow, and it slides in on load (`LandingHeader.module.css`, `navIn`). The other routes keep the plain header.
2. **Press response.** Buttons and pills shrink slightly while pressed (`Button.module.css`: `transform: scale(0.965)` on `:active`, with a transition), everywhere in the app, never on a disabled control.
3. **The replay inside a window.** The ticket replay of section 02 sits in a browser-window frame: a chrome bar with three dots, an address pill that reads the page it shows (for example `/tickets/1-1`) and the "Replay" button (`AppWindow.module.css`).
4. **Chips on the terminal.** The agent terminal of section 03 has "Try it" chips that pick which real run is typed (`AgentTerminal.tsx`): `/within-caps` (the purchase), `/over-the-cap` (the denial), `/refund-watcher` (the watcher's two lines). The chips are a tab list, reachable by keyboard.
5. **A cap meter.** Next to the terminal, a meter of the agent's exposure cap as it stood in the real run (`Agents.tsx`, the mandate meter): "0.5 NEAR of 5 NEAR in tickets", with a mark at the per-ticket cap of 2 NEAR. The numbers are the ones in `docs/mcp.md`; the fill animates in once when it scrolls into view.

All five follow the global constraints above: tokens only, off under reduced motion, nothing hidden without `IntersectionObserver`.

Tests to add: the chips switch the run that is shown and work with the arrow keys; the meter states its three numbers in text (not only as a bar); the landing header is the floating one on `/` and the plain one on `/proof`.

## Also

- Demo banner: "Demo data: nothing on this page is on chain." The environment variable is explained in the README, not in the interface.

## Tests (write them first)

- The problem section renders the three figures, each with a link whose `href` is exactly the one in the table.
- Under reduced motion the replay shows the last state (the claim word of `Refunded`, holder `luis.testnet`) and all five captions; with motion (fake timers) it shows the beats in order, and "Replay" starts again from the first.
- With `IntersectionObserver` undefined, every section is visible.
- The headings of the landing appear in the order above.
- The existing landing tests still pass: the events list keeps its price, verifier and status.

## Done

`bash scripts/gate.sh web` passes. Look at the page yourself at 1280 px and 375 px, with and without reduced motion. One commit, `feat(web): the landing states the problem and plays the refund`, pushed. Report in `track-w.md`, then one line to the integrator.
