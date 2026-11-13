# After a token transaction, the web says what happened to whom, in plain words

Date: 2026-11-13. Author: lane W2 (integrator's review of W6/W7). Status: accepted. Amends `2026-11-13-web-prices-in-a-token.md` and `2026-11-13-web-organizer-and-proof-per-currency.md`.

## Context

The integrator's review of W6/W7 found two must-fixes:

- A refund or payout that the token refused showed the generic "Failed step: the transfer to tusd.testnet." and the token's panic.
- A finished faucet or registration result stayed on screen after the account or the receiver changed, naming the account now signed in.

It also found three smaller issues:

- No screen said what tUSD is.
- A change of currency after typing a price changed its meaning silently.
- After a purchase, the balance was read only once.

The review left the exact rules open.

## Decision

1. **Refused refund or payout.** A failure whose failed receipt ran on the event's currency (`failedReceipt.executorId === currency`) gets its own words.
   - Always: "Nothing was paid".
   - "nothing was lost" and the sentence that the right is back ("The claim is back on the ticket.", "25 tUSD is available to collect again.") appear only when the page, read again, shows it back. If the callback also failed, nothing is promised.
   - The cause is named as "not registered" only when the token's panic says "is not registered" (the near-contract-standards message). Then it adds "Register X with tUSD, then claim (collect) again." Any other refusal names the token and keeps its message.
   - The holder's or organizer's registration is read again after such a failure, so the one-step registration replaces Claim or Collect when that was the cause.
   - A NEAR failure keeps the generic words. `TxStatus.failureBody` falls back to them when it returns `undefined`.
2. **One result, one account.**
   - The token buy panel is one panel per signed-in account (`key`).
   - A new transfer review dismisses the last registration.
   - The faucet's result names its signer (the faucet mints to its caller). A registration's result names the account it was sent for, captured at the click.
3. **Test money.** A token listed in the build's faucet tokens (`VITE_FAUCET_TOKENS`) is called "a test dollar with no value" in the "Paid in" fact, the currency picker and the proof section. The faucet list is the deployment's statement that a token is test money. Never "USDC", never "dollars" alone.
4. **The create button names the price.** Example: "Create the event at 10 tUSD a ticket and pay 0.7 NEAR of storage". The price appears only while it is valid in the chosen currency, so a change of currency after typing shows at once. "of storage" replaces "to the contract", so the budget cannot be read as ticket money.
5. **Balance after a purchase.** After a ticket was bought, the balance is read until it differs from the balance at the click, with the same retry settings as every re-read. After a purchase that did not happen, and in demo mode, it is read once.

## Alternatives considered

- Matching the refusal on the failed step `other`: a NEAR refund's failure to a deleted account is also `other`, and it must keep its own words.
- Saying "the claim is back" from the failure alone: wrong when the callback failed too and the ticket stays locked.
- Naming test money by symbol ("tUSD" means test): a symbol proves nothing; the faucet list is what the deployment declares.

## Consequences

Before a transaction, a test token in a build without `VITE_FAUCET_TOKENS` is named only by its symbol and account. The integrator sets that variable when v2 ships.
