# Storage and gas constants come from measured worst cases; static gas keeps five times the worst case

Date: 2026-11-13. Author: Track C. Status: accepted.

## Context

Task C4 asks for the storage constants to be "the measurements plus a 20% margin". It asks for the gas constants to be "the measured maximum plus margin", without saying how much margin. Three questions were open.

1. Where to measure storage, and how to reach the worst ticket id. Event ids have no global cap, so a ticket id can be up to `4294967295-100`, and no test can create four billion events.
2. How large the gas margin should be. The contract can never be upgraded (R10, no access keys). A callback whose static gas becomes too small after a protocol change fails, and its payment stays pending for good.
3. How large `t16`'s "full event" should be. At capacity 100, with every ticket moved twenty times, given a holder of its own and left pending, the test needs more than 200 transactions: about five minutes on every gate run.

## Decision

- **Storage.** A unit test measures `env::storage_usage()` deltas after flushing every `store` collection. The mocked host counts bytes with the protocol's rule: key + value + 40 bytes per record.
  - The measurement uses the worst case: 64-character accounts, the longest texts, a full history, a pending refund or payout, and capacity 100.
  - The ticket is measured with the id `10-100`. The test adds 6 bytes for each extra byte of the longest id: the id is stored six times. It also checks that a purchase stores five of those six copies.
  - The results are 1,144 bytes per event and 2,129 bytes per ticket. `STORAGE_BYTES_PER_EVENT = 1,373` and `STORAGE_BYTES_PER_TICKET = 2,555` are those numbers + 20%, rounded up.
  - The test asserts this equality, so any change to the stored layout forces a new measurement.
- **Gas.** `contract/tests/gas.rs` runs every change method and both callbacks and the resolver in their worst case, with the client's gas. It asserts two rules:
  - Static gas is at least 5 × the worst burn, rounded up to 5 Tgas. `GAS_FOR_CALLBACK` stays 15 Tgas (worst 2.43) and `GAS_FOR_RESOLVE_TRANSFER` stays 20 Tgas (worst 3.11).
  - Each minimum is at least the static gas it attaches plus 5 × the call's own worst burn, rounded up to 10 Tgas. `GAS_CLAIM_MIN` drops from 60 to 40 Tgas (15 + 5 × 3.17). `GAS_TRANSFER_CALL_MIN` stays 50 Tgas (20 + 5 × 4.23).
  - Claims and transfers to contracts are also run at exactly their minimum, with full histories.
- **`t16`.** It uses a full event of 10 tickets, with 64-character accounts, twenty moves per ticket, a holder of its own for each ticket, and every refund pending. A second event of one ticket has a pending payout. The fault-injection build keeps the operations pending.
  - The per-ticket worst case at capacity 100 is covered by the unit test above. A ticket's records do not depend on how many other tickets its event has.
  - Batched transactions (one signer, many calls) keep the test at about 50 seconds.

## Alternatives considered

- Measuring storage only in the sandbox: account storage is exact there too, but the worst id length and capacity 100 would cost minutes per run. The sandbox test checks the same budget rule on a real chain instead.
- A 2× or 3× gas margin: lower constants, but on a contract that can never change, too little static gas is the failure that cannot be repaired. Extra static gas costs the caller nothing, because unused gas is refunded.
- Keeping `GAS_CLAIM_MIN` at 60 Tgas: it would reject callers who attach 40 to 59 Tgas, although those claims work. The minimum only exists to fail early with a clear code. The callback's gas is reserved whatever the caller attaches.
- `t16` at capacity 100: more than 200 transactions per gate run, and it proves no more than the unit test plus the 10-ticket run.

## Consequences

- The plan's initial `GAS_CLAIM_MIN` (60 Tgas) is replaced by 40 Tgas. The client's 100 Tgas for claims is unchanged and still more than twice the minimum.
- `claim_with_low_gas_fails_whole` and `transfer_call_with_low_gas_fails_whole` now read the minimum from the crate, so a later change of a constant keeps them testing "just below the minimum".
- `buy_ticket` costs more as the shared token tree grows: 4.01 Tgas at the 3rd ticket, 6.06 Tgas at the 102nd. A rough estimate, assuming the same cost per doubling, is about 19 Tgas at the largest id range. That is under the client's 50 Tgas (`docs/gas.md`).
- Revisit if a protocol upgrade changes storage or gas costs. Rerun the two measuring tests, which fail on any mismatch.
