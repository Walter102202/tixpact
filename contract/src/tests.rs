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

const RECEIVER: &str = "receiver.near";

/// Ana sends ticket "1-1" to a contract with `nft_transfer_call`; the resolver has not run.
fn contract_with_a_transfer_in_flight() -> Contract {
    use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
    let mut contract = contract_with_a_sold_ticket();
    call_as(ANA, 1, 1_600_000);
    let _ = contract.nft_transfer_call(id(RECEIVER), "1-1".to_string(), None, None, "keep".into());
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::TransferPending);
    assert_eq!(ticket.owner_id, id(RECEIVER));
    contract
}

/// The resolver as the runtime calls it, at `now_ms`, with the receiver's answer `answer`.
fn resolve_with(contract: &mut Contract, answer: near_sdk::PromiseResult, now_ms: u64) -> bool {
    use near_contract_standards::non_fungible_token::core::NonFungibleTokenResolver;
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(id(ESCROW))
            .predecessor_account_id(id(ESCROW))
            .block_timestamp(now_ms * 1_000_000)
            .account_balance(NearToken::from_near(1_000))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![answer],
    );
    contract.nft_resolve_transfer(id(ANA), id(RECEIVER), "1-1".to_string(), None)
}

/// Resolves the in-flight transfer with `answer` and checks who holds the ticket afterwards. Each
/// answer gets its own test: the mocked storage is per test thread, so one contract per test.
fn resolve_and_check(answer: near_sdk::PromiseResult, kept: bool) {
    let mut contract = contract_with_a_transfer_in_flight();
    assert_eq!(resolve_with(&mut contract, answer, 1_600_001), kept);
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::Active, "the lock is cleared");
    let holder = if kept { RECEIVER } else { ANA };
    assert_eq!(ticket.owner_id, id(holder));
    let history = contract
        .get_ticket_history("1-1".to_string())
        .expect("ticket exists");
    let last = history.entries.last().expect("history has entries");
    let expected = if kept {
        HistoryKind::Transferred
    } else {
        HistoryKind::TransferReturned
    };
    assert_eq!(last.kind, expected);
    assert_eq!(last.account_id, id(holder));
}

#[test]
fn resolver_keeps_the_ticket_on_a_clean_false() {
    resolve_and_check(near_sdk::PromiseResult::Successful(b"false".to_vec()), true);
}

#[test]
fn resolver_returns_the_ticket_on_true() {
    resolve_and_check(near_sdk::PromiseResult::Successful(b"true".to_vec()), false);
}

#[test]
fn resolver_returns_the_ticket_when_the_receiver_failed() {
    resolve_and_check(near_sdk::PromiseResult::Failed, false);
}

#[test]
fn resolver_returns_the_ticket_on_an_answer_that_is_not_json() {
    resolve_and_check(
        near_sdk::PromiseResult::Successful(b"maybe".to_vec()),
        false,
    );
}

#[test]
fn resolver_returns_the_ticket_on_an_answer_longer_than_a_boolean() {
    resolve_and_check(
        near_sdk::PromiseResult::Successful(b"false      ".to_vec()),
        false,
    );
}

#[test]
fn resolver_returns_the_ticket_on_an_empty_answer() {
    resolve_and_check(near_sdk::PromiseResult::Successful(Vec::new()), false);
}

#[test]
fn resolver_finishes_after_the_start_and_after_an_outcome() {
    // The window only gates starting a transfer. One that started in time always finishes.
    let mut contract = contract_with_a_transfer_in_flight();
    call_as(ORGANIZER, 1, 1_700_000);
    contract.cancel_event(1, None);
    assert!(!resolve_with(
        &mut contract,
        near_sdk::PromiseResult::Failed,
        STARTS + 10
    ));
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.owner_id, id(ANA));
    assert_eq!(ticket.status, TicketStatus::Active);
    assert_eq!(ticket.claim, Claim::Refundable);
}

#[test]
fn a_locked_ticket_cannot_be_claimed_or_moved() {
    use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
    let mut contract = contract_with_a_transfer_in_flight();
    call_as(ORGANIZER, 1, 1_700_000);
    contract.cancel_event(1, None);
    call_as(RECEIVER, 1, 1_700_001);
    fails_with("ERR_TICKET_LOCKED", || {
        let _ = contract.claim_refund("1-1".to_string());
    });
    call_as(RECEIVER, 1, 1_700_001);
    fails_with("ERR_TICKET_LOCKED", || {
        contract.nft_transfer(id(LUIS), "1-1".to_string(), None, None)
    });
}

/// Sets the next call's caller, deposit, block time and prepaid gas.
fn call_with_gas(predecessor: &str, deposit: u128, now_ms: u64, tgas: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(id(ESCROW))
            .predecessor_account_id(id(predecessor))
            .signer_account_id(id(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(now_ms * 1_000_000)
            .account_balance(NearToken::from_near(1_000))
            .prepaid_gas(near_sdk::Gas::from_tgas(tgas))
            .build()
    );
}

/// Every check of `nft_transfer_call` runs before it writes anything. The mocked host does not
/// roll back a failed call, so an early write would show here.
#[test]
fn transfer_call_checks_everything_before_any_change() {
    let mut contract = contract_with_a_sold_ticket();
    let unchanged = |contract: &Contract| {
        let ticket = contract
            .get_ticket("1-1".to_string())
            .expect("ticket exists");
        assert_eq!(ticket.status, TicketStatus::Active);
        assert_eq!(ticket.owner_id, id(ANA));
        let history = contract
            .get_ticket_history("1-1".to_string())
            .expect("ticket exists");
        assert_eq!(history.entries.len(), 1, "nothing was recorded");
    };
    let receiver = || id(RECEIVER);
    let token = || "1-1".to_string();

    call_with_gas(ANA, 1, 1_600_000, 300);
    fails_with("ERR_LIMIT", || {
        let _ = contract.nft_transfer_call(receiver(), token(), None, None, "m".repeat(1_025));
    });
    unchanged(&contract);

    call_with_gas(ANA, 1, 1_600_000, 300);
    fails_with("ERR_LIMIT", || {
        let memo = Some("m".repeat(257));
        let _ = contract.nft_transfer_call(receiver(), token(), None, memo, "keep".into());
    });
    unchanged(&contract);

    call_with_gas(ANA, 1, 1_600_000, 300);
    fails_with("ERR_APPROVALS_DISABLED", || {
        let _ = contract.nft_transfer_call(receiver(), token(), Some(0), None, "keep".into());
    });
    unchanged(&contract);

    call_with_gas(ANA, 0, 1_600_000, 300);
    fails_with("ERR_ONE_YOCTO", || {
        let _ = contract.nft_transfer_call(receiver(), token(), None, None, "keep".into());
    });
    unchanged(&contract);

    call_with_gas(ANA, 1, 1_600_000, GAS_TRANSFER_CALL_MIN.as_tgas() - 1);
    fails_with("ERR_INSUFFICIENT_GAS", || {
        let _ = contract.nft_transfer_call(receiver(), token(), None, None, "keep".into());
    });
    unchanged(&contract);

    // At the limits it goes through.
    call_with_gas(ANA, 1, 1_600_000, GAS_TRANSFER_CALL_MIN.as_tgas());
    let _ = contract.nft_transfer_call(
        receiver(),
        token(),
        None,
        Some("m".repeat(256)),
        "m".repeat(1_024),
    );
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::TransferPending);
}

/// `storage_usage` every measured call starts from. The mocked host resets the counter on each
/// `testing_env!` but keeps the stored data, so each call's delta is read inside its own context.
const BASE_USAGE: u64 = 10_000_000;

/// A 64-character account id, the longest NEAR allows.
fn long(name: &str) -> AccountId {
    let id = format!("{name:x<59}.near");
    assert_eq!(id.len(), 64);
    id.parse().expect("valid account id")
}

/// Runs one call as `predecessor` and returns the bytes of storage it added, with every `store`
/// collection written.
fn bytes_added(
    contract: &mut Contract,
    predecessor: &AccountId,
    deposit: u128,
    now_ms: u64,
    call: impl FnOnce(&mut Contract),
) -> i64 {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(id(ESCROW))
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor.clone())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(now_ms * 1_000_000)
            .account_balance(NearToken::from_near(100_000))
            .storage_usage(BASE_USAGE)
            .build()
    );
    call(contract);
    contract.events.flush();
    contract.tickets.flush();
    contract.operations.flush();
    i64::try_from(near_sdk::env::storage_usage()).expect("small") - BASE_USAGE as i64
}

/// The largest event terms: 64-character verifier, longest title and venue, full capacity.
fn largest_terms() -> EventTerms {
    EventTerms {
        title: "t".repeat(MAX_TITLE_BYTES as usize),
        venue: "v".repeat(MAX_VENUE_BYTES as usize),
        capacity: MAX_CAPACITY,
        verifier_id: long("verifier"),
        ..terms()
    }
}

/// The measured constants are the worst case plus 20%, rounded up.
fn with_margin(bytes: i64) -> u128 {
    u128::try_from(bytes * 6).expect("positive").div_ceil(5)
}

/// Measures the most storage one event and one ticket can use (plan, Task C4): 64-character
/// accounts everywhere, the longest texts, a full ticket history, a pending operation, and every
/// holder with an owner index of its own. `storage_per_event` and `storage_per_ticket` must be
/// exactly these numbers plus 20%.
#[test]
fn storage_constants_are_the_measured_worst_case_plus_twenty_percent() {
    let organizer = long("organizer");
    let verifier = long("verifier");
    let budget = quote_event_budget(MAX_CAPACITY);
    call_as(ESCROW, 0, 1_000_000);
    let mut contract = Contract::new();

    // Nine events first, so the measured ones have two-digit ids ("10-100").
    for _ in 0..9 {
        let _ = bytes_added(&mut contract, &organizer, budget, 1_000_000, |c| {
            c.create_event(largest_terms());
        });
    }

    // Event 10: sold out; its last ticket is the one measured.
    let created = bytes_added(&mut contract, &organizer, budget, 1_000_000, |c| {
        assert_eq!(c.create_event(largest_terms()), 10);
    });
    let hash = contract.get_event(10).expect("event exists").terms_hash;
    let accepted = bytes_added(&mut contract, &verifier, 1, 1_000_000, |c| {
        c.accept_verification(10, hash)
    });
    assert_eq!(accepted, 0, "accepting adds no bytes");
    for serial in 1..MAX_CAPACITY {
        let buyer = long(&format!("buyer-{serial}"));
        let _ = bytes_added(&mut contract, &buyer, PRICE, 1_500_000, |c| {
            c.buy_ticket(10);
        });
    }

    let mut holder = long("holder-0");
    let bought = bytes_added(&mut contract, &holder, PRICE, 1_500_000, |c| {
        assert_eq!(c.buy_ticket(10), "10-100");
    });
    let mut ticket = bought;
    // Twenty transfers, each to a new holder: the history fills up and the previous holder's
    // owner index is removed.
    for step in 1..=20 {
        let next = long(&format!("holder-{step}"));
        ticket += bytes_added(&mut contract, &holder, 1, 1_600_000, |c| {
            c.nft_transfer(next.clone(), "10-100".to_string(), None, None)
        });
        holder = next;
    }
    let history = contract
        .get_ticket_history("10-100".to_string())
        .expect("ticket exists");
    assert_eq!(history.entries.len(), HISTORY_CAP as usize);
    let _ = bytes_added(&mut contract, &organizer, 1, 1_600_000, |c| {
        c.cancel_event(10, Some("r".repeat(MAX_REF_BYTES as usize)))
    });
    ticket += bytes_added(&mut contract, &holder, 1, 1_700_000, |c| {
        let _ = c.claim_refund("10-100".to_string());
    });
    let ticket_status = contract
        .get_ticket("10-100".to_string())
        .expect("ticket exists")
        .status;
    assert_eq!(ticket_status, TicketStatus::RefundPending);

    // A ticket id is stored six times: the ticket record's key, the token owner's key, the
    // token tree node, the holder's owner index (key and element) and the pending refund. The
    // measured id is 6 bytes; the longest possible is 14 ("4294967295-100").
    const TOKEN_ID_COPIES: i64 = 6;
    let longest_id = format!("{}-{MAX_CAPACITY}", u32::MAX).len() as i64;
    let ticket_worst = ticket + TOKEN_ID_COPIES * (longest_id - "10-100".len() as i64);

    // Event 11: completed with a payout in flight, the larger of the two outcomes.
    let mut event = created;
    let hash_11 = {
        let _ = bytes_added(&mut contract, &organizer, budget, 1_000_000, |c| {
            assert_eq!(c.create_event(largest_terms()), 11);
        });
        contract.get_event(11).expect("event exists").terms_hash
    };
    let _ = bytes_added(&mut contract, &verifier, 1, 1_000_000, |c| {
        c.accept_verification(11, hash_11)
    });
    let short_buy = bytes_added(&mut contract, &long("buyer-x"), PRICE, 1_500_000, |c| {
        assert_eq!(c.buy_ticket(11), "11-1");
    });
    // At purchase five of the six copies exist; two more bytes of id cost two bytes each.
    assert_eq!(bought - short_buy, 5 * 2, "the id copies are as counted");
    event += bytes_added(&mut contract, &verifier, 1, ENDS, |c| {
        c.attest_completed(11, Some("e".repeat(MAX_REF_BYTES as usize)))
    });
    event += bytes_added(&mut contract, &organizer, 1, ENDS + 1, |c| {
        let _ = c.claim_payout(11);
    });

    eprintln!("measured worst case: event {event} bytes, ticket {ticket_worst} bytes");
    assert_eq!(
        accounting::STORAGE_BYTES_PER_EVENT,
        with_margin(event),
        "storage_per_event: measured {event} bytes"
    );
    assert_eq!(
        accounting::STORAGE_BYTES_PER_TICKET,
        with_margin(ticket_worst),
        "storage_per_ticket: measured {ticket_worst} bytes"
    );
}
