# Test fixtures

Contracts that exist only to test the ticket escrow in the sandbox. They are never deployed anywhere else.

Each fixture is its own crate in a folder here and joins the workspace automatically (`fixtures/*` in the root `Cargo.toml`).

| Fixture | Added in | What it does |
|---|---|---|
| `vanishing-holder` | Task C2 | Holds a ticket, claims its refund and deletes its own account in the same receipt, so the refund transfer fails (`claim_and_vanish`). The same for a payout when it organizes an event (`collect_and_vanish`). It can also send two claims from one receipt (`claim_twice`) and forward any call with its deposit (`forward`), so it can buy, create events and claim like a person. |
| `ticket-receiver` | Task C3 | Receives a ticket through `nft_transfer_call` and answers as its `msg` says: keep, return, panic, garbage, oversized or re-enter. |
