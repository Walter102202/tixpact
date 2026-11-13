# Test fixtures

Contracts that exist only to test the ticket escrow in the sandbox. They are never deployed anywhere else.

Each fixture is its own crate in a folder here and joins the workspace automatically (`fixtures/*` in the root `Cargo.toml`).

| Fixture | Added in | What it does |
|---|---|---|
| `vanishing-holder` | Task C2 | Holds a ticket, claims its refund and deletes its own account in the same receipt, so the refund transfer fails (`claim_and_vanish`). The same for a payout when it organizes an event (`collect_and_vanish`). It can also send two claims from one receipt (`claim_twice`) and forward any call with its deposit (`forward`), so it can buy, create events and claim like a person. |
| `test-token` | Task T1 | A plain NEP-141 token: the standard implementation of `near-contract-standards` with storage management and metadata, `new(name, symbol, decimals)`, and `faucet()`, which mints 100 whole units to a registered caller. The one fixture that is also deployed on testnet, as the dollar token (`tUSD`, 6 decimals) events can be priced in. |
| `hostile-token` | Task T1 | A NEP-141 token that behaves like the standard one until `set_mode` says otherwise: `fail` (every `ft_transfer` and `ft_transfer_call` panics), `garbage` (`ft_transfer` moves the tokens, then answers `maybe`) or `long` (it moves them, then answers as many bytes as its gas pays for). `call_on_transfer` calls `ft_on_transfer` on any contract with any sender, amount and message without moving a token, and `mint` credits any registered account. |
| `ticket-receiver` | Task C3 | Receives a ticket through `nft_transfer_call` and answers as its `msg` says: keep, return, panic, garbage, oversized, huge (a 4 MiB answer, the protocol's maximum) or re-enter (tries `claim_refund` and `nft_transfer` on the ticket, then logs what it got). `hold` keeps the transfer unresolved across blocks until someone calls `release`, then sends the ticket back. |
