//! Ticket escrow.
//!
//! Event tickets whose price stays reserved in this contract. The refund belongs to whoever holds
//! the ticket; the organizer is paid only after the verifier agreed in advance confirms the event;
//! once the deadline passes without that confirmation, anyone can switch the event to refunds.
//!
//! The rules (R1–R11), methods, JSON shapes and error codes are the plan's "Frozen interface (v1)"
//! (`docs/plans/2026-11-12-ticket-escrow-mvp-plan.md`). Where each part lives:
//!
//! - `events.rs`: `create_event`, `accept_verification`, `cancel_event`, `attest_completed`,
//!   `expire_event`.
//! - `tickets.rs`: `buy_ticket` and the NEP-171 token surface (`nft_transfer`, `nft_token`,
//!   enumeration, metadata).
//! - `views.rs`: `get_config`, `quote_event_budget`, `get_event`, `list_events`,
//!   `get_accounting`, `get_ticket`, `list_tickets_for_owner`, `get_ticket_history`.
//! - `settlement.rs`: `claim_refund`, `claim_payout`, their private callbacks, `get_operation` and
//!   the liquidity check.
//! - `accounting.rs`: the per-event ledger and the storage budget.
//! - `errors.rs`, `log.rs`: error codes and NEP-297 events.
//!
//! The contract has no owner, no admin method and no upgrade method (R10).

mod accounting;
mod errors;
mod events;
mod log;
mod settlement;
mod tickets;
mod views;

use near_contract_standards::non_fungible_token::{NonFungibleToken, TokenId};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{PanicOnDefault, env, near};

pub use crate::accounting::Ledger;
pub use crate::errors::Code;
pub use crate::events::{EventTerms, Outcome, OutcomeReason};
pub use crate::settlement::{GAS_CLAIM_MIN, GAS_FOR_CALLBACK, OperationKind, OperationView};
pub use crate::tickets::{HistoryEntry, HistoryKind, TicketStatus};
pub use crate::views::{
    AccountingView, Claim, Config, EventView, Phase, TicketHistory, TicketView,
};

use crate::events::EventRecord;
use crate::settlement::Operation;
use crate::tickets::Ticket;

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

/// Storage prefixes. Single ASCII bytes, so they never collide with the standard's per-owner
/// sets, whose prefixes start with a zero byte.
mod prefix {
    pub const TOKEN_OWNERS: &[u8; 1] = b"o";
    pub const TOKENS_PER_OWNER: &[u8; 1] = b"p";
    pub const EVENTS: &[u8; 1] = b"e";
    pub const TICKETS: &[u8; 1] = b"t";
    pub const OPERATIONS: &[u8; 1] = b"x";
}

/// The whole state. Every amount it holds for someone is in one event's ledger.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// NEP-171 token storage: the only record of who holds each ticket. No token metadata is
    /// stored (it is derived from the event) and approvals are disabled.
    pub(crate) tokens: NonFungibleToken,
    /// Events by `event_id - 1`.
    pub(crate) events: Vector<EventRecord>,
    /// Ticket records by token id.
    pub(crate) tickets: LookupMap<TokenId, Ticket>,
    /// Settlements in flight by operation id. An entry exists only while its transfer is pending.
    pub(crate) operations: LookupMap<u64, Operation>,
    /// The id of the latest operation; 0 before the first one.
    pub(crate) last_operation_id: u64,
    /// Sum over all events of `principal_reserved + organizer_available`, in yoctoNEAR.
    pub(crate) total_held: u128,
}

#[near]
impl Contract {
    /// Initializes the contract. Takes no arguments: there is nothing to configure and nobody to
    /// put in charge.
    #[init]
    pub fn new() -> Self {
        Self {
            tokens: NonFungibleToken::new(
                prefix::TOKEN_OWNERS,
                env::current_account_id(),
                None::<Vec<u8>>,
                Some(prefix::TOKENS_PER_OWNER),
                None::<Vec<u8>>,
            ),
            events: Vector::new(prefix::EVENTS),
            tickets: LookupMap::new(prefix::TICKETS),
            operations: LookupMap::new(prefix::OPERATIONS),
            last_operation_id: 0,
            total_held: 0,
        }
    }
}

#[cfg(test)]
mod tests;
