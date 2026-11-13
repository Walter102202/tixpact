//! Unit tests: pure logic and exact time boundaries, which the sandbox cannot hit to the
//! millisecond. Receipts, balances and real time are covered by the sandbox tests in `tests/`.

use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

use super::*;
use crate::accounting::quote_event_budget;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;

const ESCROW: &str = "escrow.near";
const ORGANIZER: &str = "org.near";
const VERIFIER: &str = "teatro.near";
const ANA: &str = "ana.near";
const LUIS: &str = "luis.near";
const PRICE: u128 = 1_500_000_000_000_000_000_000_000;

const STARTS: u64 = 2_000_000;
const ENDS: u64 = 3_000_000;
const DEADLINE: u64 = 4_000_000;

fn id(text: &str) -> AccountId {
    text.parse().expect("valid account id")
}

/// Sets the next call's caller, deposit and block time.
fn call_as(predecessor: &str, deposit: u128, now_ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(id(ESCROW))
            .predecessor_account_id(id(predecessor))
            .signer_account_id(id(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(now_ms * 1_000_000)
            .account_balance(NearToken::from_near(1_000))
            .build()
    );
}

/// Runs a call that must fail and asserts that its panic message starts with `code`.
fn fails_with(code: &str, call: impl FnOnce()) {
    let payload = std::panic::catch_unwind(std::panic::AssertUnwindSafe(call))
        .expect_err("the call should have failed");
    let text = payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|text| text.to_string()))
        .unwrap_or_default();
    // The mocked host reports a contract panic as `GuestPanic { panic_msg: "<message>" }`.
    assert!(
        text.contains(&format!("panic_msg: \"{code}: ")),
        "expected {code}, got: {text}"
    );
}

fn terms() -> EventTerms {
    EventTerms {
        title: "Jazz night".to_string(),
        venue: "Teatro Municipal".to_string(),
        starts_at_ms: STARTS,
        ends_at_ms: ENDS,
        resolution_deadline_ms: DEADLINE,
        price: U128(PRICE),
        capacity: 3,
        verifier_id: id(VERIFIER),
    }
}

/// A contract with one accepted event and a ticket bought by Ana at time 1_500_000.
fn contract_with_a_sold_ticket() -> Contract {
    call_as(ESCROW, 0, 1_000_000);
    let mut contract = Contract::new();
    call_as(ORGANIZER, quote_event_budget(3), 1_000_000);
    let event_id = contract.create_event(terms());
    let hash = contract
        .get_event(event_id)
        .expect("event exists")
        .terms_hash;
    call_as(VERIFIER, 1, 1_000_000);
    contract.accept_verification(event_id, hash);
    call_as(ANA, PRICE, 1_500_000);
    assert_eq!(contract.buy_ticket(event_id), "1-1");
    contract
}

#[test]
fn config_reports_the_frozen_limits() {
    call_as(ESCROW, 0, 1);
    let config = Contract::new().get_config();

    assert_eq!(config.version, "1.0.0");
    assert_eq!(config.max_capacity, 100);
    assert_eq!(config.max_page, 50);
    assert_eq!(config.history_cap, 16);
    assert!(!config.fault_injection);
}

/// `t15_deadline_boundaries` in the sandbox shows each window from both sides; this pins the
/// exact millisecond, which no sandbox transaction can be placed on.
#[test]
fn deadline_boundaries_are_exact() {
    let mut contract = contract_with_a_sold_ticket();

    // Buy and transfer: open until one millisecond before the start, closed at the start.
    call_as(LUIS, PRICE, STARTS - 1);
    assert_eq!(contract.buy_ticket(1), "1-2");
    call_as(ANA, PRICE, STARTS);
    fails_with("ERR_TOO_LATE", || {
        contract.buy_ticket(1);
    });
    call_as(ANA, 1, STARTS);
    fails_with("ERR_TOO_LATE", || {
        contract.nft_transfer(id(LUIS), "1-1".to_string(), None, None)
    });
    call_as(ANA, 1, STARTS - 1);
    contract.nft_transfer(id(LUIS), "1-1".to_string(), None, None);

    // Attest: closed one millisecond before the end and at the deadline.
    call_as(VERIFIER, 1, ENDS - 1);
    fails_with("ERR_TOO_EARLY", || contract.attest_completed(1, None));
    call_as(VERIFIER, 1, DEADLINE);
    fails_with("ERR_TOO_LATE", || contract.attest_completed(1, None));

    // Cancel: closed at the deadline.
    call_as(ORGANIZER, 1, DEADLINE);
    fails_with("ERR_TOO_LATE", || contract.cancel_event(1, None));

    // Expire: closed one millisecond before the deadline, open at the deadline.
    call_as(LUIS, 0, DEADLINE - 1);
    fails_with("ERR_TOO_EARLY", || {
        contract.expire_event(1);
    });
    call_as(LUIS, 0, DEADLINE);
    assert_eq!(contract.expire_event(1), Outcome::Refundable);
}

#[test]
fn attestation_is_open_from_the_exact_end() {
    let mut contract = contract_with_a_sold_ticket();
    call_as(VERIFIER, 1, ENDS);
    contract.attest_completed(1, Some("ipfs://evidence".to_string()));
    let event = contract.get_event(1).expect("event exists");
    assert_eq!(event.outcome, Outcome::Completed);
    assert_eq!(event.evidence_ref.as_deref(), Some("ipfs://evidence"));
}

#[test]
fn cancel_is_open_until_one_millisecond_before_the_deadline() {
    let mut contract = contract_with_a_sold_ticket();
    call_as(VERIFIER, 1, DEADLINE - 1);
    contract.cancel_event(1, Some("venue closed".to_string()));
    let event = contract.get_event(1).expect("event exists");
    assert_eq!(event.outcome_reason, Some(OutcomeReason::Cancelled));
    assert_eq!(event.evidence_ref.as_deref(), Some("venue closed"));
}

#[test]
fn phase_follows_the_time_and_the_outcome() {
    let mut contract = contract_with_a_sold_ticket();
    let at = |contract: &Contract, now_ms: u64| {
        call_as(ANA, 0, now_ms);
        contract.get_event(1).expect("event exists").phase
    };
    assert_eq!(at(&contract, STARTS - 1), Phase::OnSale);
    assert_eq!(at(&contract, STARTS), Phase::InProgress);
    assert_eq!(at(&contract, ENDS), Phase::AwaitingAttestation);
    assert_eq!(at(&contract, DEADLINE), Phase::Expirable);

    call_as(LUIS, PRICE, 1_600_000);
    contract.buy_ticket(1);
    call_as(LUIS, PRICE, 1_600_000);
    contract.buy_ticket(1);
    assert_eq!(at(&contract, 1_600_000), Phase::SoldOut);

    call_as(ORGANIZER, 1, 1_700_000);
    contract.cancel_event(1, None);
    assert_eq!(at(&contract, 1_700_000), Phase::Refundable);
}

#[test]
fn an_event_not_yet_accepted_awaits_its_verifier() {
    call_as(ESCROW, 0, 1_000_000);
    let mut contract = Contract::new();
    call_as(ORGANIZER, quote_event_budget(3), 1_000_000);
    contract.create_event(terms());
    assert_eq!(
        contract.get_event(1).expect("event exists").phase,
        Phase::AwaitingVerifier
    );
}

#[test]
fn claim_is_derived_from_the_outcome_and_the_status() {
    use TicketStatus::*;
    assert_eq!(views::claim(Outcome::Unresolved, Active), Claim::Reserved);
    assert_eq!(
        views::claim(Outcome::Unresolved, TransferPending),
        Claim::Reserved
    );
    assert_eq!(
        views::claim(Outcome::Completed, Active),
        Claim::ReleasedToOrganizer
    );
    assert_eq!(views::claim(Outcome::Refundable, Active), Claim::Refundable);
    assert_eq!(
        views::claim(Outcome::Refundable, TransferPending),
        Claim::Refundable
    );
    assert_eq!(
        views::claim(Outcome::Refundable, RefundPending),
        Claim::RefundPending
    );
    assert_eq!(views::claim(Outcome::Refundable, Refunded), Claim::Refunded);
}

#[test]
fn terms_hash_is_sha256_of_the_borsh_terms() {
    call_as(ORGANIZER, 0, 1);
    let organizer = id(ORGANIZER);
    let terms = terms();
    let mut encoded = Vec::new();
    for text in [ORGANIZER, VERIFIER, "Jazz night", "Teatro Municipal"] {
        encoded.extend_from_slice(&(text.len() as u32).to_le_bytes());
        encoded.extend_from_slice(text.as_bytes());
    }
    encoded.extend_from_slice(&STARTS.to_le_bytes());
    encoded.extend_from_slice(&ENDS.to_le_bytes());
    encoded.extend_from_slice(&DEADLINE.to_le_bytes());
    encoded.extend_from_slice(&PRICE.to_le_bytes());
    encoded.extend_from_slice(&3u32.to_le_bytes());

    let hash = events::terms_hash(&organizer, &terms);
    assert_eq!(hash, near_sdk::env::sha256_array(&encoded));
    let hex = events::to_hex(&hash);
    assert_eq!(hex.len(), 64);
    assert!(
        hex.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    );
}

/// A contract whose event 1 was cancelled and whose ticket "1-1" has a refund in flight as
/// operation 1. Returns it with Ana as the claimant.
fn contract_with_a_pending_refund() -> Contract {
    let mut contract = contract_with_a_sold_ticket();
    call_as(ORGANIZER, 1, 1_600_000);
    contract.cancel_event(1, None);
    call_as(ANA, 1, 1_700_000);
    let _ = contract.claim_refund("1-1".to_string());
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::RefundPending);
    assert_eq!(ticket.pending_operation_id, Some(1));
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.refund_pending.0, PRICE);
    assert_eq!(accounting.principal_reserved.0, 0);
    assert_eq!(contract.total_held, 0);
    contract
}

/// A contract whose event 1 was attested and whose payout is in flight as operation 1.
fn contract_with_a_pending_payout() -> Contract {
    let mut contract = contract_with_a_sold_ticket();
    call_as(VERIFIER, 1, ENDS);
    contract.attest_completed(1, None);
    call_as(ORGANIZER, 1, ENDS + 1);
    let _ = contract.claim_payout(1);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.organizer_pending.0, PRICE);
    assert_eq!(accounting.organizer_available.0, 0);
    assert_eq!(contract.total_held, 0);
    contract
}

/// The callback as the runtime calls it: from the contract itself, after the transfer.
fn as_callback() {
    call_as(ESCROW, 0, 1_800_000);
}

fn assert_identity(contract: &Contract) {
    let ledger = &contract.load_event(1).ledger;
    assert!(ledger.identity_holds(), "{ledger:?}");
    assert_eq!(contract.total_held, ledger.held());
}

#[test]
fn refund_callback_settles_a_delivered_transfer() {
    let mut contract = contract_with_a_pending_refund();
    as_callback();
    assert!(contract.on_refund_result(1, Ok(())));

    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::Refunded);
    assert_eq!(ticket.claim, Claim::Refunded);
    assert_eq!(ticket.pending_operation_id, None);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.refunds_settled.0, PRICE);
    assert_eq!(accounting.refund_pending.0, 0);
    assert!(contract.get_operation(1).is_none());
    assert_identity(&contract);
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|line| line.contains("\"refund_settled\"")));
}

#[test]
fn refund_callback_restores_the_right_after_a_failed_transfer() {
    let mut contract = contract_with_a_pending_refund();
    as_callback();
    assert!(!contract.on_refund_result(1, Err(near_sdk::PromiseError::Failed)));

    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::Active);
    assert_eq!(ticket.claim, Claim::Refundable);
    assert_eq!(ticket.pending_operation_id, None);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.principal_reserved.0, PRICE);
    assert_eq!(accounting.refund_pending.0, 0);
    assert_eq!(accounting.refunds_settled.0, 0);
    assert_eq!(contract.total_held, PRICE);
    assert_identity(&contract);
    let history = contract
        .get_ticket_history("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(
        history.entries.last().map(|entry| entry.kind),
        Some(HistoryKind::RefundFailed)
    );

    // A second delivery of the same callback finds nothing to restore.
    as_callback();
    assert!(!contract.on_refund_result(1, Err(near_sdk::PromiseError::Failed)));
    assert_eq!(contract.total_held, PRICE);
    assert_identity(&contract);
}

#[test]
fn payout_callback_settles_a_delivered_transfer() {
    let mut contract = contract_with_a_pending_payout();
    as_callback();
    assert!(contract.on_payout_result(1, Ok(())));

    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.organizer_settled.0, PRICE);
    assert_eq!(accounting.organizer_pending.0, 0);
    assert!(contract.get_operation(1).is_none());
    assert_identity(&contract);

    // Nothing is left to pay.
    call_as(ORGANIZER, 1, ENDS + 2);
    fails_with("ERR_NOTHING_TO_PAY", || {
        let _ = contract.claim_payout(1);
    });
}

#[test]
fn payout_callback_makes_the_amount_available_again_after_a_failed_transfer() {
    let mut contract = contract_with_a_pending_payout();
    as_callback();
    assert!(!contract.on_payout_result(1, Err(near_sdk::PromiseError::Failed)));

    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.organizer_available.0, PRICE);
    assert_eq!(accounting.organizer_pending.0, 0);
    assert_eq!(accounting.organizer_settled.0, 0);
    assert_eq!(contract.total_held, PRICE);
    assert_identity(&contract);

    as_callback();
    assert!(!contract.on_payout_result(1, Err(near_sdk::PromiseError::Failed)));
    assert_eq!(contract.total_held, PRICE);
}

#[test]
fn a_callback_ignores_an_operation_of_the_other_kind() {
    let mut contract = contract_with_a_pending_payout();
    as_callback();
    assert!(!contract.on_refund_result(1, Ok(())));
    let operation = contract.get_operation(1).expect("still pending");
    assert_eq!(operation.kind, OperationKind::Payout);
    assert_eq!(
        contract
            .get_accounting(1)
            .expect("event exists")
            .organizer_pending
            .0,
        PRICE
    );
}

#[test]
fn a_payout_in_flight_blocks_a_second_one() {
    let mut contract = contract_with_a_pending_payout();
    call_as(ORGANIZER, 1, ENDS + 2);
    fails_with("ERR_PAYOUT_PENDING", || {
        let _ = contract.claim_payout(1);
    });
}

#[test]
fn history_keeps_the_first_entry_and_the_latest_fifteen() {
    let mut contract = contract_with_a_sold_ticket();
    let mut holder = ANA;
    for _ in 0..20 {
        let next = if holder == ANA { LUIS } else { ANA };
        call_as(holder, 1, 1_600_000);
        contract.nft_transfer(id(next), "1-1".to_string(), None, None);
        holder = next;
    }
    let history = contract
        .get_ticket_history("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(history.entries.len(), 16);
    assert_eq!(history.dropped, 5);
    assert_eq!(history.entries[0].kind, HistoryKind::Purchased);
    assert_eq!(history.entries[0].account_id, id(ANA));
    assert_eq!(
        history.entries[15].account_id,
        id(holder),
        "the last entry names the current holder"
    );
}
