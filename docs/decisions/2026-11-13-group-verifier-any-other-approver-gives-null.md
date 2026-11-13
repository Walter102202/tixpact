# A role of any other kind that can approve calls makes the verifier read as a plain account, `Everyone` included

Date: 2026-11-13. Author: lane P. Status: accepted. Replaces, in `2026-11-13-group-verifier-reads-the-dao-policy.md`, the rule that roles of kind `Everyone` are left out when counting the roles that may approve calls.

## Context

The integrator's note on P3: "exactly one role of kind Group" means one role whose kind is an object with `Group`; roles of other kinds are ignored unless they can approve; if a non-Group role can approve calls, the answer is null. The first P3 commit left `Everyone` out of that count because the contract's tally skips `Everyone` votes (`sputnikdao2/src/policy.rs`).

## Decision

`groupVerifierOf` counts every role holding `*:*`, `call:*`, `*:VoteApprove` or `call:VoteApprove`, whatever its kind; it answers only when that is exactly one role and the role is a `Group`. Groups and other roles without such a permission are still ignored. The real `get_policy` answer of `ticket-jury.sputnikv2.testnet` is a test fixture: 3 members, 2 needed.

## Alternatives considered

- **Skip `Everyone`, as the tally does.** True today for Sputnik v2, but it makes the label depend on a detail of the contract's tally; reading "a group decides" while anyone holds the approve permission would mislead a reader of the policy.

## Consequences

A DAO that lets `Everyone` approve calls reads as a plain account on the event page.
