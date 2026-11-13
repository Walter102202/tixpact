# The agent signs only through RPC endpoints that confirmed testnet, and checks the chain before every signature

Date: 2026-11-13. Author: Track M. Status: accepted. Replaces the one-time chain check in `2026-11-12-agent-signer-knows-the-hash-before-sending.md` and adds to `2026-11-12-agent-config-fails-closed.md`.

## Context

The M1 review: "testnet only" rested on refusing `.near` names. `RPC_URLS` accepted `http` and could point at a mainnet node, and the signer checked the chain id only once, through a failover provider that may answer from a different endpoint later. Configuration errors also printed the refused value (`config.ts:54,97`), which leaks a key pasted into the wrong variable or an API key inside an RPC URL. Separately, reads used `AGENT_ACCOUNT_ID` while writes used the key's account (`agent.ts:140-142` against `:201`), and nothing required them to match.

## Decision

- `RPC_URLS` takes `https` URLs only.
- With a key, `depsFromEnv` (now async) asks every endpoint its chain id before it builds the signer:
  - one that reports anything but `testnet` turns signing off;
  - none answering turns signing off;
  - otherwise the signer sends only through the endpoints that answered `testnet`.
- When signing is off the server runs read-only and says why: in its start line, as `signing_off_reason` and "Signing: off (…)" in `get_wallet`, and as the reason `signing_off` on every write.
- The signer reads the chain id again before every signature and refuses on a mismatch. A transaction also carries a recent block hash read through those same endpoints, so it is invalid on any other chain.
- Configuration errors name the variable and, for `RPC_URLS`, the entry's position; never the value.
- `createAgent` refuses to start when the signer's account differs from `AGENT_ACCOUNT_ID`, or when `AGENT_ACCOUNT_ID` is not set.

## Alternatives considered

- Keep the signer when an endpoint is unreachable at start and rely on the per-signature check: that check goes through the failover provider, so an unverified endpoint could answer it. Leaving unverified endpoints out of the signer's provider is stricter at no cost to reads.
- Refuse to start when an endpoint reports another network: read-only still serves the reads, and the reason is shown where the agent looks.

## Consequences

- One extra `status` call per write and one per endpoint at start.
- An agent started while every endpoint is down stays read-only until it is restarted.
- Reads still use every configured endpoint. On another network the contract account does not exist there, so those reads fail rather than mislead.
