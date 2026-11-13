//! Events: terms, the verifier's acceptance and the one-time outcome (rules R2, R4, R5).

use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near};

use crate::accounting::{Ledger, quote_event_budget};
use crate::errors::{Code, ensure, ensure_one_yocto, ensure_text_fits, fail};
use crate::log;
use crate::{Contract, ContractExt, MAX_CAPACITY, MAX_REF_BYTES, MAX_TITLE_BYTES, MAX_VENUE_BYTES};

/// The terms an organizer proposes in `create_event`. They never change afterwards (R5).
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventTerms {
    pub title: String,
    pub venue: String,
    pub starts_at_ms: u64,
    pub ends_at_ms: u64,
    pub resolution_deadline_ms: u64,
    /// Price of one ticket, in the smallest unit of `currency`.
    pub price: U128,
    pub capacity: u32,
    pub verifier_id: AccountId,
    /// `null` (or left out) for NEAR; otherwise one of the tokens listed at `new`.
    pub currency: Option<AccountId>,
}

/// The event outcome. It leaves `Unresolved` once and never changes again (R2).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Unresolved,
    Completed,
    Refundable,
}

/// Why the event left `Unresolved`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutcomeReason {
    Attested,
    Cancelled,
    Expired,
}

/// One event as stored. Ticket ownership is not here: the token storage is its only record.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct EventRecord {
    pub organizer_id: AccountId,
    pub verifier_id: AccountId,
    pub verifier_accepted: bool,
    pub terms_hash: [u8; 32],
    pub title: String,
    pub venue: String,
    pub starts_at_ms: u64,
    pub ends_at_ms: u64,
    pub resolution_deadline_ms: u64,
    /// In the smallest unit of `currency`.
    pub price: u128,
    pub capacity: u32,
    pub sold: u32,
    /// `None` for NEAR; otherwise a token listed at `new`. The ledger counts in this currency.
    pub currency: Option<AccountId>,
    pub outcome: Outcome,
    pub outcome_reason: Option<OutcomeReason>,
    pub resolved_at_ms: Option<u64>,
    pub resolved_by: Option<AccountId>,
    /// The attestation's evidence or the cancellation's reason
    /// (`docs/decisions/2026-11-12-cancel-reason-shares-evidence-ref.md`).
    pub evidence_ref: Option<String>,
    pub created_at_ms: u64,
    pub ledger: Ledger,
    /// The payout in flight, if any.
    pub payout_operation_id: Option<u64>,
}

impl EventRecord {
    /// Records the outcome. Callers have checked that the event is unresolved.
    fn resolve(
        &mut self,
        outcome: Outcome,
        reason: OutcomeReason,
        by: &AccountId,
        evidence_ref: Option<String>,
        now_ms: u64,
    ) {
        self.outcome = outcome;
        self.outcome_reason = Some(reason);
        self.resolved_at_ms = Some(now_ms);
        self.resolved_by = Some(by.clone());
        self.evidence_ref = evidence_ref;
    }
}

/// Lowercase hex SHA-256 of the Borsh encoding of
/// `(organizer_id, verifier_id, title, venue, starts_at_ms, ends_at_ms, resolution_deadline_ms,
/// price, capacity, currency)`. The currency is last, an `Option<AccountId>` (v2).
pub fn terms_hash(organizer_id: &AccountId, terms: &EventTerms) -> [u8; 32] {
    let encoded = near_sdk::borsh::to_vec(&(
        organizer_id,
        &terms.verifier_id,
        &terms.title,
        &terms.venue,
        terms.starts_at_ms,
        terms.ends_at_ms,
        terms.resolution_deadline_ms,
        terms.price.0,
        terms.capacity,
        &terms.currency,
    ))
    .unwrap_or_else(|_| env::abort());
    env::sha256_array(&encoded)
}

/// Lowercase hex of a 32-byte hash.
pub fn to_hex(bytes: &[u8; 32]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(64);
    for byte in bytes {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

/// Checks the terms against the rules, the limits and the listed tokens. Changes nothing.
fn validate_terms(contract: &Contract, organizer_id: &AccountId, terms: &EventTerms, now_ms: u64) {
    ensure_text_fits(Some(&terms.title), MAX_TITLE_BYTES, "the title");
    ensure_text_fits(Some(&terms.venue), MAX_VENUE_BYTES, "the venue");
    ensure(
        !terms.title.trim().is_empty() && !terms.venue.trim().is_empty(),
        Code::InvalidTerms,
        "the title and the venue must not be empty",
    );
    ensure(
        &terms.verifier_id != organizer_id && terms.verifier_id != env::current_account_id(),
        Code::InvalidTerms,
        "the verifier must be another account than the organizer and this contract",
    );
    ensure(
        terms.price.0 > 0,
        Code::InvalidTerms,
        "the price must be above zero",
    );
    ensure(
        (1..=MAX_CAPACITY).contains(&terms.capacity),
        Code::InvalidTerms,
        "the capacity must be between 1 and 100",
    );
    ensure(
        terms
            .price
            .0
            .checked_mul(u128::from(terms.capacity))
            .is_some(),
        Code::InvalidTerms,
        "the price times the capacity does not fit in an amount",
    );
    ensure(
        now_ms < terms.starts_at_ms
            && terms.starts_at_ms < terms.ends_at_ms
            && terms.ends_at_ms < terms.resolution_deadline_ms,
        Code::InvalidTerms,
        "the times must satisfy now < starts_at_ms < ends_at_ms < resolution_deadline_ms",
    );
    ensure(
        terms
            .currency
            .as_ref()
            .is_none_or(|token| contract.token_spec(token).is_some()),
        Code::InvalidTerms,
        "the currency must be null for NEAR or one of the tokens in get_config",
    );
}

impl Contract {
    /// The stored event, or `ERR_NOT_FOUND`. Returns a copy; write it back with `save_event`.
    pub(crate) fn load_event(&self, event_id: u32) -> EventRecord {
        event_id
            .checked_sub(1)
            .and_then(|index| self.events.get(index))
            .cloned()
            .unwrap_or_else(|| fail(Code::NotFound, "no event with this id"))
    }

    pub(crate) fn save_event(&mut self, event_id: u32, event: EventRecord) {
        debug_assert!(event.ledger.identity_holds(), "accounting identity broken");
        self.events.set(event_id - 1, event);
    }

    /// Expires an unresolved event whose deadline has passed. Used by `expire_event` and, before
    /// paying, by `claim_refund`. Returns whether it changed the event.
    pub(crate) fn expire_if_due(
        event_id: u32,
        event: &mut EventRecord,
        by: &AccountId,
        now_ms: u64,
    ) -> bool {
        if event.outcome != Outcome::Unresolved || now_ms < event.resolution_deadline_ms {
            return false;
        }
        event.resolve(
            Outcome::Refundable,
            OutcomeReason::Expired,
            by,
            None,
            now_ms,
        );
        log::event_resolved(event_id, Outcome::Refundable, OutcomeReason::Expired, by);
        true
    }
}

#[near]
impl Contract {
    /// Creates an event with the caller as organizer, priced in NEAR or in one listed token
    /// (`terms.currency`). The deposit, always in NEAR, must cover
    /// `quote_event_budget(capacity)`; all of it becomes the event's operating budget, which pays
    /// for its storage only. Tickets go on sale once the verifier accepts these exact terms.
    /// Returns the new event id (ids start at 1).
    #[payable]
    pub fn create_event(&mut self, terms: EventTerms) -> u32 {
        let organizer_id = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let deposit = env::attached_deposit().as_yoctonear();
        validate_terms(self, &organizer_id, &terms, now_ms);
        ensure(
            deposit >= quote_event_budget(terms.capacity),
            Code::WrongDeposit,
            "the deposit must cover quote_event_budget(capacity)",
        );

        let event_id = self
            .events
            .len()
            .checked_add(1)
            .unwrap_or_else(|| fail(Code::Limit, "no more event ids"));
        let hash = terms_hash(&organizer_id, &terms);
        let event = EventRecord {
            organizer_id: organizer_id.clone(),
            verifier_id: terms.verifier_id.clone(),
            verifier_accepted: false,
            terms_hash: hash,
            title: terms.title,
            venue: terms.venue,
            starts_at_ms: terms.starts_at_ms,
            ends_at_ms: terms.ends_at_ms,
            resolution_deadline_ms: terms.resolution_deadline_ms,
            price: terms.price.0,
            capacity: terms.capacity,
            sold: 0,
            currency: terms.currency,
            outcome: Outcome::Unresolved,
            outcome_reason: None,
            resolved_at_ms: None,
            resolved_by: None,
            evidence_ref: None,
            created_at_ms: now_ms,
            ledger: Ledger {
                operating_budget: deposit,
                ..Ledger::default()
            },
            payout_operation_id: None,
        };
        log::event_created(
            event_id,
            &organizer_id,
            &event.verifier_id,
            &to_hex(&hash),
            event.price,
            event.capacity,
            event.currency.as_ref(),
        );
        self.events.push(event);
        event_id
    }

    /// The verifier accepts the event's exact terms, identified by `EventView.terms_hash`. Needed
    /// before any ticket is sold. Calling it again once accepted changes nothing.
    #[payable]
    pub fn accept_verification(&mut self, event_id: u32, terms_hash: String) {
        ensure_one_yocto();
        let caller = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let mut event = self.load_event(event_id);
        ensure(
            caller == event.verifier_id,
            Code::Unauthorized,
            "only the event's verifier can accept it",
        );
        ensure(
            event.outcome == Outcome::Unresolved,
            Code::AlreadyResolved,
            "the event already has an outcome",
        );
        ensure(
            now_ms < event.starts_at_ms,
            Code::TooLate,
            "the event has already started",
        );
        let expected = to_hex(&event.terms_hash);
        ensure(
            terms_hash == expected,
            Code::TermsMismatch,
            "the hash is not the hash of this event's terms",
        );
        if event.verifier_accepted {
            return;
        }
        event.verifier_accepted = true;
        log::verification_accepted(event_id, &caller, &expected);
        self.save_event(event_id, event);
    }

    /// The organizer or the verifier cancels the event before its deadline: holders can then
    /// claim their refunds. `reason_ref` is free text of at most `max_ref_bytes`.
    #[payable]
    pub fn cancel_event(&mut self, event_id: u32, reason_ref: Option<String>) {
        ensure_one_yocto();
        ensure_text_fits(reason_ref.as_deref(), MAX_REF_BYTES, "the reason");
        let caller = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let mut event = self.load_event(event_id);
        ensure(
            caller == event.organizer_id || caller == event.verifier_id,
            Code::Unauthorized,
            "only the organizer or the verifier can cancel",
        );
        ensure(
            event.outcome == Outcome::Unresolved,
            Code::AlreadyResolved,
            "the event already has an outcome",
        );
        ensure(
            now_ms < event.resolution_deadline_ms,
            Code::TooLate,
            "the deadline has passed: anyone can expire the event instead",
        );
        event.resolve(
            Outcome::Refundable,
            OutcomeReason::Cancelled,
            &caller,
            reason_ref,
            now_ms,
        );
        log::event_resolved(
            event_id,
            Outcome::Refundable,
            OutcomeReason::Cancelled,
            &caller,
        );
        self.save_event(event_id, event);
    }

    /// The accepted verifier confirms the event took place, between its end and its deadline. All
    /// reserved principal becomes available to the organizer. The contract cannot check that the
    /// verifier is right: that is the trust limit `t21` documents.
    #[payable]
    pub fn attest_completed(&mut self, event_id: u32, evidence_ref: Option<String>) {
        ensure_one_yocto();
        ensure_text_fits(evidence_ref.as_deref(), MAX_REF_BYTES, "the evidence");
        let caller = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let mut event = self.load_event(event_id);
        ensure(
            caller == event.verifier_id,
            Code::Unauthorized,
            "only the event's verifier can attest it",
        );
        ensure(
            event.verifier_accepted,
            Code::NotAccepted,
            "the verifier never accepted this event",
        );
        ensure(
            event.outcome == Outcome::Unresolved,
            Code::AlreadyResolved,
            "the event already has an outcome",
        );
        ensure(
            now_ms >= event.ends_at_ms,
            Code::TooEarly,
            "the event has not ended yet",
        );
        ensure(
            now_ms < event.resolution_deadline_ms,
            Code::TooLate,
            "the deadline has passed",
        );
        event.resolve(
            Outcome::Completed,
            OutcomeReason::Attested,
            &caller,
            evidence_ref,
            now_ms,
        );
        // Both buckets count as held, so the contract-wide total does not change.
        event.ledger.release_to_organizer();
        log::event_resolved(
            event_id,
            Outcome::Completed,
            OutcomeReason::Attested,
            &caller,
        );
        self.save_event(event_id, event);
    }

    /// Anyone switches an unresolved event to refunds once its deadline has passed. On an event
    /// that already has an outcome it changes nothing and returns that outcome.
    pub fn expire_event(&mut self, event_id: u32) -> Outcome {
        let caller = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let mut event = self.load_event(event_id);
        if event.outcome != Outcome::Unresolved {
            return event.outcome;
        }
        ensure(
            now_ms >= event.resolution_deadline_ms,
            Code::TooEarly,
            "the deadline has not passed yet",
        );
        Self::expire_if_due(event_id, &mut event, &caller, now_ms);
        let outcome = event.outcome;
        self.save_event(event_id, event);
        outcome
    }
}
