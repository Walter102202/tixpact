# The entry pass hash uses `@noble/hashes` 2.4.0, declared by the client package

Date: 2026-11-13. Author: lane P. Status: accepted.

## Context

`nep413Hash` returns a `Uint8Array` (frozen interface, "Entry pass") and runs in the browser at the door, so it needs a synchronous SHA-256. Web Crypto's `crypto.subtle.digest` is asynchronous. near-api-js 7.5.3 computes the NEP-413 hash internally (`serializeMessage` in `near-api-js/lib/nep413/index.js`) but does not export it, and exports no SHA-256. The plan allows "the crypto already in the workspace (near-api-js and its dependencies)" and no new dependency.

Under pnpm, a workspace package can import only what its own `package.json` declares; `@noble/hashes` is a dependency of near-api-js, not of `@ticket-escrow/client`.

## Decision

`packages/client/package.json` declares `"@noble/hashes": "2.4.0"`, the exact version near-api-js 7.5.3 pins. No package enters the lockfile: `pnpm-lock.yaml` gains three lines in the `packages/client` importer. `pass.ts` imports `sha256` from `@noble/hashes/sha2.js`, the same module near-api-js uses. Ed25519 verification is `PublicKey.verify` from near-api-js; the Borsh encoding of the four NEP-413 fields is written out in `nep413Hash` (two strings, a fixed 32-byte array, and `None`).

## Alternatives considered

- **Import `@noble/hashes` without declaring it.** It does not resolve under pnpm's layout, and where it did it would be a phantom dependency.
- **An asynchronous `nep413Hash` over Web Crypto.** It changes a frozen signature.
- **A hand-written SHA-256.** Our own crypto, for no gain.

## Consequences

- `nep413Hash` is checked twice in tests: it verifies the near-cli-rs vector, and a signature near-api-js makes over a NEP-413 payload verifies against it.
- If near-api-js moves to another `@noble/hashes` version, the client's pin must move with it, or the lockfile will hold two copies.
