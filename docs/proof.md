# Proof: the two stories on NEAR testnet

Written by `scripts/demo-scenario.mjs` on 2026-11-13T13:21:52.481Z. Do not edit by hand: run the script again.

Contract: [`ticket-escrow.testnet`](https://testnet.nearblocks.io/address/ticket-escrow.testnet), code hash `HVyFFXATaegV6kptSDZhR9VUuo3itjYvUoR8NsKDitgK`, 1 access key(s) at block 277516128.

Every row is a real testnet transaction, judged by reading its status by hash at final finality and checking every receipt, or a view read at final finality. The accounts are demo accounts held by the script; the money is testnet NEAR. "Rule and test" names the rule in `docs/design.md` and the sandbox test that pins the same behaviour.

Result: every step ended as expected.

## A. The organizer disappears

Nobody confirms the event. After the deadline anyone can switch it to refunds, and the refund goes to whoever holds the ticket.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| A1 | Organizer creates "Jazz night" and prepays 0.1414 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `1` | [HdZFjvet…](https://testnet.nearblocks.io/txns/HdZFjvetTHPsN4WpmN4RF8Lw1jxg7QfxikUu4CixneMW) |
| A2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [2L67cmcd…](https://testnet.nearblocks.io/txns/2L67cmcdqjkKEGp2SHL8hUybX2ct6WUxabe4foH6wAVB) |
| A3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"1-1"` | [DrC4Sp48…](https://testnet.nearblocks.io/txns/DrC4Sp48zfQAZzgJtFsHRs3htZiDkStMGZHdNV7cSUAU) |
| A4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| A5 | Organizer tries to collect before any confirmation | `te-d1-organizer.testnet` | R3 · `t03_organizer_cannot_withdraw_unresolved` | rejected with `ERR_NOT_COMPLETED` | rejected with `ERR_NOT_COMPLETED` | [EM6MvHh4…](https://testnet.nearblocks.io/txns/EM6MvHh4sVtLXVyziaWD2nLKzVncsxBGoFd1ZQcc4xo6) |
| A6 | Ana transfers ticket 1-1 to Luis | `te-d1-ana.testnet` | R6 · `t07_refund_follows_the_holder` | succeeds | succeeded | [9FN7ewdP…](https://testnet.nearblocks.io/txns/9FN7ewdPzLhhNG9jWA977wbU2vUB6MLcWhGWE7TPmYqJ) |
| A7 | A stranger switches the event to refunds after the deadline | `te-d1-anyone.testnet` | R2 · `t05_anyone_expires_after_deadline` | succeeds, returns `"Refundable"` | succeeded, returned `"Refundable"` | [8jUmQDmv…](https://testnet.nearblocks.io/txns/8jUmQDmvtLq4H32QiPiUdZC9KP2nSxxzEMZ23BMinhSw) |
| A8 | Ana, who sold the ticket, tries to claim the refund | `te-d1-ana.testnet` | R1 · `t07_refund_follows_the_holder` | rejected with `ERR_UNAUTHORIZED` | rejected with `ERR_UNAUTHORIZED` | [BwdB1nBn…](https://testnet.nearblocks.io/txns/BwdB1nBnbrw2ri1zBC4n6vhs7Qc9HcT6XxXttaiqykAR) |
| A9 | Luis, the holder, claims 0.5 NEAR | `te-d1-luis.testnet` | R1, R7 · `t09_refund_pays_exact_principal` | succeeds, returns `true` | succeeded, returned `true` | [6tXiEYtv…](https://testnet.nearblocks.io/txns/6tXiEYtvmXbYVHCSbpagKkLtz8F3xXXwyKBReBt9GLBn) |
| A10 | Luis's balance grew by the price, minus his own gas | `read at final` | R1 · `t09_refund_pays_exact_principal` | between 0.45 and 0.5 NEAR | 0.499418 NEAR |  |
| A11 | Luis tries to claim the same ticket again | `te-d1-luis.testnet` | R8 · `t08_no_double_refund` | rejected with `ERR_ALREADY_REFUNDED` | rejected with `ERR_ALREADY_REFUNDED` | [77TB2pwy…](https://testnet.nearblocks.io/txns/77TB2pwyP6skZxcaryrVVpXWaqvVUFKQ1oRMeyZsautT) |
| A12 | The books close: refunded once, nothing left for the organizer | `read at final` | R11 · accounting identity | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 |  |

## B. The event takes place

The verifier agreed in advance confirms it. Only then can the organizer collect.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| B1 | Organizer creates "Opening night" and prepays 0.1414 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `2` | [FypgLBvi…](https://testnet.nearblocks.io/txns/FypgLBvikQbYwo4EPgEwgdPeKt6TGnRsBnZ1ZeVLYfZN) |
| B2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [BswviXtq…](https://testnet.nearblocks.io/txns/BswviXtqWn8mTFRDibPeQkFa4rEGaaNUGPmSLLL7rHbf) |
| B3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"2-1"` | [3qY5GSwj…](https://testnet.nearblocks.io/txns/3qY5GSwjZN8fvUjKpqgQGvSLncS5YjKkwWehX4JEX2uW) |
| B4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| B5 | Verifier confirms the event took place | `te-d1-verifier.testnet` | R2 · `t04_attestation_completes_event` | succeeds | succeeded | [HKBWTnVV…](https://testnet.nearblocks.io/txns/HKBWTnVV6cuiP7rAEHJm6xpB4H6X9ppUqQHUm8MTJBs5) |
| B6 | Ana tries to claim a refund for an event that took place | `te-d1-ana.testnet` | R2 · `t04_attestation_completes_event` | rejected with `ERR_NOT_REFUNDABLE` | rejected with `ERR_NOT_REFUNDABLE` | [9Rt1AkFs…](https://testnet.nearblocks.io/txns/9Rt1AkFsctQiVJdzc3uXmcke2HWto5mv2iv7RDM6eoza) |
| B7 | Organizer collects 0.5 NEAR | `te-d1-organizer.testnet` | R3, R7 · `t18_payout_failure_paths` | succeeds, returns `true` | succeeded, returned `true` | [4ZM5A5nj…](https://testnet.nearblocks.io/txns/4ZM5A5njZNjRLP59oRGJk1PiBuNoXgoRUu3v3raKXZK5) |
| B8 | The books close: paid once to the organizer | `read at final` | R11 · accounting identity | organizer_settled = 500000000000000000000000, organizer_available = 0 | organizer_settled = 500000000000000000000000, organizer_available = 0 |  |

## The books after the run

```json
{
  "event 1": {
    "event_id": 1,
    "principal_received": "500000000000000000000000",
    "principal_reserved": "0",
    "refund_pending": "0",
    "refunds_settled": "500000000000000000000000",
    "organizer_available": "0",
    "organizer_pending": "0",
    "organizer_settled": "0",
    "operating_budget": "141480000000000000000000"
  },
  "event 2": {
    "event_id": 2,
    "principal_received": "500000000000000000000000",
    "principal_reserved": "0",
    "refund_pending": "0",
    "refunds_settled": "0",
    "organizer_available": "0",
    "organizer_pending": "0",
    "organizer_settled": "500000000000000000000000",
    "operating_budget": "141480000000000000000000"
  }
}
```
