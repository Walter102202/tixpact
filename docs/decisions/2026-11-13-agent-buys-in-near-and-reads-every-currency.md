# The agent buys only in NEAR, and reads, claims and checks every currency

Date: 2026-11-13. Author: lane K2 (task K2). Status: accepted.

## Context

Contract v2 prices an event in NEAR or in one of a fixed list of NEP-141 tokens. The agent's caps (`MAX_PRICE_YOCTO`, `MAX_EXPOSURE_YOCTO`) are in yoctoNEAR, it may call only `buy_ticket`, `nft_transfer`, `expire_event` and `claim_refund` on the one contract, and a token purchase is an `ft_transfer_call` on the token. Two traps:

- `buy_ticket` on a tUSD event would attach the tUSD price as yoctoNEAR (10 tUSD is 10^7 yoctoNEAR, dust): it passes every cap, and the contract then rejects it with `ERR_WRONG_CURRENCY`.
- Every amount the agent wrote assumed NEAR: a tUSD ticket would read as "0.00000000000000001 NEAR", and its principal would have been added to the NEAR exposure.

## Decision

- `evaluate` gains an ordered check for purchases, after the deposit check and before the price cap: the event's currency, read with the event right before signing (`AgentState.eventCurrency`). A token currency is denied with reason `currency_not_near`: "Event 10 is priced in tusd.testnet, not in NEAR: this agent only buys tickets priced in NEAR, because its caps are in NEAR". A purchase whose currency was not read throws, like one whose exposure was not read. A denied token purchase reads no ticket list.
- The allow list is unchanged: the token calls (`ft_transfer_call`, `storage_deposit`, `faucet`) are denied as `contract_not_allowed` when sent to the token and `method_not_allowed` on the contract, and tests pin both.
- The exposure counts NEAR tickets only.
- Every amount is written in its own currency (`10 tUSD`, `1.5 NEAR`), exact. The read tools' results carry `tokens` (the accepted tokens with symbol and decimals), so a model reading the structured content knows the unit of every amount. The token list is read once per server, since a deployment fixes it at `new`; a failed read is retried on the next call. A NEAR-only path reads nothing new.
- `claim_refund` and `transfer_ticket` work on token tickets as on NEAR ones. Before claiming a token ticket, the agent reads whether its account is registered with the token; if not, the claim is not sent (`not_registered`) and the sentence says to register outside the agent, because `storage_deposit` stays off its allow list.
- `verify_contract` sets NEAR against NEAR events and each token's balance (read from the token) against its own events, with a count per currency.

## Alternatives considered

- Let the agent buy in tokens with caps per token: new configuration, a widened allow list and a second signer path, the day before submission; the plan cuts "the agent's view of token events" first.
- Deny token purchases in `buyTicket` before the policy: the rule would sit outside the pure, tested function that holds every other spending rule.
- Send the claim of a token ticket even when the agent is not registered: the contract restores the right (R7), but the agent would spend gas and report a failure it could foresee.

## Consequences

- `AgentState` gains `eventCurrency`; `DenyReason` gains `currency_not_near`; the outputs of `list_events`, `get_event`, `get_ticket` and `list_my_tickets` gain `tokens`; `verify_contract` gains `near_events` and `tokens_held`. The tool count stays ten.
- `docs/mcp.md` (not this lane's file) should say that token events are read and claimed but not bought.
