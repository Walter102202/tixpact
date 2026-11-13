# At start the agent accepts only .testnet accounts and checks that the key is a full-access key of AGENT_ACCOUNT_ID

Date: 2026-11-13. Author: Track M. Status: accepted. Adds to `2026-11-13-agent-signs-only-through-endpoints-confirmed-on-testnet.md`.

## Context

The M2 review (findings 5, 7, 8 and 9):

- The account check (`agent.ts`, signer account against `AGENT_ACCOUNT_ID`) compared a value with itself, because `runtime.ts` builds the signer from `AGENT_ACCOUNT_ID`. A key of another account started "signing as" the agent, and every write then failed.
- Implicit 64-hex ids were accepted, and the same key controls them on every network. An endpoint that lies about its chain id could then obtain a signature valid on mainnet.
- An endpoint that answered without a chain id stopped the search for a wrong one later in the list.
- After "nonce already used" the signer signed again without checking whether its first transaction had landed.

## Decision

- `CONTRACT_ID` and `AGENT_ACCOUNT_ID` must end in `.testnet`. Anything else, implicit ids included, is a configuration error that names the variable, not the value.
- Every endpoint's answer is reduced to a chain id or nothing. A failed read and an answer without a chain id confirm nothing. Any endpoint naming another chain turns signing off, wherever it sits in the list.
- After the network check, the public key of `AGENT_PRIVATE_KEY` is read as an access key of `AGENT_ACCOUNT_ID`, through the confirmed endpoints:
  - not found: signing is off;
  - a function-call key: signing is off, since it cannot attach the deposits `buy_ticket` and `claim_refund` need;
  - a read that fails: signing is off.
- After "nonce already used", the signer looks its transaction up by hash (`viewTransactionStatus`, `waitUntil: 'NONE'`):
  - known: it returns that hash;
  - unknown on every endpoint that answered: it signs again with a fresh nonce;
  - otherwise: it stops with "may have landed", so the agent counts and tracks it.
- The signer still compares its account with `AGENT_ACCOUNT_ID` in `createAgent`, for callers that build their own deps.

## Alternatives considered

- Refuse to start on a missing key: read-only still serves the reads, and the reason is shown where the agent looks.
- Re-sign after a stale nonce without a lookup when nearcore would answer a resend with the outcome: whether fastnear and drpc do the same could not be checked, and the lookup costs one read.

## Consequences

- Two more reads at start: the status of each endpoint, and one access key.
- A key added to the account after the server started is not seen until restart.
