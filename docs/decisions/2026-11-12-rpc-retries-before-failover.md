# Each RPC endpoint gets a time limit and a short retry before the next one is tried

Date: 2026-11-12. Author: Track W (Task W0). Status: accepted. Corrected 2026-11-12 after the independent review of W0 (see "Corrections").

## Context

The plan fixes the endpoints (`https://test.rpc.fastnear.com`, then `https://near-testnet.drpc.org`) and `FailoverRpcProvider`. What `near-api-js` 7.5.3 does underneath, read in the installed `lib/index.js`:

- `retryConfig` (lines 3433-3447) retries only when the error's `cause` is HTTP 500, 503 or 408, or its text contains "FetchError" or "Failed to fetch" (Chrome's network error). Node's `TypeError: fetch failed`, Firefox's and Safari's network errors, HTTP 429 and 502 are not retried: the failover moves to the next endpoint at once. Default: 12 attempts from 500 ms with a 1.5 backoff (line 3486).
- `fetchJsonRpc` (line 3458) calls `fetch` with no abort signal, so a request to an endpoint that accepts the connection and never answers hangs forever, and the failover never moves on.
- `FailoverRpcProvider.withBackoff` (line 2146) tries each provider once per call and writes every failure to `console.error`.

## Decision

`createRpc(rpcUrls, options?)` builds each `JsonRpcProvider` with `{ retries: 3, wait: 250, backoff: 2 }` (three attempts, 250 ms and 500 ms apart, for the failures the library retries), and wraps every provider method in a time limit: 8 s for reads, 30 s for transaction sends and status requests (which wait on the node by design). A request that hits its limit rejects, and the failover tries the next endpoint. The limits are `RpcOptions.timeoutMs` and `txTimeoutMs`.

## Alternatives considered

- Library defaults: a dead first endpoint that answers 503 stalls each read for over a minute, and a hung one stalls it forever.
- No retries: one dropped 503 would fail over at once and lose the fast endpoint for the rest of the session (the failover provider stays on the last provider that worked).
- Abort the hung request: `JsonRpcProvider` takes no signal, so the abandoned request is only ignored; it costs a socket until the server closes it.

## Consequences

With two endpoints a read fails in at most about 17 s (two time limits plus retries), so the proof page's "Could not read the chain" state always appears. Resending a signed transaction to the second endpoint after a time-out cannot execute it twice (same hash, same nonce), but the second endpoint may answer with a nonce error for a transaction that did go through: the agent confirms by hash. `console.error` from the failover on a dead endpoint is accepted (integrator ruling, 2026-11-12); the bar is no console errors on the normal path.

## Corrections

- The first version said all fetch failures and HTTP errors are retried three times. Only 500, 503, 408 and Chrome's "Failed to fetch" are; the rest fail over at once (pinned in `reader.test.ts`).
- The first version had no time limit, so a hung endpoint never failed over. Added the per-endpoint limit above (pinned in `reader.test.ts`).
