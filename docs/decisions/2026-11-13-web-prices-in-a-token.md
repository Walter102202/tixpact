# The web shows every amount in its event's currency and checks token registration before money moves

Date: 2026-11-13. Author: lane W2 (task W6). Status: accepted.

## Context

Interface v2 (plan `2026-11-13-pass-group-verifier-dollars.md`, "Currencies") prices an event in NEAR or in a NEP-141 token. The plan names the pieces (`formatAmount`, `purchaseResult`, the registration and faucet builders) but leaves open how the screens round, when a token purchase may say the money came back, where registration is checked, and how the web knows a token has a faucet.

## Decision

1. **Amounts.** Every amount goes through `formatAmount` in its event's unit: `money()` rounds toward zero to 4 decimals for facts and lists (the NEAR rule since W0), `moneyExact()` writes every digit on buttons, the verifier's price and the payout box. NEAR amounts that are NEAR whatever the event (storage budget, registration deposit, contract balance) keep `near()`/`nearExact()`, now built on the same two. A NEAR event needs no extra read; a token's symbol and decimals come from `get_config`, read once per reader (the list is fixed at `new`) and read again after a failure.
2. **Which token.** Event and verifier pages add a "Paid in" fact naming the token contract, linked to the explorer. The buy note says the wallet will show a call to that token, with 1 yoctoNEAR, because the wallet's receiver is the token, not the escrow. The connector sends a call to `call.receiverId ?? contractId` (`transactionFor`, tested without a wallet).
3. **Purchase verdict.** A token purchase is judged by `purchaseResult(result, contractId)`, never by the transaction status. Not bought:
   - When the transaction or its first receipt failed (both run on the token), the page says the token refused and no money left the buyer.
   - Otherwise it gives the contract's reason. It says "The token gave the 10 tUSD back" only when the resolver's value is `"0"` (the amount kept). Any other value says the return was not reported and asks to check before trying again.
   - The generic "Failed step" lines are replaced (`TxStatus` `failureBody`), because they would call `ft_on_transfer` "the transfer to the contract".
   - No ticket and no ticket link appear.
4. **Registration**, read with `tokenRegistration` before money moves:
   - Buyer: the buy button stays disabled ("Register with tUSD first.") and the one-step registration is offered.
   - Transfer receiver: the confirm box warns that a refund to an unregistered holder fails until it registers. It offers "Register ana.testnet with tUSD for 0.00125 NEAR", paid by the sender. The transfer stays allowed, since holding needs no registration.
   - Holder claiming: the registration replaces the claim button until done.
   - If the registration cannot be read, the claim button stays with a sentence: an outage must not hold back a refund, and an unregistered claim only costs a fee (R7 restores the right). The buyer's balance read failing blocks the buy until "Try again" succeeds.
5. **Faucet.** Offered only to a registered buyer whose balance is short. Only for tokens listed in `VITE_FAUCET_TOKENS` (comma-separated; the demo lists `tusd.testnet`). The button names what the test token mints, 100 whole units (`FAUCET_WHOLE_UNITS`). Without a faucet the page says how much to send to the account.
6. **Demo mode.** It reads `FIXTURES_WITH_TOKENS`. `sofia.testnet`, a holder not registered with tUSD, joins the demo account selector. The demo registration and faucet answer like the demo create: "Demo: nothing was registered/sent. Live, …".

## Alternatives considered

- Detecting a faucet by calling it, or by the token's symbol: a call costs a transaction; a symbol proves nothing.
- Blocking the claim when registration cannot be read: safer against a wasted fee, but an RPC hiccup would then stand between a holder and a refund.
- Blocking the transfer to an unregistered account: the plan allows it (story C gives a ticket to an unregistered account), and the receiver can register later.
- Rounding token amounts to 2 decimals as cents: one rule for every unit is easier to check, and prices are limited to the decimals shown (W7).

## Consequences

The hosted build must set `VITE_FAUCET_TOKENS` to the test token for the faucet button to appear (integrator). A token that is not a near-contract-standards token, with a resolver that returns something other than the amount kept, would read as "not reported as returned", which is cautious, not wrong.
