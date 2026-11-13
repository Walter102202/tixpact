//! The per-event ledger, the sum of what the contract still holds for others, and the storage
//! budget each event prepays (rules R1, R3, R9 and R11).
//!
//! Every yoctoNEAR of ticket money sits in exactly one bucket of its event's ledger. Moving money
//! is always a move between two buckets, so the identity below holds after every call and every
//! callback:
//!
//! ```text
//! principal_received = principal_reserved + organizer_available + refund_pending
//!                    + organizer_pending + refunds_settled + organizer_settled
//! ```

use near_sdk::env;
use near_sdk::near;

use crate::errors::{Code, fail};

/// Bytes of storage an event prepays for its own record and its payout record: the measured worst
/// case, 1,144 bytes (64-character accounts, longest title, venue and evidence, a payout in
/// flight), plus 20%. The unit test
/// `storage_constants_are_the_measured_worst_case_plus_twenty_percent` measures it again.
pub const STORAGE_BYTES_PER_EVENT: u128 = 1_373;
/// Bytes of storage an event prepays for each ticket of its capacity: the measured worst case,
/// 2,129 bytes (the ticket record with a full history of 64-character accounts, its token
/// entries, an owner index of its own, a pending refund and the longest possible ticket id), plus
/// 20%. Measured by the same unit test.
pub const STORAGE_BYTES_PER_TICKET: u128 = 2_555;

/// Storage an event prepays for itself, in yoctoNEAR.
pub fn storage_per_event() -> u128 {
    STORAGE_BYTES_PER_EVENT * env::storage_byte_cost().as_yoctonear()
}

/// Storage an event prepays per ticket of capacity, in yoctoNEAR.
pub fn storage_per_ticket() -> u128 {
    STORAGE_BYTES_PER_TICKET * env::storage_byte_cost().as_yoctonear()
}

/// The deposit `create_event` requires for an event of `capacity` tickets. Never panics: the
/// capacity limit is checked by `create_event`, not here.
pub fn quote_event_budget(capacity: u32) -> u128 {
    storage_per_event().saturating_add(storage_per_ticket().saturating_mul(u128::from(capacity)))
}

/// `a + b`, aborting instead of wrapping. Amounts are bounded by real deposits, so this never
/// fails on a reachable path.
pub fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b)
        .unwrap_or_else(|| fail(Code::Limit, "amount out of range"))
}

/// `a - b`, aborting instead of wrapping. Callers only move money out of a bucket that holds it,
/// so this never fails on a reachable path.
pub fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b)
        .unwrap_or_else(|| fail(Code::Limit, "amount out of range"))
}

/// Where every yoctoNEAR of one event is. Amounts in yoctoNEAR.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ledger {
    /// Everything buyers paid for tickets of this event.
    pub principal_received: u128,
    /// Principal still owed to the holders (event unresolved or refundable).
    pub principal_reserved: u128,
    /// Refunds sent and not yet confirmed by their callback.
    pub refund_pending: u128,
    /// Refunds confirmed delivered.
    pub refunds_settled: u128,
    /// Principal released to the organizer by the attestation and not yet sent.
    pub organizer_available: u128,
    /// A payout sent and not yet confirmed by its callback.
    pub organizer_pending: u128,
    /// Payouts confirmed delivered.
    pub organizer_settled: u128,
    /// The organizer's `create_event` deposit. It pays for this event's storage only.
    pub operating_budget: u128,
}

impl Ledger {
    /// True when every received yoctoNEAR is in exactly one bucket.
    pub fn identity_holds(&self) -> bool {
        let parts = [
            self.principal_reserved,
            self.organizer_available,
            self.refund_pending,
            self.organizer_pending,
            self.refunds_settled,
            self.organizer_settled,
        ];
        parts
            .iter()
            .try_fold(0u128, |sum, part| sum.checked_add(*part))
            .is_some_and(|sum| sum == self.principal_received)
    }

    /// What this event still holds for someone: counted in the liquidity check.
    pub fn held(&self) -> u128 {
        add(self.principal_reserved, self.organizer_available)
    }

    /// A ticket was bought for `price`.
    pub fn record_purchase(&mut self, price: u128) {
        self.principal_received = add(self.principal_received, price);
        self.principal_reserved = add(self.principal_reserved, price);
    }

    /// The attestation releases all reserved principal to the organizer. Returns the amount.
    pub fn release_to_organizer(&mut self) -> u128 {
        let amount = self.principal_reserved;
        self.principal_reserved = 0;
        self.organizer_available = add(self.organizer_available, amount);
        amount
    }

    /// A refund of `amount` is about to be sent.
    pub fn reserve_refund(&mut self, amount: u128) {
        self.principal_reserved = sub(self.principal_reserved, amount);
        self.refund_pending = add(self.refund_pending, amount);
    }

    /// The refund transfer was delivered.
    pub fn settle_refund(&mut self, amount: u128) {
        self.refund_pending = sub(self.refund_pending, amount);
        self.refunds_settled = add(self.refunds_settled, amount);
    }

    /// The refund transfer failed: the right goes back to the holder.
    pub fn restore_refund(&mut self, amount: u128) {
        self.refund_pending = sub(self.refund_pending, amount);
        self.principal_reserved = add(self.principal_reserved, amount);
    }

    /// The whole available amount is about to be sent to the organizer. Returns it.
    pub fn reserve_payout(&mut self) -> u128 {
        let amount = self.organizer_available;
        self.organizer_available = 0;
        self.organizer_pending = add(self.organizer_pending, amount);
        amount
    }

    /// The payout transfer was delivered.
    pub fn settle_payout(&mut self, amount: u128) {
        self.organizer_pending = sub(self.organizer_pending, amount);
        self.organizer_settled = add(self.organizer_settled, amount);
    }

    /// The payout transfer failed: the amount is available to the organizer again.
    pub fn restore_payout(&mut self, amount: u128) {
        self.organizer_pending = sub(self.organizer_pending, amount);
        self.organizer_available = add(self.organizer_available, amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: u128 = 1_500_000_000_000_000_000_000_000;

    #[test]
    fn every_move_keeps_the_identity() {
        let mut ledger = Ledger::default();
        for _ in 0..3 {
            ledger.record_purchase(P);
            assert!(ledger.identity_holds());
        }
        ledger.reserve_refund(P);
        assert!(ledger.identity_holds());
        ledger.restore_refund(P);
        assert!(ledger.identity_holds());
        ledger.reserve_refund(P);
        ledger.settle_refund(P);
        assert!(ledger.identity_holds());
        assert_eq!(ledger.release_to_organizer(), 2 * P);
        assert!(ledger.identity_holds());
        assert_eq!(ledger.reserve_payout(), 2 * P);
        ledger.restore_payout(2 * P);
        assert!(ledger.identity_holds());
        assert_eq!(ledger.reserve_payout(), 2 * P);
        ledger.settle_payout(2 * P);
        assert!(ledger.identity_holds());
        assert_eq!(ledger.refunds_settled + ledger.organizer_settled, 3 * P);
        assert_eq!(ledger.held(), 0);
    }

    #[test]
    fn a_broken_identity_is_detected() {
        let ledger = Ledger {
            principal_received: P,
            ..Ledger::default()
        };
        assert!(!ledger.identity_holds());
    }

    #[test]
    #[should_panic(expected = "ERR_LIMIT")]
    fn moving_more_than_a_bucket_holds_aborts() {
        let mut ledger = Ledger::default();
        ledger.record_purchase(P);
        ledger.reserve_refund(P + 1);
    }

    #[test]
    fn the_quote_grows_with_capacity_and_never_panics() {
        assert!(quote_event_budget(2) > quote_event_budget(1));
        assert_eq!(
            quote_event_budget(10) - quote_event_budget(9),
            storage_per_ticket()
        );
        let _ = quote_event_budget(u32::MAX);
    }
}
