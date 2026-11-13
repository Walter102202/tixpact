# The group verifier also counts `factory_info_update`

Date: 2026-11-13. Author: lane P. Status: accepted. Adds one label to the list in `2026-11-13-group-verifier-counts-every-rule-changing-label.md`.

## Context

The integrator's review of 36a593f: in Sputnik DAO v3 a `factory_info_update` proposal replaces the factory account and `auto_update`, and the factory may then call `update` to replace the DAO's code. A member who can pass it alone can change who decides calls.

## Decision

`factory_info_update` is in `RULE_LABELS` (`packages/client/src/reader.ts`). Test: the group passes it with 1 vote while `call` needs 2, so `needed` is 1. `set_vote_token` stays out: it only matters under `TokenWeight`, which already gives null.

## Alternatives considered

None: same class as the labels already counted.

## Consequences

A v3 DAO whose council can replace the factory by one vote reads "1 must agree".
