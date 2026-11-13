# Proof: a verifier that is a group

Recorded on 2026-11-13 from one run of [`scripts/group-verifier.sh`](../scripts/group-verifier.sh) on NEAR testnet. Run the script again to produce your own.

Contract: [`ticket-escrow-v2.testnet`](https://testnet.nearblocks.io/address/ticket-escrow-v2.testnet), event 9, "Jury night".
Verifier: [`ticket-jury.sputnikv2.testnet`](https://testnet.nearblocks.io/address/ticket-jury.sputnikv2.testnet), a Sputnik DAO (version 2.3.1) created for this proof ([creation](https://testnet.nearblocks.io/txns/GM9huQ2eGNafmEVhtvR7nPLfYVXYUAC75snbseC293w7)). Its council has three members, `te-d1-venue.testnet`, `te-d1-verifier.testnet` and `te-d1-auditor.testnet`, and it acts when two of them vote for the same proposal.

## What it shows

The contract was not changed for this. A verifier is an account, and on NEAR an account can be a contract whose calls are decided by votes. So the question "who confirms that the event took place" can be answered with a venue, an auditor and a third party who must agree, instead of one key.

One member alone changes nothing: after the first vote the event was still not accepted (step 3), and later still not confirmed (step 7). Each time the second vote made the DAO call the ticket contract.

## The run

| # | Step | Signed by | Expected | Observed | Transaction |
|---|---|---|---|---|---|
| 1 | The verifier's policy is read from the chain | read | a group of 3, 2 must agree | members `te-d1-venue.testnet`, `te-d1-verifier.testnet`, `te-d1-auditor.testnet`; 2 of 3 | |
| 2 | Organizer creates the event with the DAO as its verifier | `te-d1-organizer.testnet` | succeeds | event 9 | [ByxQb1Eo…](https://testnet.nearblocks.io/txns/ByxQb1EoHyZWewxnX3YqL93Hu6caAAbHrTNuxWyq5VFe) |
| 3a | A member proposes that the group accept the exact terms | `te-d1-verifier.testnet` | proposal created | proposal 4 | [62UybkGg…](https://testnet.nearblocks.io/txns/62UybkGg1x2jrdQYcQaaExqcN1TVPHpnqM7eXyH4EVTQ) |
| 3b | The same member votes for it | `te-d1-verifier.testnet` | nothing changes: one vote is not enough | proposal `InProgress`, `verifier_accepted = false` | [J9KSZRoo…](https://testnet.nearblocks.io/txns/J9KSZRoonTQhN6E31Ln5qdpBLXJbYGa8x41thVrctoHM) |
| 4 | A second member votes for it | `te-d1-auditor.testnet` | the DAO calls `accept_verification`; the event goes on sale | proposal `Approved`, `verifier_accepted = true`, phase `OnSale` | [AK7ig6Cf…](https://testnet.nearblocks.io/txns/AK7ig6CfskPMkgEdxhtmqQrim6cDKBT5KLZZL1kcu285) |
| 5 | Ana buys a ticket for 0.5 NEAR | `te-d1-ana.testnet` | ticket 9-1, price reserved | ticket `9-1`, `principal_reserved = 500000000000000000000000` | [8uJWQucm…](https://testnet.nearblocks.io/txns/8uJWQucmCt2hL5BkPxst6zgZaskUSQ2hKqr2js1Ua5ox) |
| 6 | The event ends | chain clock | | | |
| 7a | A member proposes that the group confirm the event | `te-d1-verifier.testnet` | proposal created | proposal 5 | [5tyvoqj6…](https://testnet.nearblocks.io/txns/5tyvoqj6EhJaLS53xu7wrqtnecyVspVrPmwtxM3kG11p) |
| 7b | The same member votes for it | `te-d1-verifier.testnet` | nothing changes | outcome `Unresolved` | [AtzfyMoS…](https://testnet.nearblocks.io/txns/AtzfyMoShQhhyqZ1Jsxzew16ctvSQhocLMV2sGYSv41H) |
| 8 | A second member votes for it | `te-d1-auditor.testnet` | the DAO calls `attest_completed` | proposal `Approved`, outcome `Completed`, `resolved_by = ticket-jury.sputnikv2.testnet` | [2ukN5Zn6…](https://testnet.nearblocks.io/txns/2ukN5Zn6M5sGbEuYwhU4Y6s9W5Z6E8xREaYVoXmE8fou) |
| 9 | Organizer collects | `te-d1-organizer.testnet` | paid 0.5 NEAR | `claim_payout = true`, `organizer_settled = 500000000000000000000000` | [63nShbrV…](https://testnet.nearblocks.io/txns/63nShbrV4sBHQC8WSR6ULcvKnTvLruUSm3EsD2gUXjRB) |

## What it does not show

- **A group can still be wrong, or collude.** Two of three who lie are believed, exactly as one verifier who lies is. A group changes how many must agree, not whether they are right.
- **The three members here are accounts we hold.** The proof is that the mechanism works on chain, not that this jury is independent.
- **A DAO can change its own rules by its own vote**, members and threshold included. A buyer who reads "2 of 3" before paying is reading the policy of that moment. The contract fixes which account is the verifier; what stands behind that account is the account's business.
- **The members pay a deposit to propose** (1 NEAR in this DAO's default policy), returned when the proposal is decided.
