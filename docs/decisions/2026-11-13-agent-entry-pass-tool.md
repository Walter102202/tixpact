# The agent's `show_entry_pass` refuses tickets the door would refuse, and is read-only

Date: 2026-11-13. Author: lane P. Status: accepted.

## Context

Task P1 asks for an MCP tool `show_entry_pass { token_id }` that refuses when the agent does not hold the ticket, signs with the agent's key, returns the pass and, with `SITE_URL`, the door link, and signs no transaction. Left open: what it does for a ticket the agent holds but that cannot admit anyone, how it is annotated, how `SITE_URL` is checked, and how a pass is made from the command line with the NEAR CLI alone.

## Decision

- It refuses, before signing, every ticket the door's `ticket` check would refuse (refunded, being refunded, on its way to a contract) with the same words as the door, followed by "Nothing was signed." A pass that can only ever read "Do not admit" is not worth a signature.
- Refusals are tool errors with one sentence, like the read tools; success returns `pass`, `encoded`, `door_url` and `expires_at_ms`.
- It is annotated `readOnlyHint: true`: it changes nothing on chain or anywhere else. It needs a key but no caps, because it spends nothing.
- `AgentSigner` gains an optional `signMessage`; `createNearSigner` implements it with near-api-js `KeyPairSigner.signNep413Message` and reads nothing from the RPC. A signer without it gets a sentence, not a crash.
- `SITE_URL` must be `https`, or `http://localhost` / `http://127.0.0.1` for local development; anything else stops the server with a sentence naming the variable.
- `scripts/pass.mjs` has a third command, `request`, besides `verify` and `encode`: it prints the message, a nonce with the time in its first 8 bytes, and the exact `near message sign-nep413 … | node scripts/pass.mjs encode …` line. Without it, nobody can build the nonce by hand. `encode` accepts the CLI's JSON with camelCase or snake_case keys and words around it, because near-cli-rs could not be run in this session (signing was out of bounds); it checks the signature offline and exits 1 with the message the CLI must have signed when it does not match.

## Alternatives considered

- **Sign a pass for any ticket the agent holds and let the door refuse it.** It hands the model a pass that never works.
- **Return refusals as a structured result with a status, like the write tools.** Nothing is signed or sent, so the write statuses (`denied`, `not_sent`, …) do not fit; a one-sentence error is what the read tools do.

## Consequences

- The tool count is eleven: `TOOL_NAMES`, the tool-list test, `mcp/scripts/smoke.mjs` (`EXPECTED_TOOLS`) and `docs/mcp.md` say so. Dated verification logs in `docs/mcp.md` that recorded ten tools stay as they were recorded.
- The pass is a bearer credential for five minutes: the model sees it, and whoever it is shown to can use it in that window (`docs/threat-model.md`, "Entry pass").
