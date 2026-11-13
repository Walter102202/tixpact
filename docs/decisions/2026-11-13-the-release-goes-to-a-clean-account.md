# The release goes to a clean account, `ticket-escrow.testnet`

Date: 2026-11-13. Author: integrator. Status: accepted. The key deletion it prepares is not done yet.

## Context

`te-d4-escrow.testnet` holds the build of Tasks C1 to C4, the one this repository builds today (wasm SHA-256 `f526d9c6978e4333ee495b2bf37c380d0c05381982e392c5c2a1f5f39d7e457c`). The judge rehearsal of 2026-11-13 (`judge-rehearsal-1.md`) showed what a judge meets there:

- a name that says "development deployment 4" on every explorer link, on the proof page and in the README;
- an event list with leftovers of rehearsals: two "Direct calls" events and an "Agent night" nobody bought;
- the agent's testnet runs on an older contract (`te-d3-escrow.testnet`), not on the one the README names.

The plan left the name of the final account to Walter. On 2026-11-13 he asked the integrator to take the open decisions and stop asking.

## Decision

- The release candidate is a fresh account, `ticket-escrow.testnet`, created on 2026-11-13 and paid by a development account (the faucet answered 429).
- It received the same wasm file as `te-d4-escrow.testnet`. The deployment script refuses to send any file whose SHA-256 is not the one above.
- The three proofs are played again on it: `scripts/demo-scenario.mjs` (which rewrites `docs/proof.md`), `scripts/direct-calls.sh`, and the agent's runs (`docs/mcp.md`, "Verification").
- The README, the proof and the guides name this account from now on.
- Its access key is deleted only with Walter's explicit OK at that moment, because it cannot be undone. Until then the README and the proof page say it has one key.

The name is the repository's, not a product name: the product name is still not decided, and the contract is name-agnostic by design.

## Alternatives considered

- **Delete the key of `te-d4-escrow.testnet` and call it final.** No rework, but the judge reads a development name and rehearsal leftovers on the deployment whose main claim is that it is final.
- **An account with the product's working name.** The name is not decided; an account name cannot be changed later.

## Consequences

- `te-d4-escrow.testnet` stays as a development deployment with the same code. Nothing points to it any more except `docs/toolchain.md`.
- If the name changes, the same steps run again on another account in about half an hour; no code depends on the account name.
