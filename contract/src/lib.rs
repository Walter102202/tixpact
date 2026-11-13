//! Ticket escrow.
//!
//! Event tickets whose price stays reserved in this contract. The refund belongs to whoever holds
//! the ticket; the organizer is paid only after the verifier agreed in advance confirms the event;
//! once the deadline passes without that confirmation, anyone can switch the event to refunds.
//!
//! This file is the Phase 0 scaffold: initialization and the configuration view. Track C builds the
//! rules on top of it (plan: `docs/plans/2026-11-12-ticket-escrow-mvp-plan.md`, "Frozen interface").

use near_sdk::json_types::U128;
use near_sdk::{PanicOnDefault, near};

/// Most tickets one event can sell.
pub const MAX_CAPACITY: u32 = 100;
/// Most items a paginated view returns.
pub const MAX_PAGE: u32 = 50;
/// Longest event title, in bytes.
pub const MAX_TITLE_BYTES: u32 = 120;
/// Longest venue, in bytes.
pub const MAX_VENUE_BYTES: u32 = 120;
/// Longest evidence or reason reference, in bytes.
pub const MAX_REF_BYTES: u32 = 256;
/// Longest transfer memo, in bytes.
pub const MAX_MEMO_BYTES: u32 = 256;
/// Longest `msg` of a transfer to a contract, in bytes.
pub const MAX_MSG_BYTES: u32 = 1024;
/// Entries kept in a ticket's history: the first one and the latest fifteen.
pub const HISTORY_CAP: u32 = 16;

/// Limits and build facts of this deployment, as returned by [`Contract::get_config`].
#[near(serializers = [json])]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub version: String,
    pub max_capacity: u32,
    pub max_page: u32,
    pub max_title_bytes: u32,
    pub max_venue_bytes: u32,
    pub max_ref_bytes: u32,
    pub max_memo_bytes: u32,
    pub max_msg_bytes: u32,
    pub history_cap: u32,
    /// Storage an event prepays for itself, in yoctoNEAR. Provisional until Task C4 measures it.
    pub storage_per_event: U128,
    /// Storage an event prepays per ticket of capacity, in yoctoNEAR. Provisional until Task C4.
    pub storage_per_ticket: U128,
    /// True only in test builds made with the `fault-injection` feature.
    pub fault_injection: bool,
}

/// The contract has no owner, no admin method and no upgrade method.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {}

#[near]
impl Contract {
    /// Initializes the contract. Takes no arguments: there is nothing to configure and nobody to
    /// put in charge.
    #[init]
    pub fn new() -> Self {
        Self {}
    }

    /// Limits and build facts of this deployment.
    pub fn get_config(&self) -> Config {
        Config {
            version: env!("CARGO_PKG_VERSION").to_string(),
            max_capacity: MAX_CAPACITY,
            max_page: MAX_PAGE,
            max_title_bytes: MAX_TITLE_BYTES,
            max_venue_bytes: MAX_VENUE_BYTES,
            max_ref_bytes: MAX_REF_BYTES,
            max_memo_bytes: MAX_MEMO_BYTES,
            max_msg_bytes: MAX_MSG_BYTES,
            history_cap: HISTORY_CAP,
            storage_per_event: U128(0),
            storage_per_ticket: U128(0),
            fault_injection: cfg!(feature = "fault-injection"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_reports_the_frozen_limits() {
        let config = Contract::new().get_config();

        assert_eq!(config.version, "1.0.0");
        assert_eq!(config.max_capacity, 100);
        assert_eq!(config.max_page, 50);
        assert_eq!(config.history_cap, 16);
        assert!(!config.fault_injection);
    }
}
