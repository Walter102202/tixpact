# Client package for interface v2: token calls name their receiver, terms default to NEAR

Date: 2026-11-13. Author: lane K2 (task K1). Status: accepted.

## Context

The plan's client interface for v2 (`docs/plans/2026-11-13-pass-group-verifier-dollars.md`, "Client package") lists names and signatures but leaves five details open:

- `ContractCall` has no receiver: every v1 call goes to the escrow contract. The three new builders call a token (`ft_transfer_call`, `storage_deposit`, `faucet`).
- `EventTerms` gains `currency`, but the web's organizer form (lane W2) and its tests build terms without it.
- `formatAmount(amount, unit)` must write what the contract writes (exact), but the web shows wallet balances, which are long when exact.
- `unitOf(config, currency)` for a currency missing from `Config.tokens`.
- Where `tokenBalance` and `tokenRegistration` live.

## Decision

- `ContractCall` gains an optional `receiverId`. The token builders return `ExternalCall = ContractCall & { receiverId: string }`, always set to the token; escrow calls leave it out, so every existing comparison of calls is unchanged. A caller sends a call to `receiverId` when present, else to the escrow.
- `EventTerms` (the exported type) is the schema's input: `currency` may be left out, and `createEvent` always sends it, `null` when left out. Every `create_event` names its currency.
- `formatAmount(amount, unit, maxDecimals = unit.decimals)`: exact by default, as the plan writes; the optional third argument rounds toward zero and writes dust as `<0.0001 NEAR`, the rule `formatNear` already follows.
- `unitOf` throws a `RangeError` for a token not in `Config.tokens`: the contract never prices an event in one, so meeting one means the data is wrong, and a wrong unit would misstate an amount by orders of magnitude.
- `tokenBalance(token, accountId)` and `tokenRegistration(token, accountId)` are required methods of `Reader`, read at `final` like every view, through `ft_balance_of`, `storage_balance_of` and `storage_balance_bounds`. `minDeposit` is `storage_balance_bounds().min`. The fixture reader implements both.
- The view schemas require `currency` and `Config.tokens`: they read a v2 contract and refuse a v1 one with a parse error naming the method.

## Alternatives considered

- A separate `TokenCall` type unrelated to `ContractCall`: the web's wallet hook and the agent's signer take `ContractCall`, so a second type would need a second path through both.
- Required `currency` in `EventTerms`: turns the web's typecheck red until W2 adds the picker, for no safety gain, since the default is sent explicitly.
- Free functions `tokenBalance(rpc, ...)`: the web and the scripts hold a `Reader`, and fixture mode needs the same calls answered from data.

## Consequences

- Deviations from the plan's client interface, all additive: `ContractCall.receiverId`, `ExternalCall`, `formatAmount`'s third argument, `NEAR_UNIT`, the exported `TokenRegistration` type. Lane W2 was told.
- A hand-written `Reader` (not spread from `createFixtureReader`) must now implement the two token reads.
- A client of this package cannot read a v1 deployment; the branch merges only with contract v2.
