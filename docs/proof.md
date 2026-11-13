# Proof: the two stories on NEAR testnet

Written by `scripts/demo-scenario.mjs` on 2026-11-13T02:55:18.560Z. Do not edit by hand: run the script again.

Contract: [`te-d3-escrow.testnet`](https://testnet.nearblocks.io/address/te-d3-escrow.testnet), code hash `7xxbiuAPNNQuphcR3ep48YqaJBXY6ZjpE8i2FAjBgwax`, 1 access key(s) at block 277452553.

Every row is a real testnet transaction, judged by reading its status by hash at final finality and checking every receipt, or a view read at final finality. The accounts are demo accounts held by the script; the money is testnet NEAR. "Rule and test" names the rule in `docs/design.md` and the sandbox test that pins the same behaviour.

Result: every step ended as expected.

## A. The organizer disappears

Nobody confirms the event. After the deadline anyone can switch it to refunds, and the refund goes to whoever holds the ticket.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| A1 | Organizer creates "Jazz night" and prepays 0.14 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `1` | [8rmC6qAD…](https://testnet.nearblocks.io/txns/8rmC6qADk5PmpPwGUKiuaEQLim8ZAnwT596zk9KGrpGW) |
| A2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [BxzzZYgv…](https://testnet.nearblocks.io/txns/BxzzZYgvtWV4bwCX5HZzcaqWWYTn79q3d2Ye56t5Ziij) |
| A3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"1-1"` | [BtsxKwAn…](https://testnet.nearblocks.io/txns/BtsxKwAn1Aw8TxDjUnseRoRmszYea8MZmeWBaHKY3Hae) |
| A4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| A5 | Organizer tries to collect before any confirmation | `te-d1-organizer.testnet` | R3 · `t03_organizer_cannot_withdraw_unresolved` | rejected with `ERR_NOT_COMPLETED` | rejected with `ERR_NOT_COMPLETED` | [HPzDKx4T…](https://testnet.nearblocks.io/txns/HPzDKx4ThH3ztRiSD2iDdMy2nGVGwGAmGMtP6JvEPKjN) |
| A6 | Ana transfers ticket 1-1 to Luis | `te-d1-ana.testnet` | R6 · `t07_refund_follows_the_holder` | succeeds | succeeded | [273wQevG…](https://testnet.nearblocks.io/txns/273wQevGSzxE8VDrmbcohPqMuhuHdv7W43MTG6KviKB5) |
| A7 | A stranger switches the event to refunds after the deadline | `te-d1-anyone.testnet` | R2 · `t05_anyone_expires_after_deadline` | succeeds, returns `"Refundable"` | succeeded, returned `"Refundable"` | [HXouJMFK…](https://testnet.nearblocks.io/txns/HXouJMFKvUdSpCard1jkqRFWBbfPpjrSA4xw1DmV3o2N) |
| A8 | Ana, who sold the ticket, tries to claim the refund | `te-d1-ana.testnet` | R1 · `t07_refund_follows_the_holder` | rejected with `ERR_UNAUTHORIZED` | rejected with `ERR_UNAUTHORIZED` | [HgvMndRN…](https://testnet.nearblocks.io/txns/HgvMndRNo7tNYCxaFRd1cymLkH7fY7CcBC8PZZV5Ain9) |
| A9 | Luis, the holder, claims 0.5 NEAR | `te-d1-luis.testnet` | R1, R7 · `t09_refund_pays_exact_principal` | succeeds, returns `true` | succeeded, returned `true` | [47V26Y8c…](https://testnet.nearblocks.io/txns/47V26Y8csP7mfp117AVWxeUF5m7VgyWio3nvYsxQMmYw) |
| A10 | Luis's balance grew by the price, minus his own gas | `read at final` | R1 · `t09_refund_pays_exact_principal` | between 0.45 and 0.5 NEAR | 0.499433 NEAR |  |
| A11 | Luis tries to claim the same ticket again | `te-d1-luis.testnet` | R8 · `t08_no_double_refund` | rejected with `ERR_ALREADY_REFUNDED` | rejected with `ERR_ALREADY_REFUNDED` | [8DZj4Ynf…](https://testnet.nearblocks.io/txns/8DZj4YnfGpL4iCmVJ3FyMkrKXqaMQfBBKGmhuoNST9LQ) |
| A12 | The books close: refunded once, nothing left for the organizer | `read at final` | R11 · accounting identity | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 |  |

## B. The event takes place

The verifier agreed in advance confirms it. Only then can the organizer collect.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| B1 | Organizer creates "Opening night" and prepays 0.14 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `3` | [841sy6P6…](https://testnet.nearblocks.io/txns/841sy6P6K8R4PGY4vHQc1nziwrD1ouEczc35gneXoYaG) |
| B2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [F2uW1hiy…](https://testnet.nearblocks.io/txns/F2uW1hiy2SxxEZavbeVg7bZQk5Bg2LFxwhMZo8MuFqSi) |
| B3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"3-1"` | [GVPmnyRG…](https://testnet.nearblocks.io/txns/GVPmnyRGJEXSU1vkuktkVRbTwtvrrShdzYYaUV6PmScF) |
| B4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| B5 | Verifier confirms the event took place | `te-d1-verifier.testnet` | R2 · `t04_attestation_completes_event` | succeeds | succeeded | [2FyuRVjL…](https://testnet.nearblocks.io/txns/2FyuRVjLuP3f6mz3HyFPRSr5DWf2CUTGY64pC4kqa4CA) |
| B6 | Ana tries to claim a refund for an event that took place | `te-d1-ana.testnet` | R2 · `t04_attestation_completes_event` | rejected with `ERR_NOT_REFUNDABLE` | rejected with `ERR_NOT_REFUNDABLE` | [CbezLGh3…](https://testnet.nearblocks.io/txns/CbezLGh3hYaZqvxuP5yz6jH9qB1SG8MsD6EU5dK6RWDQ) |
| B7 | Organizer collects 0.5 NEAR | `te-d1-organizer.testnet` | R3, R7 · `t18_payout_failure_paths` | succeeds, returns `true` | succeeded, returned `true` | [3gxU75kL…](https://testnet.nearblocks.io/txns/3gxU75kL3D67xx7wVUS4hffLvE7xzm2e3X7sov8h38Nk) |
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
    "operating_budget": "140000000000000000000000"
  },
  "event 3": {
    "event_id": 3,
    "principal_received": "500000000000000000000000",
    "principal_reserved": "0",
    "refund_pending": "0",
    "refunds_settled": "0",
    "organizer_available": "0",
    "organizer_pending": "0",
    "organizer_settled": "500000000000000000000000",
    "operating_budget": "140000000000000000000000"
  }
}
```
