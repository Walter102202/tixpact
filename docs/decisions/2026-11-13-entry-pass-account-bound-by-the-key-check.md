# A changed account in an entry pass fails the `key` check, not `signature`

Date: 2026-11-13. Author: lane P. Status: accepted.

## Context

The plan's P1 test list says "changing any of message, nonce, recipient, account or signature fails `signature`" (`docs/plans/2026-11-13-pass-group-verifier-dollars.md`, Task P1). The frozen pass message is four lines (`Entry pass`, contract, ticket, time) and NEP-413 signs `{ message, nonce, recipient, callbackUrl }`. The account id is in neither: a NEP-413 signature does not cover it. With the near-cli-rs vector, a pass whose `account` is changed to `mallory.testnet` still has a valid signature under its public key.

## Decision

The account is bound by the `key` check: the public key in the pass must be a full-access key of the account the pass names, read on chain at the scan. A pass whose account was changed fails `key` (the key is not one of that account's keys) and is not admitted. The test says so by name: "fails the key, not the signature, when the account changes: NEP-413 does not sign it" (`packages/client/src/pass.test.ts`). The four other changes (message, nonce, recipient, signature) fail `signature`, as the plan says.

## Alternatives considered

- **Add the account as a fifth line of the message.** It would make `signature` fail too, but the message is frozen at four lines, and the binding would add nothing: whoever controls a full-access key of an account can sign any message for it anyway.
- **Fold the key read into the `signature` check.** It would blur two failures an attendant must tell apart ("altered" against "this key is not theirs").

## Consequences

- An attacker who renames the account on a pass is refused with the `key` sentence: "The key that signed this pass is not a key of mallory.testnet now: it was deleted or never belonged to it."
- The only way to pass `key` for another account is to hold a full-access key of it, which means controlling it.
