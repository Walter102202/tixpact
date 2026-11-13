# Proof: the two stories on NEAR testnet

Written by `scripts/demo-scenario.mjs` on 2026-11-13T12:05:32.150Z. Do not edit by hand: run the script again.

Contract: [`te-d4-escrow.testnet`](https://testnet.nearblocks.io/address/te-d4-escrow.testnet), code hash `HVyFFXATaegV6kptSDZhR9VUuo3itjYvUoR8NsKDitgK`, 1 access key(s) at block 277508348.

Every row is a real testnet transaction, judged by reading its status by hash at final finality and checking every receipt, or a view read at final finality. The accounts are demo accounts held by the script; the money is testnet NEAR. "Rule and test" names the rule in `docs/design.md` and the sandbox test that pins the same behaviour.

Result: every step ended as expected.

## A. The organizer disappears

Nobody confirms the event. After the deadline anyone can switch it to refunds, and the refund goes to whoever holds the ticket.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| A1 | Organizer creates "Jazz night" and prepays 0.1414 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `1` | [HS8TTgaB…](https://testnet.nearblocks.io/txns/HS8TTgaBdGyr4Mdv6es8Q8iteAgvMkqUVCTXP7HNRXW6) |
| A2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [BMhTL8NF…](https://testnet.nearblocks.io/txns/BMhTL8NFYYDfeZ5RPAHB2My9Awa6XLGoB1hUi1UYcyEh) |
| A3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"1-1"` | [GVE3vBod…](https://testnet.nearblocks.io/txns/GVE3vBod5JRxWw6c28C5jtTmXxqLPevz2ou3ytxCAX7u) |
| A4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| A5 | Organizer tries to collect before any confirmation | `te-d1-organizer.testnet` | R3 · `t03_organizer_cannot_withdraw_unresolved` | rejected with `ERR_NOT_COMPLETED` | rejected with `ERR_NOT_COMPLETED` | [77awx39M…](https://testnet.nearblocks.io/txns/77awx39MQYQEtTnCfYCAAsJ3RZfoAcGbWienk3Hrkeer) |
| A6 | Ana transfers ticket 1-1 to Luis | `te-d1-ana.testnet` | R6 · `t07_refund_follows_the_holder` | succeeds | succeeded | [Dssge9dp…](https://testnet.nearblocks.io/txns/Dssge9dpmZNDpP93iQbtLcLDhz24aMARqm9WNoGUX8iC) |
| A7 | A stranger switches the event to refunds after the deadline | `te-d1-anyone.testnet` | R2 · `t05_anyone_expires_after_deadline` | succeeds, returns `"Refundable"` | succeeded, returned `"Refundable"` | [FWDHCkCS…](https://testnet.nearblocks.io/txns/FWDHCkCSAsWdT2PefXNk39fPFcfXLJfn5AdKLpv8r9P) |
| A8 | Ana, who sold the ticket, tries to claim the refund | `te-d1-ana.testnet` | R1 · `t07_refund_follows_the_holder` | rejected with `ERR_UNAUTHORIZED` | rejected with `ERR_UNAUTHORIZED` | [CUHyn4ka…](https://testnet.nearblocks.io/txns/CUHyn4kavZq8t1Ndieb6dnr1jmFBMk95ZYb9PnwBtTqM) |
| A9 | Luis, the holder, claims 0.5 NEAR | `te-d1-luis.testnet` | R1, R7 · `t09_refund_pays_exact_principal` | succeeds, returns `true` | succeeded, returned `true` | [BCzZMaKq…](https://testnet.nearblocks.io/txns/BCzZMaKqxVuNMFDGqXZqhkMoHxzE7JYBh1VkSi33Pesp) |
| A10 | Luis's balance grew by the price, minus his own gas | `read at final` | R1 · `t09_refund_pays_exact_principal` | between 0.45 and 0.5 NEAR | 0.499432 NEAR |  |
| A11 | Luis tries to claim the same ticket again | `te-d1-luis.testnet` | R8 · `t08_no_double_refund` | rejected with `ERR_ALREADY_REFUNDED` | rejected with `ERR_ALREADY_REFUNDED` | [CLnEvm4h…](https://testnet.nearblocks.io/txns/CLnEvm4hW2kcBvU7Zkonk8xoeytPodkcryfZKv3P1BFj) |
| A12 | The books close: refunded once, nothing left for the organizer | `read at final` | R11 · accounting identity | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 |  |

## B. The event takes place

The verifier agreed in advance confirms it. Only then can the organizer collect.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| B1 | Organizer creates "Opening night" and prepays 0.1414 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `2` | [HDfkPHs5…](https://testnet.nearblocks.io/txns/HDfkPHs5v6XtugHPR22ZS4Q1R91usiCrpUHHjosnALU7) |
| B2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [GsDcKxPj…](https://testnet.nearblocks.io/txns/GsDcKxPjBZREUchsq1s8dFHZLN4GCdivwV3w2e3v4F5X) |
| B3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"2-1"` | [G1yQ43Vq…](https://testnet.nearblocks.io/txns/G1yQ43VqGeiSK3f5rVFsLmTfJKG5T2onNZmsDoZZSrtA) |
| B4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| B5 | Verifier confirms the event took place | `te-d1-verifier.testnet` | R2 · `t04_attestation_completes_event` | succeeds | succeeded | [FdBbgBNV…](https://testnet.nearblocks.io/txns/FdBbgBNVJs4RTYMcpffpJyiFPiZZxZRCk7rDx6totsTB) |
| B6 | Ana tries to claim a refund for an event that took place | `te-d1-ana.testnet` | R2 · `t04_attestation_completes_event` | rejected with `ERR_NOT_REFUNDABLE` | rejected with `ERR_NOT_REFUNDABLE` | [JACKX5sr…](https://testnet.nearblocks.io/txns/JACKX5srrF4bBX7Jj74cLkWGXqr9hRYV4Kg98wKVkitu) |
| B7 | Organizer collects 0.5 NEAR | `te-d1-organizer.testnet` | R3, R7 · `t18_payout_failure_paths` | succeeds, returns `true` | succeeded, returned `true` | [cazjYNHH…](https://testnet.nearblocks.io/txns/cazjYNHHNm1gaXX4wTyTFV9cfJYg8HbL1UJn7GpsB7J) |
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
