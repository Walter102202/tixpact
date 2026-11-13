# A verifier is shown as a group when its Sputnik DAO policy says one group decides function calls

Date: 2026-11-13. Author: lane P. Status: accepted; its rule that `Everyone` roles are left out of the count of approvers is replaced by `2026-11-13-group-verifier-any-other-approver-gives-null.md`, and its rule of looking only at `call`, with the line's wording, by `2026-11-13-group-verifier-counts-every-rule-changing-label.md`.

## Context

Task P3: `readGroupVerifier(accountId)` reads `get_policy` and answers `{ members, needed }` only for a Sputnik DAO policy with exactly one `Group` role allowed to approve function calls under `RoleWeight`, with `needed = min(n, floor(n * num / den) + 1)` for a ratio threshold; anything else is `null`. Three things were left open or needed checking against the contract rather than memory:

- `near-daos/sputnik-dao-contract`, `sputnikdao2/src/policy.rs` (read 2026-11-13): the tally skips `Everyone` roles; for a `Group` under `RoleWeight` the total is the group's size; the threshold is `max(quorum, threshold.to_weight(total))`, where `to_weight` is `min(weight, total)` for a weight and `min(total * num / den + 1, total)` for a ratio; a role's own `vote_policy` entry for the proposal's label wins over `default_vote_policy`. `proposals.rs`: the label of `FunctionCall` is `"call"`.
- The JSON shape, read from `peter.sputnikv2.testnet` and `ticket-jury.sputnikv2.testnet` on testnet: `kind` is `"Everyone"`, `{ "Member": "1" }` or `{ "Group": [...] }`; `threshold` is `[num, den]` or a decimal string.
- near-api-js's `FailoverRpcProvider` prints every failed request with `console.error` (`lib/index.js`, `withBackoff`). Asking a plain account for `get_policy` fails on every endpoint, so an event page with an ordinary verifier would log errors.

## Decision

- `groupVerifierOf(policy)` (`packages/client/src/reader.ts`) answers when exactly one role that counts in the tally (any kind but `Everyone`) holds `*:*`, `call:*`, `*:VoteApprove` or `call:VoteApprove`, that role is a non-empty `Group` of valid account ids, and its policy for calls (its own `call` entry, else the default) is `RoleWeight`. `needed = max(quorum, min(n, floor(n * num / den) + 1))` for a ratio and `max(quorum, min(n, weight))` for a weight, computed in BigInt. A result below 1 or above `n` (a policy that can never pass, or one any single vote passes) is `null`.
- `readGroupVerifier` reads the account first and asks for `get_policy` only when it has code. A plain account costs one view that succeeds and logs nothing.
- The event page's verifier line reads `<account> · a group of 3: 2 must agree (a, b, c) · accepted these terms`; a plain account reads as before. More than six members are cut to five names and "and N more". Members are plain text, so the explorer link on the line stays the verifier's own.
- Fixture data may carry `policies` per account; the demo data carries none, so demo pages read as before.

## Alternatives considered

- **The plan's formula without the quorum.** It would understate `needed` for a DAO whose quorum is above the ratio; the contract uses the larger of the two.
- **Ratio thresholds only.** A weight threshold is the same rule in the same function of the contract; leaving it out would show a real group as a plain account.
- **Calling `get_policy` directly.** Two console errors on most event pages.

## Consequences

- `ticket-jury.sputnikv2.testnet`, the DAO of the group-verifier proof, reads `{ members: [te-d1-venue, te-d1-verifier, te-d1-auditor], needed: 2 }` through the client on testnet.
- A verifier that is a contract other than a DAO still logs the failed `get_policy` once per endpoint; it then reads as a plain account.
- The agent's `get_event` does not describe the group yet.
