# The agent's signer knows the transaction hash before sending, and judges send errors itself

Date: 2026-11-12. Author: Track M. Status: accepted.

## Context

The signer sends through the client's `createRpc`, a `FailoverRpcProvider` over endpoints that each have a time limit. Read in near-api-js 7.5.3 (`lib/index.js`):

- `FailoverRpcProvider.withBackoff` (line 2146) sends the same request to the next endpoint after any rejection and finally throws `FailoverRpcError` with every error.
- `Account.signAndSendTransaction` (line 5003) retries a stale nonce only when the error is `InvalidNonceError`, which never happens behind the failover wrapper (the error is a `FailoverRpcError`). It also returns the hash only in its response, so a timeout loses it.

A timeout does not mean the transaction was dropped: the first endpoint may have received it, and the next endpoint then answers that its nonce is already used. Reporting that as "failed" would invite a second purchase.

## Decision

`mcp/src/signer.ts`, `createNearSigner`:

- Each attempt builds the transaction with a new `Account` (the nonce is read from the chain, not from a cache, so the server and the watcher can share a key), signs it with `KeyPairSigner.signTransaction` (which returns the hash), and only then sends it with `sendTransactionUntil(…, 'INCLUDED')`.
- A send error is judged over every endpoint's error: any `ActionExecutionError` means the transaction ran (the hash is returned and the chain gives the verdict); any other error that is not a transaction error (a timeout, a network failure) means it may have landed (`SendError` with the hash and `mayHaveLanded: true`, and the tools track it by hash); only stale nonces means sign again with a fresh nonce, up to 3 times; anything else means the node refused it (`mayHaveLanded: false`).
- Before the first signature the signer checks that the RPC reports chain id `testnet`.

## Alternatives considered

- `Account.signAndSendTransaction`: loses the hash on a timeout and cannot retry a stale nonce behind the failover provider.
- A provider without failover for sends: one slow endpoint would then block every write.

## Consequences

A transaction whose send timed out is reported `unconfirmed` with its hash after about 20 seconds of tracking, never as failed. The agent's purchases in flight keep counting against the exposure cap meanwhile (`2026-11-12-agent-exposure-and-one-write-at-a-time.md`).
