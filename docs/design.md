# Design

How the contract works and why it is built this way. The exact method signatures, JSON shapes and error codes are in the [plan's frozen interface](plans/2026-11-12-ticket-escrow-mvp-plan.md#frozen-interface-v1); every way to cheat we could think of, with the test that stops it, is in the [threat model](threat-model.md).

## The idea in one paragraph

When you buy a ticket today, the money goes to the seller, and a refund is a promise that depends on the seller still having it. Here the price never reaches the organizer until the event has been confirmed. It stays reserved in a contract, attached to the ticket. If the event is cancelled, or the deadline passes and nobody confirmed it, whoever holds the ticket at that moment takes the money back, without asking the organizer, the ticketing site or us.

## Who can do what

| Actor | Can | Cannot |
|---|---|---|
| Organizer | Create an event with fixed terms and prepay its storage. Cancel it. Collect after it is confirmed. | Change the terms. Touch the money before confirmation. Confirm their own event. |
| Verifier | Accept the terms before any ticket is sold. Confirm the event took place, after it ends and before the deadline. Cancel it. | Receive money. Confirm early or late. Be the organizer. |
| Buyer | Buy at exactly the price while the event is on sale. | Pay more or less than the price. Buy before the verifier accepted. |
| Holder | Transfer the ticket before the event starts. Claim the refund when the event is refundable. | Claim twice. Claim after transferring the ticket away. |
| Anyone | Switch an unresolved event to refunds once the deadline has passed. Read everything. | Anything else. There is no owner, no admin and no upgrade method. |

The verifier is the one party you must trust, and the contract says so instead of hiding it: a verifier who lies and confirms an event that never happened releases the money to the organizer (test `t21_false_attestation_is_a_trust_limit`). What the design removes is the need to trust the organizer, and the need for anybody to act for a refund to become possible.

## The rules

| Id | Rule |
|---|---|
| R1 | Each ticket records a fixed principal `P`, the price paid. Its current holder owns the right to the refund of exactly `P`. |
| R2 | An event is `Unresolved` until exactly one of: the verifier confirms it between its end and the deadline (`Completed`); the organizer or the verifier cancels it before the deadline (`Refundable`); anyone expires it once the deadline has passed (`Refundable`). The outcome never changes again. |
| R3 | The organizer cannot receive anything while the event is `Unresolved` or `Refundable`. |
| R4 | Tickets are sold only after the verifier accepted the exact terms, at exactly the price, before the start and within capacity. |
| R5 | Terms never change after creation. |
| R6 | A ticket can be transferred by its holder only while the event is `Unresolved`, before it starts, and while the ticket has no pending operation. |
| R7 | Settlement reserves first: the right is debited and a pending operation recorded before the transfer is scheduled; a private callback confirms on success and restores on a confirmed failure; nothing is retried on a timer. |
| R8 | While a ticket has a pending refund or an unresolved transfer to a contract, it cannot be transferred or refunded. |
| R9 | The organizer prepays storage for the whole capacity at creation. Ticket money never pays for storage, and one event can never spend another event's principal. |
| R10 | The contract has no owner, no admin method, no upgrade method and no way to move principal outside R1–R8. The final deployment has zero access keys. |
| R11 | The event outcome and each payment's result are separate facts: `Completed` does not mean the organizer was paid; `Refundable` does not mean holders were refunded. |

## An event's life

```mermaid
stateDiagram-v2
    [*] --> Unresolved: create_event (organizer, storage prepaid)
    Unresolved --> Completed: attest_completed (verifier, ends_at <= now < deadline)
    Unresolved --> Refundable: cancel_event (organizer or verifier, now < deadline)
    Unresolved --> Refundable: expire_event (anyone, now >= deadline)
    Completed --> [*]
    Refundable --> [*]
```

Three stored outcomes, one transition each way, and no way back. Everything else a screen shows ("on sale", "sold out", "in progress", "awaiting confirmation", "deadline passed") is derived from the outcome and the block time and returned by the view as `phase`, so the web and the agent never compute time rules themselves.

The deadline is the piece that makes the organizer unnecessary. Refunds do not wait for someone to admit the event failed: once `resolution_deadline_ms` has passed without a confirmation, any account can call `expire_event`, and `claim_refund` does it by itself if nobody has. The time is `env::block_timestamp_ms()`, the same clock for every participant. Boundaries are exclusive on the side that protects the holder: confirming at exactly the deadline is too late (`t15_deadline_boundaries`).

## A ticket's life

A ticket is an NFT (NEP-171) minted by the same contract, with id `<event>-<serial>`. The standard token storage is the only record of who holds it; the ticket record stores the principal and a status, never an owner, so the holder and the refund right cannot drift apart.

| Stored status | Meaning | Can be transferred | Can be refunded |
|---|---|---|---|
| `Active` | Nothing in flight. | Yes, before the start of an unresolved event | Yes, if the event is refundable |
| `TransferPending` | Sent to a contract with `nft_transfer_call`; waiting for its answer. | No | No |
| `RefundPending` | A refund transfer was scheduled; waiting for its callback. | No | No |
| `Refunded` | The principal was paid out. | No | No |

What the holder is owed is derived as `claim`: `Reserved`, `Refundable`, `RefundPending`, `Refunded` or `ReleasedToOrganizer`. Approvals (letting a third account move your ticket) are disabled: the only way to move a ticket is its holder signing a transfer, which in the web carries the sentence "You will lose the right to the refund".

Each ticket keeps a short history (first entry and the latest fifteen, with a count of what was dropped), enough to show a buyer where a ticket has been without letting the history grow without bound.

## The money

Each event has its own ledger. This identity holds after every call and every callback, and the tests read it back after each step:

```text
principal_received = principal_reserved + organizer_available + refund_pending + organizer_pending
                   + refunds_settled + organizer_settled
```

A ten-ticket event at 1 NEAR, following one refund:

| Moment | Reserved | Refund pending | Refunds settled | Total |
|---|---:|---:|---:|---:|
| After ten purchases | 10 | 0 | 0 | 10 |
| Event becomes `Refundable` | 10 | 0 | 0 | 10 |
| A holder claims | 9 | 1 | 0 | 10 |
| The callback sees the transfer succeeded | 9 | 0 | 1 | 10 |
| Or: the callback sees the transfer failed | 10 | 0 | 0 | 10 |

The last two rows are alternatives. Pending amounts are never counted as money the contract still has.

Counters alone are not trusted. Before scheduling any transfer of `X`, the contract checks its real balance: what remains must cover its storage and everything still held for every event (`account_balance - X >= storage_cost + total_held`). A call that would break this is rejected whole with `ERR_INSUFFICIENT_LIQUIDITY`. This is what keeps one event from paying out with another event's reserve (`t19_events_do_not_share_money`).

The organizer's storage deposit is a separate figure (`operating_budget`), outside the identity. It is quoted by the contract for the event's full capacity in its worst state (longest account names, full histories, every ticket pending) and is not returned: the tickets stay on chain as a record.

## Paying out: reserve first, confirm later

On NEAR a transfer to another account is a separate receipt that runs in a later block, and it can fail on its own (for example, the receiving account no longer exists). A contract that pays and then updates its books can be made to pay twice; one that assumes the transfer worked can lose a holder's right. So every payment follows the same four steps:

```mermaid
sequenceDiagram
    participant H as Holder
    participant C as Contract
    participant A as Recipient account
    H->>C: claim_refund (1 yocto, enough gas for the callback)
    C->>C: check holder, outcome, liquidity
    C->>C: debit the ledger, record operation, ticket = RefundPending
    C-->>A: transfer P (a later receipt)
    A-->>C: on_refund_result(operation) (private callback, fixed gas)
    alt transfer succeeded
        C->>C: refunds_settled += P, ticket = Refunded
    else transfer failed
        C->>C: principal_reserved += P, ticket = Active (claim again later)
    end
```

- The right is debited before the money leaves, so a second claim in the meantime finds nothing to claim (`t08_no_double_refund`).
- The callback is private: only the contract can tell itself how a payment ended (`t14_callbacks_are_private`).
- A failed transfer restores the right exactly once (`t10_failed_transfer_restores_claim_once`), and a new claim is paid only when the contract can pay it without touching money held for others: if the returned funds have not arrived yet, it is rejected and can be sent again (`t24_restored_claim_waits_for_liquidity`).
- A claim without enough gas for the callback is rejected before anything is reserved (`claim_with_low_gas_fails_whole`).
- If the callback itself fails, the operation stays pending and nothing is sent again (`t11_failed_callback_keeps_pending`). We chose a stuck payment over a double payment, and there is deliberately no admin method to "unstick" it: such a method would be a way to move money outside the rules. This is a stated limit, not a solved problem.

The organizer's payout uses the same path (`claim_payout`, `on_payout_result`, `t18_payout_failure_paths`). Nobody is paid in a loop: each holder claims their own ticket, so the cost of a cancellation does not grow with the number of tickets and one bad recipient cannot block the others.

## Tickets sent to other contracts

`nft_transfer_call` lets a ticket be sent to a contract (a marketplace, a vault) that may accept it or hand it back. Between the transfer and that answer, the ticket's holder is not settled, so the ticket is locked: it cannot be transferred again or refunded until the resolver runs (`t12_transfer_call_receiver_outcomes`, including a receiver that tries to claim the refund from inside its own callback). The resolver ignores the time window, so a ticket that left before the start can still come back after it (`t13_resolver_ignores_time_window`), and it treats a failed, malformed or oversized answer as "return the ticket".

## What NEAR does here

- **Accounts with names and removable keys.** The verifier is a named account buyers can read and recognise before paying. The contract account's keys can be deleted, after which no one, including us, can change the code or move its balance: `scripts/verify-deployment.mjs` reads the code hash and the empty key list from the chain.
- **Asynchronous receipts and callbacks.** The settlement design above is written for them rather than against them: a pending-operation record, a private callback with fixed gas, and an explicit result for each payment.
- **The NFT standards (NEP-171, 177, 181).** The ticket is a standard token that wallets, explorers and other contracts already understand, and its ownership record is the one the refund follows.
- **Storage staking.** State costs balance, so the organizer prepays a measured budget and ticket money is never used for it.
- **Structured events (NEP-297).** Every step logs an event (`ticket_escrow` v1.0.0), so an indexer could rebuild the whole history; the web does not need one.
- **Fees low enough to act alone.** Each holder pays the network fee of their own claim (measured per method in `docs/gas.md`), which is what makes "no batch payout, no operator" practical.
- **A sandbox that controls time and state.** The tests move the block time past deadlines, delete accounts mid-flow and force a balance shortfall, so the failure paths above are exercised, not argued.

## Decisions and what they cost

| Decision | Why | Cost |
|---|---|---|
| One contract, native NEAR, fixed price, no platform fee | Fewer mechanisms to get wrong in the time available | No stable-value pricing, no card payments |
| The whole price is reserved | The reserve must be there when a refund is due | The organizer cannot fund production with ticket sales before the event |
| A named verifier per event, accepted before sales | Somebody must say whether a physical event happened; make it explicit | Trust in that account; a silent verifier means refunds, even for an event that took place |
| Anyone can expire, each holder claims | No dependency on the organizer or on us | The holder needs an account, gas and network access |
| Terms are immutable | What was bought is what is enforced | A typo means cancelling and creating a new event |
| No owner, no upgrade, keys deleted at the end | Nobody can change the rules after money arrives | Bugs cannot be patched; a new version is a new deployment |
| The ticket is the only ownership record | The refund cannot follow a stale copy | Transfers lock during contract-to-contract hand-offs |
| No AI or off-chain service decides anything | A confirmation must come from an accountable party | The agent only spends its own account, within its caps |

Smaller decisions taken while building are recorded one per file in [`docs/decisions/`](decisions/README.md).

## Limits

This is a hackathon prototype on testnet. It has not been audited and must not hold real money. The verifier can lie; a failed callback can leave one payment pending for good; a lost key is a lost ticket; the web and the RPC can be wrong or down (the contract can always be called directly); and the value of NEAR against any currency is not our concern here. The full list, with what each means for a user, is in the [threat model](threat-model.md#limits).

## After the prototype

Paid resale with the price split enforced in the same transaction, entry at the door (a ticket is not proof of identity), a verifier that is a group with its own voting rules, refund claims that anyone can trigger on a holder's behalf, release of storage deposits once an event is fully settled, and an audited recovery path for payments left pending.
