# Version 2 goes to its own account, `ticket-escrow-v2.testnet`

Date: 2026-11-13. Author: integrator. Status: accepted. The key deletion it prepares is not done yet.

## Context

Version 2 of the contract adds prices in a token and a ticket that draws its state. Its stored records have a different shape (an event carries its currency, the contract carries its token list), so the code of version 2 cannot read the state of `ticket-escrow.testnet`, and the contract has no migration method on purpose: a method that rewrites state is a method that can move money outside the rules.

The plan set a deadline for the decision: 2026-11-13 22:00 (Santiago), with four conditions. Three held at 16:10: the independent reviewer said "deploy" on the closing contract commit (`479ef78`), `bash scripts/gate.sh` passed on the merged tree (698 TypeScript tests, 101 contract tests), and the build was deployed to a fresh testnet account. The fourth, the stories played again on that account, is what `docs/proof.md` and the other proof documents record once they name this account.

## Decision

- The release is `ticket-escrow-v2.testnet`, with the wasm the gate built (SHA-256 `b17e6c47a884601dd9e98610237ca75d49c02b2bcb980995613f05332ba45a22`, code hash `CwryMXK37NQ5KUR22Ca23bubTJZXrKiis1qph3QE5VXP`). The deployment script refuses any other file.
- Deployment and `new` went in one transaction signed by the contract account, because `new` is private (`2026-11-13-only-the-contract-account-calls-new.md`).
- The token list has one entry and can never change: `tusd.ticket-escrow-v2.testnet`, the repository's test token (`fixtures/test-token`) deployed as `tUSD`. It is not a real dollar: anyone can mint it and it is worth nothing. The name says "test" so that nobody reads it as USDC.
- Every proof is played again on this account: `scripts/demo-scenario.mjs` (rewrites `docs/proof.md`, now with a story priced in the token), `scripts/direct-calls.sh`, the agent's runs (`docs/mcp.md`), `scripts/group-verifier.sh` (`docs/proof-group-verifier.md`) and a real entry pass (`docs/proof-entry-pass.md`).
- The README, the hosting configuration and the guides name this account from now on.
- Its access key, and the token account's, are deleted only with Walter's explicit OK at that moment.

## Alternatives considered

- **Ship version 1 and leave version 2 on its branch.** This was the fallback if any of the four conditions failed by 22:00. They did not.
- **Deploy version 2 over `ticket-escrow.testnet`.** The new code would fail to read the old state on every call, and five events with their proofs would be lost.
- **List a real stablecoin's testnet deployment.** Its faucet and its issuer would be dependencies of the demo, and a judge could not mint it freely. The contract treats any NEP-141 token the same way, which the tests show with a standard token and a hostile one.

## Consequences

- `ticket-escrow.testnet` stays as it is, with version 1 and its own events. Nothing points to it any more except this record and `docs/toolchain.md`.
- `te-d5-escrow.testnet` holds the rehearsal of version 2 at an earlier commit; nothing points to it.
- A token is trusted (limit 10 of `docs/threat-model.md`): the list is fixed at deployment and shown to buyers for that reason.
