# Proof: the stories on NEAR testnet

Written by `scripts/demo-scenario.mjs` on 2026-11-13T19:44:27.016Z. Do not edit by hand: run the script again.

Contract: [`ticket-escrow-v2.testnet`](https://testnet.nearblocks.io/address/ticket-escrow-v2.testnet), code hash `CwryMXK37NQ5KUR22Ca23bubTJZXrKiis1qph3QE5VXP`, 1 access key(s) at block 277555836.

Every row is a real testnet transaction, judged by reading its status by hash at final finality and checking every receipt, or a view read at final finality. The accounts are demo accounts held by the script; the money is testnet NEAR and, in story C, a test dollar token. "Rule and test" names the rule in `docs/design.md` and the sandbox test that pins the same behaviour.

Result: every step ended as expected.

## A. The organizer disappears

Nobody confirms the event. After the deadline anyone can switch it to refunds, and the refund goes to whoever holds the ticket.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| A1 | Organizer creates "Jazz night" and prepays 0.1423 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `4` | [4E9xUALU…](https://testnet.nearblocks.io/txns/4E9xUALUb2H7rofeq4Krxdhr53GoBbiPCqSVXzkY5R9g) |
| A2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [EEbqxgNg…](https://testnet.nearblocks.io/txns/EEbqxgNgXC58Y8JG7oz8o1WWRFJa2NqZV6BR5Gsmmnkn) |
| A3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"4-1"` | [ETNsctWk…](https://testnet.nearblocks.io/txns/ETNsctWkqPYnJLDbgt4SyL59HBipadY29Wzn33Xc5UBw) |
| A4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| A5 | Organizer tries to collect before any confirmation | `te-d1-organizer.testnet` | R3 · `t03_organizer_cannot_withdraw_unresolved` | rejected with `ERR_NOT_COMPLETED` | rejected with `ERR_NOT_COMPLETED` | [5CN75oSH…](https://testnet.nearblocks.io/txns/5CN75oSHcFkv9ih2NuDaXdTTw8siiMSDzLGwHXBa6b5T) |
| A6 | Ana transfers ticket 4-1 to Luis | `te-d1-ana.testnet` | R6 · `t07_refund_follows_the_holder` | succeeds | succeeded | [2E8ZuzKu…](https://testnet.nearblocks.io/txns/2E8ZuzKunYs35AZtKQBWBdRwMfPHY4amzWLsAoUh77TR) |
| A7 | A stranger switches the event to refunds after the deadline | `te-d1-anyone.testnet` | R2 · `t05_anyone_expires_after_deadline` | succeeds, returns `"Refundable"` | succeeded, returned `"Refundable"` | [6K9BKjtm…](https://testnet.nearblocks.io/txns/6K9BKjtm1DDZboS52Kbs8vPGpBsVCoG4M14PCCB56onf) |
| A8 | Ana, who sold the ticket, tries to claim the refund | `te-d1-ana.testnet` | R1 · `t07_refund_follows_the_holder` | rejected with `ERR_UNAUTHORIZED` | rejected with `ERR_UNAUTHORIZED` | [J58Kz444…](https://testnet.nearblocks.io/txns/J58Kz444NtLyBAy59WKvPUM3c366hszYCbh6zSPCG5ZX) |
| A9 | Luis, the holder, claims 0.5 NEAR | `te-d1-luis.testnet` | R1, R7 · `t09_refund_pays_exact_principal` | succeeds, returns `true` | succeeded, returned `true` | [38exzpdm…](https://testnet.nearblocks.io/txns/38exzpdmQovUmE2h5ZqvzdUoNiBQ6RmuYC7qC9V3znhv) |
| A10 | Luis's balance grew by the price, minus his own gas | `read at final` | R1 · `t09_refund_pays_exact_principal` | between 0.45 and 0.5 NEAR | 0.499402 NEAR |  |
| A11 | Luis tries to claim the same ticket again | `te-d1-luis.testnet` | R8 · `t08_no_double_refund` | rejected with `ERR_ALREADY_REFUNDED` | rejected with `ERR_ALREADY_REFUNDED` | [8dp8c9zM…](https://testnet.nearblocks.io/txns/8dp8c9zMkDKAE9ReuVaXQFPpbG3Unr8uUyHwtnx5ze4X) |
| A12 | The books close: refunded once, nothing left for the organizer | `read at final` | R11 · accounting identity | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 | refunds_settled = 500000000000000000000000, principal_reserved = 0, organizer_available = 0 |  |
| A13 | After the refund, the ticket itself says so: its NFT text and picture are computed from its state | `read at final` | NEP-177 · `t32_metadata_follows_the_state` | the description ends with "0.5 NEAR was refunded to the holder." and the picture is drawn by the contract | "Ticket 1 of 5 for Jazz night at Teatro Municipal. 0.5 NEAR was refunded to the holder.", with a picture drawn by the contract |  |

## B. The event takes place

The verifier agreed in advance confirms it. Only then can the organizer collect.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| B1 | Organizer creates "Opening night" and prepays 0.1423 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `6` | [eoUwNKmU…](https://testnet.nearblocks.io/txns/eoUwNKmUtHm3FW5BzRHRUjFakxXb1dNbXNsiYvfvkxE) |
| B2 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [8mgN9Sed…](https://testnet.nearblocks.io/txns/8mgN9SeduX17B9KKN7ZhccNCMFGdiDKWjU4ma5ZV2hFx) |
| B3 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | R1, R4 · `t01_purchase_reserves_exact_price` | succeeds | succeeded, returned `"6-1"` | [9WeG4VSF…](https://testnet.nearblocks.io/txns/9WeG4VSFCtNmK5BCRazBCpcfQp2rAMAes1hTpvwfYvxd) |
| B4 | The price is reserved in the contract, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 500000000000000000000000, organizer_available = 0 | principal_reserved = 500000000000000000000000, organizer_available = 0 |  |
| B5 | Verifier confirms the event took place | `te-d1-verifier.testnet` | R2 · `t04_attestation_completes_event` | succeeds | succeeded | [BuRoMKrX…](https://testnet.nearblocks.io/txns/BuRoMKrXyJJKLaqB7FeE8VBYEXfdT5CzXfspJE6mbNor) |
| B6 | Ana tries to claim a refund for an event that took place | `te-d1-ana.testnet` | R2 · `t04_attestation_completes_event` | rejected with `ERR_NOT_REFUNDABLE` | rejected with `ERR_NOT_REFUNDABLE` | [BkZHuhn4…](https://testnet.nearblocks.io/txns/BkZHuhn4hEfuzniFZ4BJPAbwZLewTXVZbRJtzHBgWnLX) |
| B7 | Organizer collects 0.5 NEAR | `te-d1-organizer.testnet` | R3, R7 · `t18_payout_failure_paths` | succeeds, returns `true` | succeeded, returned `true` | [8FKcKRNt…](https://testnet.nearblocks.io/txns/8FKcKRNt2LkFUudQ82mstmZ3gDs7LhpphuwAdbJiSb8h) |
| B8 | The books close: paid once to the organizer | `read at final` | R11 · accounting identity | organizer_settled = 500000000000000000000000, organizer_available = 0 | organizer_settled = 500000000000000000000000, organizer_available = 0 |  |
| B9 | After the payout, the ticket itself says so: its NFT text and picture are computed from its state | `read at final` | NEP-177 · `t32_metadata_follows_the_state` | the description ends with "The event was confirmed and the price went to the organizer." and the picture is drawn by the contract | "Ticket 1 of 5 for Opening night at Teatro Municipal. The event was confirmed and the price went to the organizer.", with a picture drawn by the contract |  |

## C. The price is in dollars

The event is priced in tUSD, the token [`tusd.ticket-escrow-v2.testnet`](https://testnet.nearblocks.io/address/tusd.ticket-escrow-v2.testnet): a test dollar with 6 decimals that anyone can mint from its faucet. On mainnet this place would be taken by a real dollar token. The rules are those of story A. What changes is how the money moves: the buyer pays by asking the token to transfer the price and call the contract, and a token only pays accounts registered with it. Luis is not registered, so his first claim pays nothing and loses nothing.

| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |
|---|---|---|---|---|---|---|
| C1 | The contract is registered with tUSD, so the token lets it hold the price | `read at final` | deployment | registered | registered |  |
| C2 | Setup: Luis sends the 10 tUSD of an earlier run to Ana | `te-d1-luis.testnet` | setup | succeeds | succeeded | [DkjqucB9…](https://testnet.nearblocks.io/txns/DkjqucB9BJ2oXy96Lzu8uuTuovysLYMG4R5F238zorAK) |
| C3 | Setup: Luis closes his registration with tUSD | `te-d1-luis.testnet` | setup | succeeds, returns `true` | succeeded, returned `true` | [BzKjzdvg…](https://testnet.nearblocks.io/txns/BzKjzdvggFCXLQawdzkAacC6Wzr6FApBnyyEUffTennz) |
| C4 | Organizer creates "Dollar night" and prepays 0.1423 NEAR of storage | `te-d1-organizer.testnet` | R5, R9 | succeeds | succeeded, returned `7` | [FucLDuUS…](https://testnet.nearblocks.io/txns/FucLDuUSa32USg4hF6nNWDvisPqxbiuevb6UfTC4g46u) |
| C5 | Verifier accepts the exact terms | `te-d1-verifier.testnet` | R4 · `t02_purchase_needs_acceptance_and_capacity` | succeeds | succeeded | [7pj3MuRY…](https://testnet.nearblocks.io/txns/7pj3MuRYzqBT7JgBPN2Wa34vj4p5c1Bzteafa7GLLFgR) |
| C6 | Ana tries to pay this event with NEAR | `te-d1-ana.testnet` | R4 · `t26_only_the_event_currency_buys` | rejected with `ERR_WRONG_CURRENCY` | rejected with `ERR_WRONG_CURRENCY` | [2QDTVCXp…](https://testnet.nearblocks.io/txns/2QDTVCXpAaVGHSyS8tuyc61DEqVh5uJe8GQWVirz7yZr) |
| C7 | Ana sends 9.999999 tUSD, less than the price | `te-d1-ana.testnet` | R4 · `t25_token_purchase_reserves_exact_price` | nothing bought, the contract answers `ERR_WRONG_DEPOSIT` | nothing bought, the contract answered `ERR_WRONG_DEPOSIT` | [FjHkxBv8…](https://testnet.nearblocks.io/txns/FjHkxBv8wsdsAivpwqbDyTK8GCSBLXa1iLgUZgayemii) |
| C8 | The token gave the whole amount back to Ana | `read at final` | R4 · `t25_token_purchase_reserves_exact_price` | Ana holds 100 tUSD | Ana holds 100 tUSD |  |
| C9 | Ana buys a ticket for 10 tUSD | `te-d1-ana.testnet` | R1, R4 · `t25_token_purchase_reserves_exact_price` | a ticket is bought | bought ticket `7-1` | [CYGBobCm…](https://testnet.nearblocks.io/txns/CYGBobCm3PLrvDML3n6uuk1vvs92DaSDEUbNgGFsd641) |
| C10 | The price is reserved in the contract, in the token, not paid to the organizer | `read at final` | R1, R3 | principal_reserved = 10000000, organizer_available = 0, the contract holds 10 tUSD more | principal_reserved = 10000000, organizer_available = 0, the contract holds 10 tUSD more |  |
| C11 | Ana transfers ticket 7-1 to Luis, whom tUSD does not know | `te-d1-ana.testnet` | R6 · `t27_token_refund_follows_the_holder` | succeeds | succeeded | [QWYndkZo…](https://testnet.nearblocks.io/txns/QWYndkZoVy2uH2TKYpRkHMhtvnadio89P6vcQXYH3iT) |
| C12 | A stranger switches the event to refunds after the deadline | `te-d1-anyone.testnet` | R2 · `t05_anyone_expires_after_deadline` | succeeds, returns `"Refundable"` | succeeded, returned `"Refundable"` | [31Z7hBQm…](https://testnet.nearblocks.io/txns/31Z7hBQmdyTK83Y7PnfyJYw94KB4ot3obpc6Qywx4Pgx) |
| C13 | Ana, who gave the ticket away, tries to claim the refund | `te-d1-ana.testnet` | R1 · `t27_token_refund_follows_the_holder` | rejected with `ERR_UNAUTHORIZED` | rejected with `ERR_UNAUTHORIZED` | [CQHnzHAs…](https://testnet.nearblocks.io/txns/CQHnzHAsDnuNh7LuKSAWZbe9udAZAQ5YHUy8JQhm6mzd) |
| C14 | Luis claims, but the token does not know him and refuses to pay him | `te-d1-luis.testnet` | R7 · `t28_unregistered_holder_gets_the_right_back_once` | the token rejects the payment and `claim_refund` returns `false` | the token rejected the payment and `claim_refund` returned `false` | [83yKHyeb…](https://testnet.nearblocks.io/txns/83yKHyebm4MTMNo9RjFYXA78pbnAWHWcNcQDCtML3BgG) |
| C15 | Nothing was lost: the right to the refund is back on the ticket and the money is still held | `read at final` | R7 · `t28_unregistered_holder_gets_the_right_back_once` | claim = Refundable, refund_pending = 0, the contract still holds the 10 tUSD | claim = Refundable, refund_pending = 0, the contract holds 10 tUSD of it |  |
| C16 | Luis registers with tUSD | `te-d1-luis.testnet` | R7 | succeeds | succeeded, returned `{"total":"1250000000000000000000","available":"0"}` | [FtkM859N…](https://testnet.nearblocks.io/txns/FtkM859NHe3FGoLfBuRGqawq2GgUMx6VScgFJKnVxifJ) |
| C17 | Luis claims again and is paid 10 tUSD | `te-d1-luis.testnet` | R1, R7 · `t28_unregistered_holder_gets_the_right_back_once` | succeeds, returns `true` | succeeded, returned `true` | [5oA8JShc…](https://testnet.nearblocks.io/txns/5oA8JShc4nZK2ejTZXQLgUXgpF4b2yc6MYDz7kjXQLWZ) |
| C18 | Luis's balance in the token grew by exactly the price | `read at final` | R1 · `t27_token_refund_follows_the_holder` | 10 tUSD | 10 tUSD |  |
| C19 | Luis tries to claim the same ticket again | `te-d1-luis.testnet` | R8 · `t28_unregistered_holder_gets_the_right_back_once` | rejected with `ERR_ALREADY_REFUNDED` | rejected with `ERR_ALREADY_REFUNDED` | [4ccq1vdT…](https://testnet.nearblocks.io/txns/4ccq1vdTy9rsNG4UrLoreSxSpU3UpzXvRVXdsGs983Bh) |
| C20 | The books close: refunded once, and the contract holds no more of the token than before | `read at final` | R11 · accounting identity | refunds_settled = 10000000, principal_reserved = 0, organizer_available = 0, the contract holds 0 more | refunds_settled = 10000000, principal_reserved = 0, organizer_available = 0, the contract holds 0 more |  |
| C21 | After the refund, the ticket itself says so: its NFT text and picture are computed from its state | `read at final` | NEP-177 · `t32_metadata_follows_the_state` | the description ends with "10 tUSD was refunded to the holder." and the picture is drawn by the contract | "Ticket 1 of 5 for Dollar night at Teatro Municipal. 10 tUSD was refunded to the holder.", with a picture drawn by the contract |  |

## The books after the run

```json
{
  "event 4": {
    "event_id": 4,
    "principal_received": "500000000000000000000000",
    "principal_reserved": "0",
    "refund_pending": "0",
    "refunds_settled": "500000000000000000000000",
    "organizer_available": "0",
    "organizer_pending": "0",
    "organizer_settled": "0",
    "operating_budget": "142310000000000000000000",
    "currency": null
  },
  "event 6": {
    "event_id": 6,
    "principal_received": "500000000000000000000000",
    "principal_reserved": "0",
    "refund_pending": "0",
    "refunds_settled": "0",
    "organizer_available": "0",
    "organizer_pending": "0",
    "organizer_settled": "500000000000000000000000",
    "operating_budget": "142310000000000000000000",
    "currency": null
  },
  "event 7": {
    "event_id": 7,
    "principal_received": "10000000",
    "principal_reserved": "0",
    "refund_pending": "0",
    "refunds_settled": "10000000",
    "organizer_available": "0",
    "organizer_pending": "0",
    "organizer_settled": "0",
    "operating_budget": "142310000000000000000000",
    "currency": "tusd.ticket-escrow-v2.testnet"
  }
}
```
