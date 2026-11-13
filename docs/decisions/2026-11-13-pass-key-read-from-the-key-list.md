# The door looks the signing key up in the account's key list, not by name

Date: 2026-11-13. Author: lane P. Status: accepted.

## Context

Task P4 (the integrator): `CONTRACT_ID=ticket-escrow.testnet node scripts/pass.mjs verify <a pass whose account was changed>` printed the right verdict but wrote two `AccessKeyDoesNotExistError` stack traces to stderr. `createPassChain` asked `view_access_key` for the key; the node answers a missing key with an error, and near-api-js's `FailoverRpcProvider` (`withBackoff`) takes that for a broken endpoint, logs it with `console.error` and asks the next endpoint the same thing. A deleted key (E6) and a changed account (E3) are ordinary answers at a door; the browser console got the same noise.

Read on testnet on 2026-11-13, per endpoint, with no failover (`https://test.rpc.fastnear.com`, `https://near-testnet.drpc.org`): `view_access_key_list` at `final` answers `te-d1-luis.testnet` with its one full-access key, and an account that does not exist with `{ keys: [] }`, not an error.

## Decision

`createPassChain(...).accessKey` reads `view_access_key_list` at `final` and looks for the pass's public key: `FullAccess` is `'full'`, any other permission `'function-call'`, absent `'missing'`. It follows `last_key` pages, up to 100 like the reader's account proof. `PassRpc` now names `viewAccessKeyList`; `FailoverRpcProvider` satisfies it, so `web/src/main.tsx` and `scripts/pass.mjs` need no change. A list read that fails, or answers something that is not a key list, still rejects, and the `key` check reads "The chain could not be read" (E9). The MCP server does not use `createPassChain`.

## Alternatives considered

- **Keep `view_access_key` and silence the logs.** It means patching `console.error` around a library call, and the failover would still ask every endpoint for an answer it already had.
- **Call one endpoint directly without failover.** It loses the failover for real outages.

## Consequences

- A missing key costs one read and no error on the way (test with a fake RPC). The reproduction with the near-cli-rs pass, its account changed to `te-d1-verifier.testnet` and to an account that does not exist, prints the right verdict with an empty stderr.
- An account with more keys than a node lists without pages may need several reads.
