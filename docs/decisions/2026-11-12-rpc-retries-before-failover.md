# Each RPC endpoint gets three attempts before the next one is tried

Date: 2026-11-12. Author: Track W (Task W0). Status: accepted.

## Context

The plan fixes the endpoints (`https://test.rpc.fastnear.com`, then `https://near-testnet.drpc.org`) and `FailoverRpcProvider`. In `near-api-js` 7.5.3 each `JsonRpcProvider` retries fetch failures and HTTP 500/503/408 by itself, by default 12 attempts starting at 500 ms with a 1.5 backoff (`lib/index.js`, `REQUEST_RETRY_NUMBER`, `retryConfig`). That is more than a minute before the failover provider moves to the second endpoint, and longer before the proof page can say "Could not read the chain".

## Decision

`createRpc(rpcUrls)` builds each `JsonRpcProvider` with `{ retries: 3, wait: 250, backoff: 2 }`: three attempts 250 ms and 500 ms apart, then the next endpoint.

## Alternatives considered

- Library defaults: a dead first endpoint stalls every read for over a minute.
- No retries: one dropped request would fail over at once and lose the fast endpoint for the rest of the session (the failover provider stays on the last provider that worked).

## Consequences

An endpoint that is down costs under a second per read before failover. Note: `FailoverRpcProvider` writes every failed attempt to `console.error` (`lib/index.js`, `withBackoff`); the web's "no console errors" check must account for that when an endpoint fails.
