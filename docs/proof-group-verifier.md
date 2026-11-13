# Proof: a verifier that is a group

Recorded on 2026-11-13 from one run of [`scripts/group-verifier.sh`](../scripts/group-verifier.sh) on NEAR testnet. Run the script again to produce your own.

Contract: [`ticket-escrow.testnet`](https://testnet.nearblocks.io/address/ticket-escrow.testnet), event 5, "Jury night".
Verifier: [`ticket-jury.sputnikv2.testnet`](https://testnet.nearblocks.io/address/ticket-jury.sputnikv2.testnet), a Sputnik DAO (version 2.3.1) created for this proof ([creation](https://testnet.nearblocks.io/txns/GM9huQ2eGNafmEVhtvR7nPLfYVXYUAC75snbseC293w7)). Its council has three members, `te-d1-venue.testnet`, `te-d1-verifier.testnet` and `te-d1-auditor.testnet`, and it acts when two of them vote for the same proposal.

## What it shows

The contract was not changed for this. A verifier is an account, and on NEAR an account can be a contract whose calls are decided by votes. So the question "who confirms that the event took place" can be answered with a venue, an auditor and a third party who must agree, instead of one key.

One member alone changes nothing: after the first vote the event was still not accepted (step 3), and later still not confirmed (step 7). Each time the second vote made the DAO call the ticket contract.

## The run

| # | Step | Signed by | Expected | Observed | Transaction |
|---|---|---|---|---|---|
| 1 | The verifier's policy is read from the chain | read | a group of 3, 2 must agree | members `te-d1-venue.testnet`, `te-d1-verifier.testnet`, `te-d1-auditor.testnet`; 2 of 3 | |
| 2 | Organizer creates the event with the DAO as its verifier | `te-d1-organizer.testnet` | succeeds | event 5 | [2qhFTJb5…](https://testnet.nearblocks.io/txns/2qhFTJb5udeQBeiRAfrqXWrfsRdMVe2oxc3vFUCFQi54) |
| 3a | A member proposes that the group accept the exact terms | `te-d1-verifier.testnet` | proposal created | proposal 2 | [6CELjo8c…](https://testnet.nearblocks.io/txns/6CELjo8cV4am4AQ9i3EnyAK4D5ZWYPUyquxYkPfShfom) |
| 3b | The same member votes for it | `te-d1-verifier.testnet` | nothing changes: one vote is not enough | proposal `InProgress`, `verifier_accepted = false` | [EwB6w7Ud…](https://testnet.nearblocks.io/txns/EwB6w7Ud5k6Gp6ExLzgXqQP7jQMxFiWSusKQ3d28q1F) |
| 4 | A second member votes for it | `te-d1-auditor.testnet` | the DAO calls `accept_verification`; the event goes on sale | proposal `Approved`, `verifier_accepted = true`, phase `OnSale` | [J1JKejAJ…](https://testnet.nearblocks.io/txns/J1JKejAJzpRyK3KbaPizhXxct8ZZTL3oJJkXYeZYUGFa) |
| 5 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | ticket 5-1, price reserved | ticket `5-1`, `principal_reserved = 500000000000000000000000` | [37xSN4eJ…](https://testnet.nearblocks.io/txns/37xSN4eJRNcbYAjcLGoM4rpk2PEoTxmRcvH2CqHY65Y3) |
| 6 | The event ends | chain clock | | | |
| 7a | A member proposes that the group confirm the event | `te-d1-verifier.testnet` | proposal created | proposal 3 | [ESoMBCUD…](https://testnet.nearblocks.io/txns/ESoMBCUDxaq5Zr7rFdm95yyRVqoTr4SxpUDRNgadc2da) |
| 7b | The same member votes for it | `te-d1-verifier.testnet` | nothing changes | outcome `Unresolved` | [swQLU5pw…](https://testnet.nearblocks.io/txns/swQLU5pwY7WLV8Ub1JjSqpGzAiykiZaPP9vTVJVWz7D) |
| 8 | A second member votes for it | `te-d1-auditor.testnet` | the DAO calls `attest_completed` | proposal `Approved`, outcome `Completed`, `resolved_by = ticket-jury.sputnikv2.testnet` | [9WqF6yJG…](https://testnet.nearblocks.io/txns/9WqF6yJGFUx3C4oZWBS61gTX6XziP4ZsjsRkeSLTmq8w) |
| 9 | Organizer collects | `te-d1-organizer.testnet` | paid 0.5 NEAR | `claim_payout = true`, `organizer_settled = 500000000000000000000000` | [8HG7G4s5…](https://testnet.nearblocks.io/txns/8HG7G4s5B7wrwbNSKytaqHtyTPNqUqBhKEWnYrqY1ZVZ) |

## What it does not show

- **A group can still be wrong, or collude.** Two of three who lie are believed, exactly as one verifier who lies is. A group changes how many must agree, not whether they are right.
- **The three members here are accounts we hold.** The proof is that the mechanism works on chain, not that this jury is independent.
- **A DAO can change its own rules by its own vote**, members and threshold included. A buyer who reads "2 of 3" before paying is reading the policy of that moment. The contract fixes which account is the verifier; what stands behind that account is the account's business.
- **The members pay a deposit to propose** (1 NEAR in this DAO's default policy), returned when the proposal is decided.
