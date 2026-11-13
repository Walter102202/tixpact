# The agent's configuration fails closed, and the policy also bounds gas and deposits

Date: 2026-11-12. Author: Track M. Status: accepted.

## Context

The plan lists the environment variables and two caps, but not what happens when a cap is missing, when the network is not testnet, or whether a call other than `buy_ticket` may attach money. `nft_transfer`, `expire_event` and `claim_refund` are on the allowlist; if any of them could carry a deposit, the caps (which only look at purchases) would not bound it.

## Decision

`mcp/src/config.ts`:

- `NEAR_NETWORK` must be `testnet` (the default). Account ids ending in `.near` are refused for `CONTRACT_ID` and `AGENT_ACCOUNT_ID`.
- With `AGENT_PRIVATE_KEY` set, `AGENT_ACCOUNT_ID`, `MAX_PRICE_YOCTO` and `MAX_EXPOSURE_YOCTO` are all required. There are no default caps. Both caps or neither.
- The key is never stored in the returned config. Only `readAgentKey` returns it, for the signer; a malformed key is reported without repeating it.

`mcp/src/policy.ts`, after the contract and method allowlist:

- The prepaid gas may not exceed the client's gas table for that method (`actions.GAS_TGAS`), which bounds the fee of any call.
- Only `buy_ticket` may attach more than 1 yoctoNEAR.

## Alternatives considered

- Default caps (for example 1 NEAR and 5 NEAR): a server started with a key and a typo in a variable name would sign with limits nobody chose.
- Trust the tool layer to build calls only through `actions.*`: true today, but the policy is the last line before the signer and must hold for any call it is given.

## Consequences

A judge can run the server read-only with only `CONTRACT_ID`. Signing needs four more variables, all checked at start.
