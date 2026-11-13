//! Unit tests: pure logic and exact time boundaries, which the sandbox cannot hit to the
//! millisecond. Receipts, balances and real time are covered by the sandbox tests in `tests/`.

use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

use super::*;
use crate::accounting::quote_event_budget;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;

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
        currency: None,
    }
}

/// A contract with one accepted event and a ticket bought by Ana at time 1_500_000.
fn contract_with_a_sold_ticket() -> Contract {
    call_as(ESCROW, 0, 1_000_000);
    let mut contract = Contract::new(Vec::new());
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
    let config = Contract::new(Vec::new()).get_config();

    assert_eq!(config.version, "2.0.0");
    assert_eq!(config.max_capacity, 100);
    assert_eq!(config.max_page, 50);
    assert_eq!(config.history_cap, 16);
    assert!(!config.fault_injection);
    assert!(config.tokens.is_empty());
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
    let mut contract = Contract::new(Vec::new());
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
    // The currency, last: `None` is one zero byte.
    let mut near_encoded = encoded.clone();
    near_encoded.push(0);

    let hash = events::terms_hash(&organizer, &terms);
    assert_eq!(hash, near_sdk::env::sha256_array(&near_encoded));

    // `Some(token)` is a one byte, then the account id as a Borsh string.
    let token = "tusd.near";
    let mut token_encoded = encoded;
    token_encoded.push(1);
    token_encoded.extend_from_slice(&(token.len() as u32).to_le_bytes());
    token_encoded.extend_from_slice(token.as_bytes());
    let priced_in_token = EventTerms {
        currency: Some(id(token)),
        ..terms.clone()
    };
    assert_eq!(
        events::terms_hash(&organizer, &priced_in_token),
        near_sdk::env::sha256_array(&token_encoded)
    );
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

/// The resolver as the runtime calls it, at `now_ms`, with the receiver's answer `answer` and
/// exactly its static gas. The mocked host charges its own fees (the register copy of the
/// answer, storage) against that gas and panics past it; the wasm's own work is not metered.
fn resolve_with(contract: &mut Contract, answer: near_sdk::PromiseResult, now_ms: u64) -> bool {
    use near_contract_standards::non_fungible_token::core::NonFungibleTokenResolver;
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(id(ESCROW))
            .predecessor_account_id(id(ESCROW))
            .block_timestamp(now_ms * 1_000_000)
            .account_balance(NearToken::from_near(1_000))
            .prepaid_gas(GAS_FOR_RESOLVE_TRANSFER)
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
/// Returns the gas the mocked host charged the resolver.
fn resolve_and_check(answer: near_sdk::PromiseResult, kept: bool) -> near_sdk::Gas {
    let mut contract = contract_with_a_transfer_in_flight();
    assert_eq!(resolve_with(&mut contract, answer, 1_600_001), kept);
    let used = env::used_gas();
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
    used
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

/// A listed token with a 64-character account id.
fn longest_token() -> TokenSpec {
    TokenSpec {
        account_id: long("token"),
        symbol: "t".repeat(MAX_SYMBOL_BYTES),
        decimals: MAX_DECIMALS,
    }
}

/// The largest event terms in NEAR: 64-character verifier, longest title and venue, full
/// capacity.
fn largest_terms() -> EventTerms {
    EventTerms {
        title: "t".repeat(MAX_TITLE_BYTES as usize),
        venue: "v".repeat(MAX_VENUE_BYTES as usize),
        capacity: MAX_CAPACITY,
        verifier_id: long("verifier"),
        ..terms()
    }
}

/// The same terms priced in the token with a 64-character id: the largest event record.
fn largest_token_terms() -> EventTerms {
    EventTerms {
        currency: Some(longest_token().account_id),
        ..largest_terms()
    }
}

/// The measured constants are the worst case plus 20%, rounded up.
fn with_margin(bytes: i64) -> u128 {
    u128::try_from(bytes * 6).expect("positive").div_ceil(5)
}

/// Measures the most storage one event and one ticket can use (plan, Tasks C4 and C7):
/// 64-character accounts everywhere (the currency too), the longest texts, a full ticket history,
/// a pending operation, and every holder with an owner index of its own. `storage_per_event` and
/// `storage_per_ticket` must be exactly these numbers plus 20%.
#[test]
fn storage_constants_are_the_measured_worst_case_plus_twenty_percent() {
    let organizer = long("organizer");
    let verifier = long("verifier");
    let budget = quote_event_budget(MAX_CAPACITY);
    call_as(ESCROW, 0, 1_000_000);
    let mut contract = Contract::new(vec![longest_token()]);

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
    let mut event = 0;
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
    // Event 12: the largest terms priced in the token. The outcome and the payout add the same
    // bytes in every currency (an operation stores no currency), so its record completes the sum.
    let created_in_token = bytes_added(&mut contract, &organizer, budget, 1_000_000, |c| {
        assert_eq!(c.create_event(largest_token_terms()), 12);
    });
    assert_eq!(
        created_in_token - created,
        4 + 64,
        "the currency adds its account id as a Borsh string"
    );
    event += created_in_token;

    // A ticket bought with the token stores exactly what a ticket bought with NEAR stores (neither
    // the ticket nor its operation keeps the currency), so `storage_per_ticket` covers both.
    let hash_12 = contract.get_event(12).expect("event exists").terms_hash;
    let _ = bytes_added(&mut contract, &verifier, 1, 1_000_000, |c| {
        c.accept_verification(12, hash_12)
    });
    let token = longest_token().account_id;
    let token_buy = bytes_added(&mut contract, &token, 0, 1_500_000, |c| {
        let kept = c.ft_on_transfer(long("buyer-y"), U128(PRICE), "{\"event_id\":12}".into());
        assert_eq!(kept, U128(0));
    });
    assert_eq!(
        token_buy, short_buy,
        "a token ticket stores what a NEAR ticket stores"
    );

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

/// `nft_transfer_call` is a second way into the transfer rules (R6, R8): each one rejects it
/// exactly as it rejects `nft_transfer`, and leaves the ticket as it was.
#[test]
fn transfer_call_follows_every_transfer_rule() {
    let mut contract = contract_with_a_sold_ticket();
    let token = || "1-1".to_string();
    let unchanged = |contract: &Contract, status: TicketStatus, entries: usize| {
        let ticket = contract.get_ticket(token()).expect("ticket exists");
        assert_eq!(ticket.owner_id, id(ANA));
        assert_eq!(ticket.status, status);
        let history = contract.get_ticket_history(token()).expect("ticket exists");
        assert_eq!(history.entries.len(), entries);
    };
    let send = |contract: &mut Contract, caller: &str, to: &str, now_ms: u64, code: &str| {
        call_with_gas(caller, 1, now_ms, 300);
        fails_with(code, || {
            let _ = contract.nft_transfer_call(id(to), token(), None, None, "keep".into());
        });
    };

    // Someone who does not hold it.
    send(&mut contract, LUIS, RECEIVER, 1_600_000, "ERR_UNAUTHORIZED");
    unchanged(&contract, TicketStatus::Active, 1);
    // To its own holder, and to the escrow itself.
    send(&mut contract, ANA, ANA, 1_600_000, "ERR_UNAUTHORIZED");
    unchanged(&contract, TicketStatus::Active, 1);
    send(&mut contract, ANA, ESCROW, 1_600_000, "ERR_UNAUTHORIZED");
    unchanged(&contract, TicketStatus::Active, 1);
    // At the start and after it.
    send(&mut contract, ANA, RECEIVER, STARTS, "ERR_TOO_LATE");
    unchanged(&contract, TicketStatus::Active, 1);
    send(&mut contract, ANA, RECEIVER, STARTS + 1, "ERR_TOO_LATE");
    unchanged(&contract, TicketStatus::Active, 1);
    // Once the event has an outcome.
    call_as(ORGANIZER, 1, 1_700_000);
    contract.cancel_event(1, None);
    send(
        &mut contract,
        ANA,
        RECEIVER,
        1_700_001,
        "ERR_ALREADY_RESOLVED",
    );
    unchanged(&contract, TicketStatus::Active, 1);
    // While its refund is in flight: the lock answers before the outcome check.
    call_as(ANA, 1, 1_700_002);
    let _ = contract.claim_refund(token());
    unchanged(&contract, TicketStatus::RefundPending, 2);
    send(&mut contract, ANA, RECEIVER, 1_700_003, "ERR_TICKET_LOCKED");
    unchanged(&contract, TicketStatus::RefundPending, 2);
}

#[test]
fn resolver_returns_the_ticket_on_the_largest_answer() {
    // `false` padded to 4 MiB, the protocol's limit: valid JSON, but longer than a boolean.
    let mut answer = vec![b' '; 4 * 1024 * 1024];
    answer[..5].copy_from_slice(b"false");
    // The resolver runs with exactly its static gas, so a host fee on the copy that outgrew it
    // would already have aborted the call. The sandbox test in `gas.rs` meters the wasm too.
    let used = resolve_and_check(near_sdk::PromiseResult::Successful(answer), false);
    assert!(
        used < GAS_FOR_RESOLVE_TRANSFER,
        "the host charged {used} of the resolver's {GAS_FOR_RESOLVE_TRANSFER}"
    );
}

#[test]
fn amounts_are_written_with_the_symbol_and_no_trailing_zeros() {
    use crate::currency::{NEAR, Unit};
    use crate::display::format_amount;
    let tusd = Unit {
        symbol: "tUSD",
        decimals: 6,
    };
    let whole = Unit {
        symbol: "PTS",
        decimals: 0,
    };
    assert_eq!(format_amount(PRICE, NEAR), "1.5 NEAR");
    assert_eq!(format_amount(PRICE / 3, NEAR), "0.5 NEAR");
    assert_eq!(format_amount(2 * PRICE, NEAR), "3 NEAR");
    assert_eq!(format_amount(0, NEAR), "0 NEAR");
    assert_eq!(format_amount(1, NEAR), "0.000000000000000000000001 NEAR");
    assert_eq!(
        format_amount(u128::MAX, NEAR),
        "340282366920938.463463374607431768211455 NEAR"
    );
    assert_eq!(format_amount(10_000_000, tusd), "10 tUSD");
    assert_eq!(format_amount(100_000_000, tusd), "100 tUSD");
    assert_eq!(format_amount(1_050_000, tusd), "1.05 tUSD");
    assert_eq!(format_amount(1, tusd), "0.000001 tUSD");
    assert_eq!(format_amount(120, whole), "120 PTS");
}

/// The drawn ticket inside a `media` data URL.
fn decode_svg(media: &str) -> String {
    use near_sdk::base64::Engine;
    use near_sdk::base64::engine::general_purpose::STANDARD;
    let encoded = media
        .strip_prefix("data:image/svg+xml;base64,")
        .expect("an SVG data URL");
    String::from_utf8(STANDARD.decode(encoded).expect("base64")).expect("UTF-8")
}

/// Ticket "1-1"'s metadata now, with its drawn ticket decoded and its hash checked.
fn metadata_and_svg(contract: &Contract) -> (TokenMetadata, String) {
    let token = contract
        .nft_token("1-1".to_string())
        .expect("ticket exists");
    let metadata = token.metadata.expect("metadata is derived");
    let svg = decode_svg(metadata.media.as_deref().expect("a drawn ticket"));
    assert!(svg.starts_with("<svg ") && svg.ends_with("</svg>"), "{svg}");
    assert!(svg.len() <= display::MAX_SVG_BYTES, "{} bytes", svg.len());
    let hash = metadata.media_hash.clone().expect("a media hash");
    assert_eq!(hash.0, near_sdk::env::sha256(svg.as_bytes()));
    (metadata, svg)
}

/// Checks ticket "1-1" of the default event against one state: the description's last sentence,
/// the facts in `extra` and the facts on the drawn ticket.
fn assert_ticket_shows(
    contract: &Contract,
    sentence: &str,
    [status, claim, outcome, word]: [&str; 4],
) {
    let (metadata, svg) = metadata_and_svg(contract);
    assert_eq!(metadata.title.as_deref(), Some("Jazz night - ticket 1"));
    let description = format!("Ticket 1 of 3 for Jazz night at Teatro Municipal. {sentence}");
    assert_eq!(metadata.description, Some(description));
    let extra = format!(
        "{{\"event_id\":1,\"serial\":1,\"status\":\"{status}\",\"claim\":\"{claim}\",\
         \"outcome\":\"{outcome}\",\"principal\":\"{PRICE}\",\"currency\":null}}"
    );
    assert_eq!(metadata.extra, Some(extra));
    for fact in ["Jazz night", "Ticket 1", "1.5 NEAR", word] {
        assert!(
            svg.contains(&format!(">{fact}<")),
            "{fact} is not drawn: {svg}"
        );
    }
    assert!(metadata.reference.is_none() && metadata.copies.is_none());
}

#[test]
fn metadata_follows_the_ticket_from_purchase_to_refund() {
    let mut contract = contract_with_a_sold_ticket();
    assert_ticket_shows(
        &contract,
        "1.5 NEAR is reserved in the contract until the event is resolved.",
        ["Active", "Reserved", "Unresolved", "Reserved"],
    );

    call_as(ORGANIZER, 1, 1_600_000);
    contract.cancel_event(1, None);
    assert_ticket_shows(
        &contract,
        "The event was not confirmed: whoever holds this ticket can claim 1.5 NEAR.",
        ["Active", "Refundable", "Refundable", "Claimable"],
    );

    call_as(ANA, 1, 1_700_000);
    let _ = contract.claim_refund("1-1".to_string());
    assert_ticket_shows(
        &contract,
        "A refund of 1.5 NEAR is on its way to the holder.",
        ["RefundPending", "RefundPending", "Refundable", "Sending"],
    );

    as_callback();
    assert!(contract.on_refund_result(1, Ok(())));
    assert_ticket_shows(
        &contract,
        "1.5 NEAR was refunded to the holder.",
        ["Refunded", "Refunded", "Refundable", "Refunded"],
    );
}

#[test]
fn metadata_says_the_price_went_to_the_organizer_once_confirmed() {
    let mut contract = contract_with_a_sold_ticket();
    call_as(VERIFIER, 1, ENDS);
    contract.attest_completed(1, None);
    assert_ticket_shows(
        &contract,
        "The event was confirmed and the price went to the organizer.",
        [
            "Active",
            "ReleasedToOrganizer",
            "Completed",
            "Released to the organizer",
        ],
    );
}

/// Every view of a ticket carries the same derived metadata.
#[test]
fn enumeration_views_carry_the_same_metadata() {
    use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
    let contract = contract_with_a_sold_ticket();
    let one = contract
        .nft_token("1-1".to_string())
        .expect("ticket exists")
        .metadata;
    assert!(one.is_some());
    let all = contract.nft_tokens(None, None);
    let mine = contract.nft_tokens_for_owner(id(ANA), None, None);
    assert_eq!(all.len(), 1);
    assert_eq!(mine.len(), 1);
    assert_eq!(all[0].metadata, one);
    assert_eq!(mine[0].metadata, one);
}

/// The drawn ticket stays under 2 KB for the largest facts the contract accepts, and markup in the
/// title or the symbol is escaped, never drawn. The worst amount is the largest principal with the
/// most decimals and the longest symbol made of the character with the longest escape (`"` or `'`,
/// 6 bytes each).
#[test]
fn the_drawn_ticket_is_small_and_escaped_in_the_worst_case() {
    use crate::currency::{MAX_DECIMALS, MAX_SYMBOL_BYTES, Unit};
    let contract = contract_with_a_sold_ticket();
    let mut event = contract.load_event(1);
    event.capacity = MAX_CAPACITY;
    let mut ticket = contract.load_ticket(&"1-1".to_string());
    ticket.serial = MAX_CAPACITY;
    ticket.principal = u128::MAX;
    // The longest title of the character with the longest escape, then one of every kind.
    let titles = [
        "\"".repeat(MAX_TITLE_BYTES as usize),
        "\"<&>'\u{1}".repeat(20),
    ];
    let mut largest = 0;
    for (quote, escape) in [("\"", "&quot;"), ("'", "&apos;")] {
        let symbol = quote.repeat(MAX_SYMBOL_BYTES);
        let unit = Unit {
            symbol: &symbol,
            decimals: MAX_DECIMALS,
        };
        let amount = format!(
            ">340282366920938.463463374607431768211455 {}<",
            escape.repeat(MAX_SYMBOL_BYTES)
        );
        for title in &titles {
            event.title = title.clone();
            for outcome in [Outcome::Unresolved, Outcome::Completed, Outcome::Refundable] {
                event.outcome = outcome;
                let metadata = display::token_metadata(&event, &ticket, unit);
                let svg = decode_svg(metadata.media.as_deref().expect("a drawn ticket"));
                assert!(svg.len() <= display::MAX_SVG_BYTES, "{} bytes", svg.len());
                largest = largest.max(svg.len());
                assert!(
                    svg.contains(&amount),
                    "the amount is not drawn escaped: {svg}"
                );
                assert!(!svg.contains("\"\"") && !svg.contains("''"), "{svg}");
                assert!(!svg.contains("<<") && !svg.contains("<&") && !svg.contains('\u{1}'));
                assert!(svg.contains('…'), "a long title is cut: {svg}");
            }
        }
        assert!(svg_of(&event, &ticket, unit).contains("&quot;&lt;&amp;&gt;&apos; "));
    }
    // The bound is not close: the worst ticket is under half of it.
    eprintln!("largest drawn ticket: {largest} bytes");
    assert!(largest * 2 <= display::MAX_SVG_BYTES, "{largest} bytes");
}

/// The drawn ticket of `ticket` in `event`, decoded.
fn svg_of(event: &EventRecord, ticket: &Ticket, unit: crate::currency::Unit<'_>) -> String {
    decode_svg(
        display::token_metadata(event, ticket, unit)
            .media
            .as_deref()
            .expect("a drawn ticket"),
    )
}

#[test]
fn a_token_amount_is_written_in_the_token_unit() {
    use crate::currency::Unit;
    let contract = contract_with_a_sold_ticket();
    let mut event = contract.load_event(1);
    event.currency = Some(id("tusd.near"));
    let mut ticket = contract.load_ticket(&"1-1".to_string());
    ticket.principal = 10_000_000;
    let unit = Unit {
        symbol: "tUSD",
        decimals: 6,
    };
    let metadata = display::token_metadata(&event, &ticket, unit);
    let description = metadata.description.expect("a description");
    assert!(
        description.ends_with("10 tUSD is reserved in the contract until the event is resolved."),
        "{description}"
    );
    let extra = metadata.extra.expect("extra");
    assert!(
        extra.ends_with("\"principal\":\"10000000\",\"currency\":\"tusd.near\"}"),
        "{extra}"
    );
    let svg = decode_svg(metadata.media.as_deref().expect("a drawn ticket"));
    assert!(svg.contains(">10 tUSD<"), "{svg}");
}

const TOKEN: &str = "tusd.near";
const OTHER_TOKEN: &str = "teur.near";
/// 10 tUSD at 6 decimals.
const TOKEN_PRICE: u128 = 10_000_000;

fn token(account: &str, symbol: &str) -> TokenSpec {
    TokenSpec {
        account_id: id(account),
        symbol: symbol.to_string(),
        decimals: 6,
    }
}

fn token_terms() -> EventTerms {
    EventTerms {
        price: U128(TOKEN_PRICE),
        currency: Some(id(TOKEN)),
        ..terms()
    }
}

fn purchase_msg(event_id: u32) -> String {
    format!("{{\"event_id\":{event_id}}}")
}

/// A contract listing tUSD and tEUR, with event 1 priced in tUSD and accepted, and ticket "1-1"
/// bought by Ana through the token at time 1_500_000.
fn contract_with_a_token_ticket() -> Contract {
    call_as(ESCROW, 0, 1_000_000);
    let mut contract = Contract::new(vec![token(TOKEN, "tUSD"), token(OTHER_TOKEN, "tEUR")]);
    call_as(ORGANIZER, quote_event_budget(3), 1_000_000);
    let event_id = contract.create_event(token_terms());
    let hash = contract
        .get_event(event_id)
        .expect("event exists")
        .terms_hash;
    call_as(VERIFIER, 1, 1_000_000);
    contract.accept_verification(event_id, hash);
    call_as(TOKEN, 0, 1_500_000);
    let kept = contract.ft_on_transfer(id(ANA), U128(TOKEN_PRICE), purchase_msg(event_id));
    assert_eq!(kept, U128(0), "the whole amount is kept");
    contract
}

#[test]
fn a_token_purchase_mints_to_the_sender_and_keeps_the_whole_amount() {
    let contract = contract_with_a_token_ticket();
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.owner_id, id(ANA));
    assert_eq!(ticket.principal.0, TOKEN_PRICE);
    assert_eq!(ticket.currency, Some(id(TOKEN)));
    assert_eq!(ticket.claim, Claim::Reserved);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.currency, Some(id(TOKEN)));
    assert_eq!(accounting.principal_received.0, TOKEN_PRICE);
    assert_eq!(accounting.principal_reserved.0, TOKEN_PRICE);
    assert_eq!(contract.total_held, 0, "a token event holds no NEAR");
    assert_identity_of(&contract, 1);
    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter().any(|line| line.contains("\"ticket_purchased\"")
            && line.contains("\"currency\":\"tusd.near\"")),
        "{logs:?}"
    );
    let description = contract
        .nft_token("1-1".to_string())
        .and_then(|token| token.metadata)
        .and_then(|metadata| metadata.description)
        .expect("a description");
    assert!(
        description.ends_with("10 tUSD is reserved in the contract until the event is resolved.")
    );
}

fn assert_identity_of(contract: &Contract, event_id: u32) {
    let ledger = &contract.load_event(event_id).ledger;
    assert!(ledger.identity_holds(), "{ledger:?}");
}

/// Every wrong payment panics, so the token gives the buyer the whole amount back, and leaves
/// nothing behind: the mocked host keeps writes made before a panic, so an early write shows here.
#[test]
fn ft_on_transfer_rejects_every_wrong_payment_before_any_change() {
    let mut contract = contract_with_a_token_ticket();
    // A NEAR event, accepted, for the token-to-NEAR-event case.
    call_as(ORGANIZER, quote_event_budget(3), 1_500_000);
    let near_event = contract.create_event(terms());
    let hash = contract.get_event(near_event).expect("exists").terms_hash;
    call_as(VERIFIER, 1, 1_500_000);
    contract.accept_verification(near_event, hash);

    let mut pay = |caller: &str, amount: u128, msg: &str, now_ms: u64, code: &str| {
        call_as(caller, 0, now_ms);
        fails_with(code, || {
            contract.ft_on_transfer(id(LUIS), U128(amount), msg.to_string());
        });
    };
    let msg = purchase_msg(1);
    // The caller is not a listed token, or not this event's token.
    pay(
        "mallory.near",
        TOKEN_PRICE,
        &msg,
        1_600_000,
        "ERR_WRONG_CURRENCY",
    );
    pay(ANA, TOKEN_PRICE, &msg, 1_600_000, "ERR_WRONG_CURRENCY");
    pay(
        OTHER_TOKEN,
        TOKEN_PRICE,
        &msg,
        1_600_000,
        "ERR_WRONG_CURRENCY",
    );
    // A token sent to an event priced in NEAR.
    let near_msg = purchase_msg(near_event);
    pay(TOKEN, PRICE, &near_msg, 1_600_000, "ERR_WRONG_CURRENCY");
    // A message that is not exactly {"event_id":<id>}.
    for bad in [
        "",
        "1",
        "not json",
        "{\"event_id\":\"1\"}",
        "{\"event_id\":1,\"to\":\"x\"}",
        "{}",
    ] {
        pay(TOKEN, TOKEN_PRICE, bad, 1_600_000, "ERR_BAD_MESSAGE");
    }
    pay(
        TOKEN,
        TOKEN_PRICE,
        &" ".repeat(1_025),
        1_600_000,
        "ERR_LIMIT",
    );
    pay(
        TOKEN,
        TOKEN_PRICE,
        &purchase_msg(99),
        1_600_000,
        "ERR_NOT_FOUND",
    );
    // Not exactly the price.
    pay(TOKEN, TOKEN_PRICE - 1, &msg, 1_600_000, "ERR_WRONG_DEPOSIT");
    pay(TOKEN, TOKEN_PRICE + 1, &msg, 1_600_000, "ERR_WRONG_DEPOSIT");
    // Rule R4 holds for tokens too: not at the start.
    pay(TOKEN, TOKEN_PRICE, &msg, STARTS, "ERR_TOO_LATE");

    // NEAR attached to `buy_ticket` cannot buy a ticket priced in a token.
    call_as(LUIS, TOKEN_PRICE, 1_600_000);
    fails_with("ERR_WRONG_CURRENCY", || {
        contract.buy_ticket(1);
    });

    let event = contract.get_event(1).expect("event exists");
    assert_eq!(event.sold, 1);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.principal_received.0, TOKEN_PRICE);
    assert!(contract.get_ticket("1-2".to_string()).is_none());
    assert_eq!(contract.get_event(near_event).expect("exists").sold, 0);
    assert_eq!(contract.total_held, 0);
}

#[test]
fn token_tickets_sell_out_like_near_tickets() {
    let mut contract = contract_with_a_token_ticket();
    for buyer in [LUIS, ANA] {
        call_as(TOKEN, 0, 1_600_000);
        contract.ft_on_transfer(id(buyer), U128(TOKEN_PRICE), purchase_msg(1));
    }
    call_as(TOKEN, 0, 1_600_000);
    fails_with("ERR_SOLD_OUT", || {
        contract.ft_on_transfer(id(LUIS), U128(TOKEN_PRICE), purchase_msg(1));
    });
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.principal_reserved.0, 3 * TOKEN_PRICE);
    assert_identity_of(&contract, 1);
}

#[test]
fn create_event_accepts_only_a_listed_currency() {
    call_as(ESCROW, 0, 1_000_000);
    let mut contract = Contract::new(vec![token(TOKEN, "tUSD")]);
    call_as(ORGANIZER, quote_event_budget(3), 1_000_000);
    fails_with("ERR_INVALID_TERMS", || {
        contract.create_event(EventTerms {
            currency: Some(id(OTHER_TOKEN)),
            ..token_terms()
        });
    });
    assert!(contract.get_event(1).is_none());
    call_as(ORGANIZER, quote_event_budget(3), 1_000_000);
    assert_eq!(contract.create_event(token_terms()), 1);
    let event = contract.get_event(1).expect("event exists");
    assert_eq!(event.currency, Some(id(TOKEN)));
    assert_eq!(contract.get_config().tokens, vec![token(TOKEN, "tUSD")]);
}

#[test]
fn new_rejects_a_bad_token_list() {
    let tokens = |n: usize| -> Vec<TokenSpec> {
        (0..n)
            .map(|i| token(&format!("token{i}.near"), &format!("T{i}")))
            .collect()
    };
    let rejects = |code: &str, list: Vec<TokenSpec>| {
        call_as(ESCROW, 0, 1);
        fails_with(code, || {
            Contract::new(list);
        });
    };
    rejects("ERR_LIMIT", tokens(5));
    let with = |edit: fn(&mut TokenSpec)| {
        let mut list = tokens(2);
        edit(&mut list[1]);
        list
    };
    rejects("ERR_INVALID_TERMS", with(|t| t.symbol = String::new()));
    rejects("ERR_INVALID_TERMS", with(|t| t.symbol = "T".repeat(13)));
    rejects(
        "ERR_INVALID_TERMS",
        with(|t| t.symbol = "t USD".to_string()),
    );
    rejects(
        "ERR_INVALID_TERMS",
        with(|t| t.symbol = "tUSD\n".to_string()),
    );
    rejects("ERR_INVALID_TERMS", with(|t| t.symbol = "near".to_string()));
    rejects("ERR_INVALID_TERMS", with(|t| t.decimals = 25));
    rejects("ERR_INVALID_TERMS", with(|t| t.account_id = id(ESCROW)));
    rejects(
        "ERR_INVALID_TERMS",
        with(|t| t.account_id = id("token0.near")),
    );
    rejects("ERR_INVALID_TERMS", with(|t| t.symbol = "t0".to_string()));

    // At the limits it is accepted.
    let mut list = tokens(4);
    list[0].symbol = "T".repeat(12);
    list[1].decimals = 24;
    list[2].decimals = 0;
    call_as(ESCROW, 0, 1);
    assert_eq!(Contract::new(list.clone()).get_config().tokens, list);
}

/// Ana's token ticket after the organizer cancelled and she claimed: a refund in flight.
fn contract_with_a_pending_token_refund() -> Contract {
    let mut contract = contract_with_a_token_ticket();
    call_as(ORGANIZER, 1, 1_600_000);
    contract.cancel_event(1, None);
    call_with_gas(ANA, 1, 1_700_000, 100);
    let _ = contract.claim_refund("1-1".to_string());
    contract
}

/// The function call that pays a token, as the last call created it, and the callback after it.
struct TokenPayment {
    token: String,
    method: String,
    args: near_sdk::serde_json::Value,
    deposit: u128,
    gas: near_sdk::Gas,
    /// The share of unused gas the token gets.
    weight: u64,
    callback: String,
}

/// The receipts the last call created: the payment, then the callback on the escrow.
fn token_payment() -> TokenPayment {
    use near_sdk::mock::MockAction;
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts.len(), 2, "a payment and its callback");
    let MockAction::FunctionCallWeight {
        method_name,
        args,
        attached_deposit,
        prepaid_gas,
        gas_weight,
        ..
    } = &receipts[0].actions[0]
    else {
        panic!("the payment is a function call: {:?}", receipts[0].actions)
    };
    let MockAction::FunctionCallWeight {
        method_name: callback,
        ..
    } = &receipts[1].actions[0]
    else {
        panic!("the callback is a function call")
    };
    assert_eq!(receipts[1].receiver_id, id(ESCROW));
    TokenPayment {
        token: receipts[0].receiver_id.to_string(),
        method: String::from_utf8(method_name.clone()).expect("UTF-8"),
        args: near_sdk::serde_json::from_slice(args).expect("JSON arguments"),
        deposit: attached_deposit.as_yoctonear(),
        gas: *prepaid_gas,
        weight: gas_weight.0,
        callback: String::from_utf8(callback.clone()).expect("UTF-8"),
    }
}

#[test]
fn a_token_refund_is_an_ft_transfer_of_the_principal_with_one_yocto() {
    let contract = contract_with_a_pending_token_refund();
    let payment = token_payment();
    assert_eq!(payment.token, TOKEN);
    assert_eq!(payment.method, "ft_transfer");
    let amount = TOKEN_PRICE.to_string();
    let expected =
        near_sdk::serde_json::json!({ "receiver_id": ANA, "amount": amount, "memo": null });
    assert_eq!(payment.args, expected);
    assert_eq!(payment.deposit, 1);
    assert_eq!(payment.gas, GAS_FT_TRANSFER);
    assert_eq!(
        payment.weight,
        near_sdk::GasWeight::default().0,
        "the token gets the default share of unused gas on top of GAS_FT_TRANSFER"
    );
    assert!(payment.weight > 0);
    assert_eq!(payment.callback, "on_refund_result");

    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::RefundPending);
    let operation = contract.get_operation(1).expect("in flight");
    assert_eq!(operation.currency, Some(id(TOKEN)));
    assert_eq!(operation.amount.0, TOKEN_PRICE);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.refund_pending.0, TOKEN_PRICE);
    assert_eq!(accounting.principal_reserved.0, 0);
    assert_eq!(contract.total_held, 0);
    assert_identity_of(&contract, 1);
}

#[test]
fn a_failed_token_refund_gives_the_right_back_once_and_a_second_claim_pays() {
    let mut contract = contract_with_a_pending_token_refund();
    as_callback();
    assert!(!contract.on_refund_result(1, Err(near_sdk::PromiseError::Failed)));
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::Active);
    assert_eq!(ticket.claim, Claim::Refundable);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.principal_reserved.0, TOKEN_PRICE);
    assert_eq!(accounting.refund_pending.0, 0);
    assert_eq!(contract.total_held, 0, "the NEAR total never counted it");
    assert_identity_of(&contract, 1);
    // The same callback again finds nothing.
    as_callback();
    assert!(!contract.on_refund_result(1, Err(near_sdk::PromiseError::Failed)));
    assert_eq!(
        contract
            .get_accounting(1)
            .expect("exists")
            .principal_reserved
            .0,
        TOKEN_PRICE
    );

    // Once the holder can receive the token, a second claim pays.
    call_with_gas(ANA, 1, 1_800_000, 100);
    let _ = contract.claim_refund("1-1".to_string());
    as_callback();
    assert!(contract.on_refund_result(2, Ok(())));
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::Refunded);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.refunds_settled.0, TOKEN_PRICE);
    assert_eq!(accounting.principal_reserved.0, 0);
    assert_identity_of(&contract, 1);
}

#[test]
fn a_token_payout_goes_to_the_organizer_and_its_failure_restores_it() {
    let mut contract = contract_with_a_token_ticket();
    call_as(VERIFIER, 1, ENDS);
    contract.attest_completed(1, None);
    call_with_gas(ORGANIZER, 1, ENDS + 1, 100);
    let _ = contract.claim_payout(1);
    let payment = token_payment();
    assert_eq!(payment.token, TOKEN);
    assert_eq!(payment.method, "ft_transfer");
    assert_eq!(payment.args["receiver_id"], ORGANIZER);
    assert_eq!(payment.args["amount"], TOKEN_PRICE.to_string());
    assert_eq!((payment.deposit, payment.gas), (1, GAS_FT_TRANSFER));
    assert_eq!(payment.weight, near_sdk::GasWeight::default().0);
    assert_eq!(payment.callback, "on_payout_result");
    assert_eq!(contract.total_held, 0);

    as_callback();
    assert!(!contract.on_payout_result(1, Err(near_sdk::PromiseError::Failed)));
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.organizer_available.0, TOKEN_PRICE);
    assert_eq!(accounting.organizer_pending.0, 0);
    assert_eq!(contract.total_held, 0);
    assert_identity_of(&contract, 1);

    call_with_gas(ORGANIZER, 1, ENDS + 2, 100);
    let _ = contract.claim_payout(1);
    as_callback();
    assert!(contract.on_payout_result(2, Ok(())));
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.organizer_settled.0, TOKEN_PRICE);
    assert_identity_of(&contract, 1);
}

/// A token claim reserves gas for the token and the callback, so it asks for more than a NEAR
/// claim, and below that it changes nothing.
#[test]
fn a_token_claim_needs_its_own_minimum_gas() {
    let mut contract = contract_with_a_token_ticket();
    call_as(ORGANIZER, 1, 1_600_000);
    contract.cancel_event(1, None);
    call_with_gas(ANA, 1, 1_700_000, GAS_TOKEN_CLAIM_MIN.as_tgas() - 1);
    fails_with("ERR_INSUFFICIENT_GAS", || {
        let _ = contract.claim_refund("1-1".to_string());
    });
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::Active);
    assert!(contract.get_operation(1).is_none());
    assert_eq!(
        contract
            .get_accounting(1)
            .expect("exists")
            .principal_reserved
            .0,
        TOKEN_PRICE
    );
    call_with_gas(ANA, 1, 1_700_000, GAS_TOKEN_CLAIM_MIN.as_tgas());
    let _ = contract.claim_refund("1-1".to_string());
    assert!(contract.get_operation(1).is_some());
}

/// The NEAR total counts NEAR events only, and a NEAR refund never waits for a token event.
#[test]
fn near_and_token_events_do_not_share_the_near_total() {
    let mut contract = contract_with_a_token_ticket();
    call_as(ORGANIZER, quote_event_budget(3), 1_500_000);
    let near_event = contract.create_event(terms());
    let hash = contract.get_event(near_event).expect("exists").terms_hash;
    call_as(VERIFIER, 1, 1_500_000);
    contract.accept_verification(near_event, hash);
    call_as(LUIS, PRICE, 1_500_000);
    assert_eq!(contract.buy_ticket(near_event), "2-1");
    assert_eq!(contract.total_held, PRICE);

    call_as(ORGANIZER, 1, 1_600_000);
    contract.cancel_event(near_event, None);
    call_as(ORGANIZER, 1, 1_600_000);
    contract.cancel_event(1, None);
    call_with_gas(LUIS, 1, 1_700_000, 100);
    let _ = contract.claim_refund("2-1".to_string());
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts[0].receiver_id, id(LUIS));
    assert!(
        matches!(
            receipts[0].actions[0],
            near_sdk::mock::MockAction::Transfer { .. }
        ),
        "a NEAR refund is a native transfer"
    );
    assert_eq!(contract.total_held, 0);
    call_with_gas(ANA, 1, 1_700_000, 100);
    let _ = contract.claim_refund("1-1".to_string());
    assert_eq!(contract.total_held, 0);
    assert_identity_of(&contract, 1);
    assert_identity_of(&contract, near_event);
}

/// A payment that succeeded but answered a value (a token whose `ft_transfer` returns something)
/// still moved the money: the callback settles it and never gives the right back, which would
/// let the holder claim and be paid a second time.
#[test]
fn a_payment_that_answered_a_value_still_settles() {
    let mut contract = contract_with_a_pending_token_refund();
    as_callback();
    assert!(contract.on_refund_result(1, Err(near_sdk::PromiseError::TooLong(5))));
    let ticket = contract
        .get_ticket("1-1".to_string())
        .expect("ticket exists");
    assert_eq!(ticket.status, TicketStatus::Refunded);
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.refunds_settled.0, TOKEN_PRICE);
    assert_eq!(accounting.principal_reserved.0, 0);
    assert_identity_of(&contract, 1);
}

/// The same rule for a payout (one contract per test: the mocked storage is per test thread).
#[test]
fn a_payout_that_answered_a_value_still_settles() {
    let mut contract = contract_with_a_token_ticket();
    call_as(VERIFIER, 1, ENDS);
    contract.attest_completed(1, None);
    call_with_gas(ORGANIZER, 1, ENDS + 1, 100);
    let _ = contract.claim_payout(1);
    as_callback();
    assert!(contract.on_payout_result(1, Err(near_sdk::PromiseError::TooLong(4_194_304))));
    let accounting = contract.get_accounting(1).expect("event exists");
    assert_eq!(accounting.organizer_settled.0, TOKEN_PRICE);
    assert_eq!(accounting.organizer_available.0, 0);
    assert_identity_of(&contract, 1);
}
