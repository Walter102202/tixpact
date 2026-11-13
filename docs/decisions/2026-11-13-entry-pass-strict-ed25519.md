# Entry pass signatures are verified under RFC 8032's strict rules, with `@noble/curves` 2.4.0

Date: 2026-11-13. Author: lane P. Status: accepted. Replaces the sentence on Ed25519 verification in `2026-11-13-entry-pass-sha256-from-noble-hashes.md`.

## Context

The integrator's review of P1 found a forgery, verified against the library: near-api-js's `PublicKey.verify` calls `@noble/curves`' `ed25519.verify` with ZIP-215 on, and ZIP-215 accepts public keys of small order (`node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/edwards.js:651`: `if (!zip215 && A.isSmallOrder()) return false`). The implicit account `000…0` (64 zeros) can be created by anyone; its full-access key is the all-zero key, a small-order point. For that account, the signature `0x01` followed by 63 zero bytes verifies for any message, so a pass for any ticket the account holds passed all five checks without a private key. The test "refuses a signature forged for a small-order key, which near-api-js would accept" shows near-api-js's `verify` returning true for it.

## Decision

`checkSignature` (`packages/client/src/pass.ts`) verifies with `ed25519.verify(signature, hash, key.data, { zip215: false })` from `@noble/curves/ed25519.js`. `packages/client/package.json` declares `"@noble/curves": "2.4.0"`, the version near-api-js 7.5.3 already brings; `pnpm-lock.yaml` gains three lines in the `packages/client` importer and no package.

## Alternatives considered

- **Keep `PublicKey.verify` and refuse small-order keys by hand.** It repeats the library's own check, and also misses what strict mode refuses besides (non-canonical encodings).
- **Refuse implicit accounts.** It closes this one account, not the class: any account can add a small-order key.

## Consequences

- Wallets sign under RFC 8032, so a real signature verifies either way; the near-cli-rs vector and passes signed by `signPassWithKey` still admit (tests).
- The MCP server and `scripts/pass.mjs` use the same `checkPass`, so they get the fix with no change of their own.
