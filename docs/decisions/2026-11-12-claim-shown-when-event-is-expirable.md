# The web offers the refund claim as soon as the deadline has passed

Date: 2026-11-12. Author: integrator. Status: accepted.

## Context

A ticket's derived `claim` is `Reserved` while its event is `Unresolved` (plan, "JSON shapes", enums). But `claim_refund` on an unresolved event whose deadline has passed expires the event first and then pays (plan, "Behaviour the signatures do not show"). Task W2 said the claim button appears "only when `claim` is `Refundable`", which would hide a claim that works: the holder would have to find somebody to call `expire_event` first. Raised by Track W in its W0 report, item 1.

## Decision

The claim button is shown when `claim` is `Refundable`, and also when `claim` is `Reserved` and the event's `phase` is `Expirable`. In the second case the page says "The deadline passed without confirmation" above the button; the button text is the same ("Claim 1.5 NEAR to <account>"). The contract and its JSON do not change.

## Alternatives considered

- Keep the W2 text and add a separate "Expire event" button: two transactions and two wallet approvals for something the contract does in one.
- Make the contract report `claim: Refundable` for expirable events: `claim` would then disagree with `outcome`, and R11 keeps facts separate.

## Consequences

The web has one rule in one place (`canClaimRefund(ticket, event)`), tested for both cases. If wrong, the cost is a button that fails with `ERR_NOT_REFUNDABLE`; test `t05` and the settlement tests pin the contract side.
