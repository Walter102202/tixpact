//! View structs and view methods (plan, "JSON shapes"). Views never panic: an unknown id is
//! `null`, a page past the end is empty and no page is longer than `max_page`.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near};

use crate::accounting::{self, Ledger};
use crate::events::{EventRecord, Outcome, OutcomeReason, to_hex};
use crate::tickets::{HistoryEntry, Ticket, TicketStatus};
use crate::{
    Contract, ContractExt, HISTORY_CAP, MAX_CAPACITY, MAX_MEMO_BYTES, MAX_MSG_BYTES, MAX_PAGE,
    MAX_REF_BYTES, MAX_TITLE_BYTES, MAX_VENUE_BYTES,
};

/// Limits and build facts of this deployment.
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
    /// Storage an event prepays for itself, in yoctoNEAR.
    pub storage_per_event: U128,
    /// Storage an event prepays per ticket of capacity, in yoctoNEAR.
    pub storage_per_ticket: U128,
    /// True only in test builds made with the `fault-injection` feature.
    pub fault_injection: bool,
}

/// Where an event stands, derived from its outcome and the time, for display.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    AwaitingVerifier,
    OnSale,
    SoldOut,
    InProgress,
    AwaitingAttestation,
    Expirable,
    Completed,
    Refundable,
}

/// Where a ticket's right stands, derived from its event and its status.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Claim {
    Reserved,
    Refundable,
    RefundPending,
    Refunded,
    ReleasedToOrganizer,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventView {
    pub event_id: u32,
    pub organizer_id: AccountId,
    pub verifier_id: AccountId,
    pub verifier_accepted: bool,
    pub terms_hash: String,
    pub title: String,
    pub venue: String,
    pub starts_at_ms: u64,
    pub ends_at_ms: u64,
    pub resolution_deadline_ms: u64,
    pub price: U128,
    pub capacity: u32,
    pub sold: u32,
    pub outcome: Outcome,
    pub outcome_reason: Option<OutcomeReason>,
    pub resolved_at_ms: Option<u64>,
    pub resolved_by: Option<AccountId>,
    pub evidence_ref: Option<String>,
    pub created_at_ms: u64,
    pub phase: Phase,
    pub now_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TicketView {
    pub token_id: TokenId,
    pub event_id: u32,
    pub serial: u32,
    pub owner_id: AccountId,
    pub principal: U128,
    pub status: TicketStatus,
    pub claim: Claim,
    pub pending_operation_id: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountingView {
    pub event_id: u32,
    pub principal_received: U128,
    pub principal_reserved: U128,
    pub refund_pending: U128,
    pub refunds_settled: U128,
    pub organizer_available: U128,
    pub organizer_pending: U128,
    pub organizer_settled: U128,
    pub operating_budget: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TicketHistory {
    /// Entries dropped between the first one and the latest ones.
    pub dropped: u32,
    pub entries: Vec<HistoryEntry>,
}

/// The display phase of an event at `now_ms`.
pub fn phase(event: &EventRecord, now_ms: u64) -> Phase {
    match event.outcome {
        Outcome::Completed => Phase::Completed,
        Outcome::Refundable => Phase::Refundable,
        Outcome::Unresolved if now_ms >= event.resolution_deadline_ms => Phase::Expirable,
        Outcome::Unresolved if now_ms >= event.ends_at_ms => Phase::AwaitingAttestation,
        Outcome::Unresolved if now_ms >= event.starts_at_ms => Phase::InProgress,
        Outcome::Unresolved if !event.verifier_accepted => Phase::AwaitingVerifier,
        Outcome::Unresolved if event.sold >= event.capacity => Phase::SoldOut,
        Outcome::Unresolved => Phase::OnSale,
    }
}

/// The right a ticket carries. A ticket locked by a transfer to a contract keeps the claim of its
/// event; its `status` shows the lock.
pub fn claim(outcome: Outcome, status: TicketStatus) -> Claim {
    match (outcome, status) {
        (Outcome::Unresolved, _) => Claim::Reserved,
        (Outcome::Completed, _) => Claim::ReleasedToOrganizer,
        (Outcome::Refundable, TicketStatus::Active | TicketStatus::TransferPending) => {
            Claim::Refundable
        }
        (Outcome::Refundable, TicketStatus::RefundPending) => Claim::RefundPending,
        (Outcome::Refundable, TicketStatus::Refunded) => Claim::Refunded,
    }
}

fn event_view(event_id: u32, event: &EventRecord, now_ms: u64) -> EventView {
    EventView {
        event_id,
        organizer_id: event.organizer_id.clone(),
        verifier_id: event.verifier_id.clone(),
        verifier_accepted: event.verifier_accepted,
        terms_hash: to_hex(&event.terms_hash),
        title: event.title.clone(),
        venue: event.venue.clone(),
        starts_at_ms: event.starts_at_ms,
        ends_at_ms: event.ends_at_ms,
        resolution_deadline_ms: event.resolution_deadline_ms,
        price: U128(event.price),
        capacity: event.capacity,
        sold: event.sold,
        outcome: event.outcome,
        outcome_reason: event.outcome_reason,
        resolved_at_ms: event.resolved_at_ms,
        resolved_by: event.resolved_by.clone(),
        evidence_ref: event.evidence_ref.clone(),
        created_at_ms: event.created_at_ms,
        phase: phase(event, now_ms),
        now_ms,
    }
}

fn accounting_view(event_id: u32, ledger: &Ledger) -> AccountingView {
    AccountingView {
        event_id,
        principal_received: U128(ledger.principal_received),
        principal_reserved: U128(ledger.principal_reserved),
        refund_pending: U128(ledger.refund_pending),
        refunds_settled: U128(ledger.refunds_settled),
        organizer_available: U128(ledger.organizer_available),
        organizer_pending: U128(ledger.organizer_pending),
        organizer_settled: U128(ledger.organizer_settled),
        operating_budget: U128(ledger.operating_budget),
    }
}

impl Contract {
    fn stored_event(&self, event_id: u32) -> Option<&EventRecord> {
        self.events.get(event_id.checked_sub(1)?)
    }

    fn ticket_view(&self, token_id: TokenId, ticket: &Ticket) -> Option<TicketView> {
        let owner_id = self.holder_of(&token_id)?;
        let event = self.stored_event(ticket.event_id)?;
        Some(TicketView {
            token_id,
            event_id: ticket.event_id,
            serial: ticket.serial,
            owner_id,
            principal: U128(ticket.principal),
            status: ticket.status,
            claim: claim(event.outcome, ticket.status),
            pending_operation_id: ticket.pending_operation_id,
        })
    }
}

#[near]
impl Contract {
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
            storage_per_event: U128(accounting::storage_per_event()),
            storage_per_ticket: U128(accounting::storage_per_ticket()),
            fault_injection: cfg!(feature = "fault-injection"),
        }
    }

    /// The deposit `create_event` requires for `capacity` tickets, in yoctoNEAR.
    pub fn quote_event_budget(&self, capacity: u32) -> U128 {
        U128(accounting::quote_event_budget(capacity))
    }

    /// One event, or `null`.
    pub fn get_event(&self, event_id: u32) -> Option<EventView> {
        let now_ms = env::block_timestamp_ms();
        self.stored_event(event_id)
            .map(|event| event_view(event_id, event, now_ms))
    }

    /// Events by ascending id from the 0-based position `from_index`, at most `max_page`.
    pub fn list_events(&self, from_index: u32, limit: u32) -> Vec<EventView> {
        let now_ms = env::block_timestamp_ms();
        let end = from_index
            .saturating_add(limit.min(MAX_PAGE))
            .min(self.events.len());
        (from_index..end)
            .filter_map(|index| {
                let event = self.events.get(index)?;
                Some(event_view(index + 1, event, now_ms))
            })
            .collect()
    }

    /// One event's ledger, or `null`.
    pub fn get_accounting(&self, event_id: u32) -> Option<AccountingView> {
        self.stored_event(event_id)
            .map(|event| accounting_view(event_id, &event.ledger))
    }

    /// One ticket, or `null`.
    pub fn get_ticket(&self, token_id: TokenId) -> Option<TicketView> {
        let ticket = self.tickets.get(&token_id)?;
        self.ticket_view(token_id, ticket)
    }

    /// One account's tickets in the standard enumeration order (`nft_tokens_for_owner`), from the
    /// 0-based position `from_index`, at most `max_page`.
    pub fn list_tickets_for_owner(
        &self,
        account_id: AccountId,
        from_index: u32,
        limit: u32,
    ) -> Vec<TicketView> {
        self.token_ids_for_owner(&account_id, u64::from(from_index), u64::from(limit))
            .into_iter()
            .filter_map(|token_id| {
                let ticket = self.tickets.get(&token_id)?;
                self.ticket_view(token_id, ticket)
            })
            .collect()
    }

    /// One ticket's history: the first entry and the latest ones, or `null`.
    pub fn get_ticket_history(&self, token_id: TokenId) -> Option<TicketHistory> {
        let ticket = self.tickets.get(&token_id)?;
        Some(TicketHistory {
            dropped: ticket.history_dropped,
            entries: ticket.history.clone(),
        })
    }
}
