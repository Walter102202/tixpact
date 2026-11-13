# Organizer and verifier pages: checks before the wallet, a second click for irreversible decisions

Date: 2026-11-12. Author: Track W. Status: accepted.

## Context

Task W3 asks for client-side validation with the contract's limits, the storage budget, three sentences, verifier actions gated by account and window, and a payout button (plan, "Task W3"). Open: which clock judges the windows, how the budget reaches the wallet, whether "Confirm" and "Declare cancelled" need a second click, how the payout button is worded, and how a demo viewer reaches these pages without a wallet.

## Decision

1. The create form checks every rule `create_event` checks (non-empty title and venue within `max_title_bytes` and `max_venue_bytes` counted in UTF-8 bytes, `now < start < end < deadline`, price above 0, capacity 1 to `max_capacity`, a valid verifier that is not the organizer) and sends nothing while any fails. Limits come from `get_config`; the start is checked against the viewer's clock (`AppServices.now`, the fixture clock in demo mode), and the contract checks again at block time. Times are entered in the viewer's zone, which the form names.
2. The budget is `quote_event_budget(capacity)`, read while the organizer types. The submit button waits for it and sends exactly that amount; it is never fetched after the click, because the wallet popup must open inside the click.
3. Verifier windows are judged at the event's `now_ms`, the chain time of the read: Accept while not accepted and `now < starts_at_ms`; Confirm while accepted and `ends_at_ms <= now < resolution_deadline_ms`; Declare cancelled while `now < resolution_deadline_ms`; all only for `verifier_id` and only while `Unresolved`. Each disabled button says why.
4. "Confirm the event took place" and "Declare cancelled" open a confirmation box that says the decision cannot be undone; only its second button sends. Accept is one click. The optional evidence or reason is checked against `max_ref_bytes` before the box opens.
5. The payout button reads "Collect 4.5 NEAR to org.testnet": the plan's "Collect 4.5 NEAR" plus the destination, per the rule that buttons that move money name both. It appears only when `organizer_available` is above zero, counts as paid only with `moneyMoved`, and a pending payout reads "Sending 4.5 NEAR to org.testnet." with no button.
6. In demo mode the banner has a "Demo account" picker (luis, ana, org, teatro), so the organizer and verifier pages can be walked without a wallet. It never appears on live data.

## Alternatives considered

- Validate only in the contract: every typo costs a wallet round trip and a fee.
- Judge the verifier windows with the viewer's clock: the page could offer a button the contract rejects, or hide one it would accept, when the clock is off.
- One click for Confirm and Cancel: both end the event for good and move everyone's money; the wallet's own screen shows a generic call.

## Consequences

A page left open across a window boundary still shows the window of its last read; the contract rejects a late click with its error, which the page shows. The demo picker is code in the shell that only fixture mode reaches.
