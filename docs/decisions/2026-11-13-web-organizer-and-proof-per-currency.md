# The organizer picks a currency, a payout in a token checks registration, and the proof compares each currency on its own

Date: 2026-11-13. Author: lane W2 (task W7). Status: accepted. Builds on `2026-11-13-web-prices-in-a-token.md`.

## Context

Task W7 (plan `2026-11-13-pass-group-verifier-dollars.md`) asks for a currency picker with the price in its units, a registration check before a payout, and a proof page that shows, per currency, what the contract holds next to what it owes. It does not say how fine a token price may be, when the picker shows, or how the proof reads a token's balance.

## Decision

1. **Currency picker.** A "Currency" select (NEAR, then each token as "tUSD (the token tusd.testnet)") sits before the price. It shows only when `get_config` lists a token, so a v1 deployment's form is unchanged. The price label follows it ("Price in tUSD"). The terms always carry `currency`, `null` for NEAR. The storage budget stays in NEAR, and the hint says so.
2. **Price precision.** A price may have at most `min(4, decimals)` decimals in every currency. That is the rule NEAR prices had, because facts are rounded to 4 decimals and a finer price would be paid unseen.
   - A number with more decimals than the currency has reads "Use at most 4 decimals.", not "Enter a price".
   - The other errors name the symbol ("The price must be above 0 tUSD.").
3. **Payout.** An organizer's row shows its amounts in the event's currency. For a token event with something to collect, the organizer's registration is read first.
   - Not registered: the one-step registration replaces "Collect", because the token would refuse the transfer and the amount would stay available.
   - Registration unreadable: "Collect" stays with a sentence, as for the claim.
4. **Proof.**
   - The NEAR facts keep their labels and now sum only events priced in NEAR.
   - Each token in `get_config.tokens` gets its own section, "In tUSD". It shows the contract's balance at the token (`ft_balance_of`), what tUSD events reserve for holders and what they owe organizers, and its own verdict.
   - A listed token appears even before any event uses it.
   - A failed token read fails the whole page ("Could not read the chain."), as any other read does, so no stale number shows.

## Alternatives considered

- One combined verdict over all currencies: the amounts cannot be added, and a shortfall in one currency would hide behind a surplus in another.
- Showing the picker always, with NEAR alone: it adds a control that decides nothing on v1.
- Cents (2 decimals) for dollar tokens: a second rule to explain; one rule for every unit is easier to check.

## Consequences

The proof page makes one more view call per accepted token (at most 4). Events in a token can be created from the web as soon as the contract accepts one. The plan's cut order can still drop the picker, and then events in dollars are created by script.
