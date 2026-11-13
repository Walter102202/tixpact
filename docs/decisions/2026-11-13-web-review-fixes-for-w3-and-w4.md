# An unknown result asks the chain again, and an irreversible step sends exactly what was checked

Date: 2026-11-13. Author: Track W. Status: accepted. Refines `2026-11-13-web-review-fixes-for-w1-and-w2.md`, `2026-11-12-web-organizer-and-verifier-pages.md` and `2026-11-12-web-proof-page-and-state-sweep.md`.

## Context

The W3 review (`C:\dev\near-project-reports\review-w3.md`) and the integrator's W4 review found these problems:

- "Read the page again" brought the create button back without any read, so a second click could create a second event and spend a second budget.
- The verifier's second click sent whatever the field held at that moment, under whatever account was signed in.
- Amounts the person approves were cut to 4 decimals.
- A mistyped verifier locked the storage budget for good.
- The organizer was never offered the cancel the contract allows.
- A failed budget read gave no reason.
- The time-zone test computed its expected values with the same call as the code.
- The proof page compared the balance with the ticket money only.
- The error page said "Nothing was sent", which it cannot know.

## Decision

1. **Unknown results.** Every `useTx().run` takes a refresh; the type requires it. When the result is unknown, "Check again" first asks the chain for the result by hash. If the chain answers, the page ends as after a normal send. If it does not, the page is read again, and only a successful read brings the actions back. The create form's refresh re-reads the organizer's events, which the Organize page now loads once and shares between the form and "Your events". Its key is the list of event ids.
2. **Second clicks.** The first click stores the decision, the trimmed reference it checked, and the account. The second click sends that stored reference. The box shows it ("Reason kept on chain: ..."), and the field is locked while the box is open. The box closes when the account changes and shows only while the decision is still allowed. The page is not keyed by account, because that would drop the status of a transaction in flight.
3. **Amounts.** A price may have at most 4 decimals, that is a multiple of 10^20 yoctoNEAR ("Use at most 4 decimals."). The verifier page shows the exact price. The storage budget line and the whole payout box show exact amounts.
4. **Accounts.**
   - The verifier cannot be the contract.
   - A named verifier or transfer target must exist: "No account named <id> exists on testnet." While a named account does not exist, anyone can register it.
   - The check uses `Reader.accountExists?`, an optional client member. It returns false only when an endpoint answered `AccountDoesNotExistError`. An outage throws, and the form then says it could not check and sends nothing.
   - Implicit ids are not checked: they are bound to a key and exist once funded.
   - The transfer is checked at its Review click. The wallet click stays synchronous.
5. **Cancel.** Each of the organizer's events offers "Cancel event" in its row while the contract would take it (R2: unresolved, before the deadline). It takes the same second click and sends no reason. The verifier page gives each non-verifier a reason per action, and tells the organizer to cancel from the Organize page.
6. **The create form waits honestly.** A failed budget read says "Could not read the storage budget." and offers "Try again". Every disabled create button says why. A quote, or a verifier check, counts only for the value now in the field.
7. **Times.** `parseLocalTime(value, timeZone)` reads the wall clock in the zone the form names, through `Intl`. Impossible dates are refused. The web tests run with `TZ=UTC`, unlike their display zone (America/Santiago), and assert literal instants.
8. **Demo and lagging reads.**
   - After a confirm or a cancel succeeds, the verifier page offers no other decision.
   - A demo create says no event was created instead of linking to the recorded event 9.
   - The organizer's row reads "Open for refunds" after a done cancel.
   - A past-deadline row says nobody can confirm any more.
9. **Proof and error page (W4).**
   - The proof page compares the balance with `principal_reserved` plus `organizer_available`, summed over every event, as the contract's invariant and `scripts/verify-deployment.mjs` do.
   - The error page no longer claims nothing was sent.

## Alternatives considered

- **Check again by reading the page only.** On the create form the page shows no change the person would notice, so the button would come back with a create possibly landed.
- **Key the verifier page by account.** It closes the box, but it also forgets a transaction in flight and its unknown-result guard.
- **Check implicit accounts too.** That would refuse an unfunded implicit receiver, which is legitimate and cannot be taken by anyone else.
- **Organizer cancel on the verifier page.** The integrator chose the organizer's row. The verifier page stays the verifier's.

## Consequences

- If the chain never answers and the page cannot be read, the actions stay hidden until the page is reloaded.
- A transaction that lands only after both the second chain check and a successful read could still be followed by a second click. The chain check narrows that window to a transaction still pending after about 40 seconds.
- Typing a valid named id costs one `view_account` read per distinct value.
- The organizer's cancel stores no reason.
