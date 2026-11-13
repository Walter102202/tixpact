# A purchase the agent signed counts against its cap until a read shows it is no longer exposure

Date: 2026-11-13. Author: Track M. Status: accepted. Replaces the counting rule in `2026-11-12-agent-exposure-and-one-write-at-a-time.md` (the bullet "stays counted until its ticket id appears in the agent's list") and the send-error rule in `2026-11-12-agent-write-results-and-checks.md`.

## Context

The M1 review found two ways past the exposure cap in `mcp/src/agent.ts` at 01e8e2e:

- A confirmed purchase left the pending set the first time its ticket appeared in the list (`agent.ts:175-177`). The RPC fails over between nodes, so the next list can come from a node that is behind. With caps 1.5 / 3 NEAR and nothing held: buy A, buy B (the list shows A, so A leaves the set), buy C on a node that lists neither. The check saw 1.5 NEAR held and signed; the agent then held 4.5 NEAR against a cap of 3. The test `keeps counting a confirmed purchase when a later read comes from a node behind` reproduces it: on the old code C is bought.
- Any send error other than a `SendError` that may have landed with a known hash was reported `failed` and not counted (`agent.ts:221-236`). A plain `Error`, or a `SendError` that may have landed but has no hash, could still be on the chain.

## Decision

- Every purchase this server signs is kept, deduplicated by ticket id against the list read now, until one of these reads shows its price is no longer the agent's exposure:
  - its transaction is judged failed;
  - the list shows the ticket in a claim that holds no money (`Refunded`, `ReleasedToOrganizer`);
  - a direct `get_ticket` read shows another owner, or such a claim.
- A read that fails, or a node that does not know the ticket yet, keeps it counting. While the list shows the ticket with money still in the contract, the list counts it and the purchase adds nothing; when the list does not show it, the purchase adds its price (`in_flight`).
- Only a `SendError` with `mayHaveLanded === false` is `failed`. Anything else is `unconfirmed`. With a hash it is tracked as before. Without one, the purchase is kept under a local id until the server restarts, and the result says so and links the agent's account.
- `list_my_tickets` returns the same total the policy checks, through the same function, with the in-flight part as `in_flight`.

## Alternatives considered

- Drop the purchase once the list showed it, but read the list only from the node that confirmed the transaction: the failover provider does not expose which node answered, and pinning one node gives up failover for reads.
- Count a purchase until restart in every case: simple, but a transfer or a refund would keep blocking the agent until someone restarts it.

## Consequences

- One extra `get_ticket` read per purchase the list does not show, on every write and on `get_wallet` / `list_my_tickets`. Bounded by the purchases signed since start.
- A send with no hash blocks its price under the cap until restart; it errs toward denying, never toward overspending. The real signer computes the hash before sending, so only an unexpected error reaches this path.
- `list_my_tickets` now waits behind a write in progress, like `get_wallet`.
