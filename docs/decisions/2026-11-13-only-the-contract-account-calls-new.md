# Only the contract account can call `new(tokens)`

Date: 2026-11-13. Author: lane C2, from the review of `8efc777..2f36f84`. Status: accepted.

## Context

In v2, `new(tokens)` fixes for good the tokens events may be priced in, and a listed token is trusted (`2026-11-13-token-payments-share-the-settlement-path.md`). `new` was `#[init]` but callable by anyone. If deploy and init ever went in two transactions, anyone could call `new` in between, list a token of their own and mint tickets backed by nothing.

## Decision

- `new` is `#[init]` and `#[private]`: only the contract account itself can call it.
- Deploy and init go in one transaction signed by the contract account, so the predecessor of `new` is the contract. Every sandbox test already deploys that way (`Contract::deploy(..).with_init_call("new", ..)`).
- The test is a sandbox test, `contract/tests/init.rs` (`only_the_contract_account_can_call_new`): a stranger's `new` on deployed, uninitialized code fails with "is private", and the contract account's own `new` then succeeds. A unit test cannot show it, because `#[private]` is checked in the wasm export, not in the Rust method. It is a new file, so it does not touch lane T2's files.

## Alternatives considered

- A check in the body (`predecessor == current_account`): the same effect, but `#[private]` is the standard form that reviewers and tools recognize.
- Leave it to the deployment script: nothing would hold it on chain.

## Consequences

The integrator's deployment must keep deploy and init in one transaction signed by the contract account (or init from that account later). No other caller can ever initialize the escrow.
