# The group verifier counts every label that can change who decides calls; the line says "its rules now"

Date: 2026-11-13. Author: lane P. Status: accepted. Replaces, in `2026-11-13-group-verifier-reads-the-dao-policy.md`, the rule that only `call` is looked at and the wording of the event page's line.

## Context

The integrator's final review of lane P: `groupVerifierOf` looked only at who can approve `call`, so the line could say "2 must agree" for a DAO where one member alone can change the rules and then call. Examples: a council `[a, b, c]` with `*:*` and default threshold `[1, 2]` plus a `policy` vote policy of threshold `"1"`; a second `Group` role `[a]` with `policy:VoteApprove`; `add_member_to_role`, `remove_member_from_role` or `upgrade_self` decided by 1. Labels from `sputnikdao2/src/proposals.rs` (`to_policy_label`).

## Decision

- Labels considered: `call`, `config`, `add_member_to_role`, `remove_member_from_role`, `upgrade_self`, `upgrade_remote`, the five `policy…` labels of Sputnik v2, and any other label starting with `policy` found in the policy's permissions or vote policies.
- A role that may approve any of them (`*:*`, `<label>:*`, `*:VoteApprove`, `<label>:VoteApprove`) is an approver. `Everyone` still counts, as `2026-11-13-group-verifier-any-other-approver-gives-null.md` decided; the review's wording says "non-Everyone", and counting it is the stricter of the two (it can only turn a group line into the plain account).
- The answer is non-null only when there is exactly one approver, it is a `Group`, and it may approve `call`. `needed` is the minimum, over the labels the group may approve, of what the contract computes from the group's own entry for the label, else the default. A label whose vote policy is not `RoleWeight`, or whose threshold is 0, gives null; a label whose threshold exceeds the group can never pass and is left out, unless it is `call` (null).
- The line reads `<account> · a group of 3; its rules now: 2 must agree (a, b, c) · accepted these terms`: a DAO can change its own policy, and the line is read when the page loads.

## Alternatives considered

- **Null whenever any rule-changing label has a lower threshold than `call`.** It hides a real group; the minimum says the truth: that many members can change what the group needs.

## Consequences

- `ticket-jury.sputnikv2.testnet` still reads 3 members, 2 needed (its council approves every label under the default `[1, 2]`).
- A DAO where one member can upgrade or add members reads "1 must agree".
