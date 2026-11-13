//! NEP-297 events of standard `ticket_escrow`, version `1.0.0` (plan, "Events (NEP-297)").
//!
//! Each log line is `EVENT_JSON:{"standard":"ticket_escrow","version":"1.0.0","event":<name>,
//! "data":[{...}]}`. Token mint and transfer use the standard `nep171` events instead.

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::{AccountId, env};

use crate::events::{Outcome, OutcomeReason};
use crate::settlement::Operation;

const STANDARD: &str = "ticket_escrow";
const VERSION: &str = "1.0.0";

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Envelope<'a> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: [Value; 1],
}

fn emit(event: &str, data: Value) {
    let envelope = Envelope {
        standard: STANDARD,
        version: VERSION,
        event,
        data: [data],
    };
    // Serializing plain JSON values cannot fail.
    let text = serde_json::to_string(&envelope).unwrap_or_else(|_| env::abort());
    env::log_str(&format!("EVENT_JSON:{text}"));
}

pub fn event_created(
    event_id: u32,
    organizer_id: &AccountId,
    verifier_id: &AccountId,
    terms_hash: &str,
    price: u128,
    capacity: u32,
) {
    emit(
        "event_created",
        json!({
            "event_id": event_id,
            "organizer_id": organizer_id,
            "verifier_id": verifier_id,
            "terms_hash": terms_hash,
            "price": U128(price),
            "capacity": capacity,
        }),
    );
}

pub fn verification_accepted(event_id: u32, verifier_id: &AccountId, terms_hash: &str) {
    emit(
        "verification_accepted",
        json!({ "event_id": event_id, "verifier_id": verifier_id, "terms_hash": terms_hash }),
    );
}

pub fn ticket_purchased(event_id: u32, token_id: &str, owner_id: &AccountId, price: u128) {
    emit(
        "ticket_purchased",
        json!({
            "event_id": event_id,
            "token_id": token_id,
            "owner_id": owner_id,
            "price": U128(price),
        }),
    );
}

pub fn event_resolved(event_id: u32, outcome: Outcome, reason: OutcomeReason, by: &AccountId) {
    emit(
        "event_resolved",
        json!({ "event_id": event_id, "outcome": outcome, "reason": reason, "by": by }),
    );
}

/// `refund_requested`, `refund_settled`, `refund_failed`, `payout_requested`, `payout_settled` and
/// `payout_failed`: each carries the operation, its recipient and its amount.
pub fn settlement(event: &str, operation_id: u64, operation: &Operation) {
    emit(
        event,
        json!({
            "operation_id": operation_id,
            "kind": operation.kind,
            "event_id": operation.event_id,
            "token_id": operation.token_id,
            "recipient_id": operation.recipient_id,
            "amount": U128(operation.amount),
        }),
    );
}
