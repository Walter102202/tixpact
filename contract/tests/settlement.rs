//! Refunds and payouts in the sandbox (plan, Task C2): who is paid, how much, exactly once, and
//! what happens when a transfer or its callback fails.

mod common;

use common::{
    Cast, Escrow, GAS_FEE_BOUND, NEAR, NO_DEPOSIT, ONE_YOCTO, PRICE, TestChain, Transfer, amount,
    assert_fails_with, events_named, failed_receipts_on, faulty_escrow_wasm, receipt_failure_texts,
    terms, vanishing_holder_wasm,
};
use near_api::{Account, NearToken};
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

/// Gas for a call into a fixture that then calls the escrow, in Tgas.
const FIXTURE_TGAS: u64 = 300;
/// The margin of a forced liquidity shortfall: far below a ticket price, far above gas rewards.
const SHORTFALL: u128 = NEAR / 100;

/// An event accepted by its verifier, with start, end and deadline `offsets_s` seconds from now.
async fn accepted_event(
    escrow: &Escrow<'_>,
    cast: &Cast,
    offsets_s: [u64; 3],
    capacity: u32,
) -> TestResult<(u32, [u64; 3])> {
    let times = escrow.chain.times_from_now(offsets_s).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, capacity))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    Ok((event_id, times))
}

/// Makes a fixture call `method` on the escrow with `args`, as if it were a person.
async fn forward(
    escrow: &Escrow<'_>,
    fixture: &Account,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> TestResult<near_api::types::transaction::result::ExecutionFinalResult> {
    let args = json!({
        "receiver_id": escrow.id(),
        "method_name": method,
        "args": args.to_string(),
    });
    escrow
        .chain
        .call(fixture, &fixture.0, "forward", args, deposit, FIXTURE_TGAS)
        .await
}

/// Patches the escrow's balance to `missing` yoctoNEAR below what it owes plus its storage, and
/// returns the real balance to restore afterwards.
async fn force_shortfall(
    escrow: &Escrow<'_>,
    event_ids: &[u32],
    missing: u128,
) -> TestResult<u128> {
    let chain = escrow.chain;
    let real = chain.balance(&escrow.id()).await?;
    let storage = u128::from(chain.storage_usage(&escrow.id()).await?) * 10u128.pow(19);
    let owed = escrow.held(event_ids).await?;
    chain
        .set_balance(&escrow.id(), storage + owed - missing)
        .await?;
    Ok(real)
}

#[tokio::test]
async fn t03_organizer_cannot_withdraw_unresolved() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (event_id, times) = accepted_event(&escrow, &cast, [20, 30, 600], 3).await?;
    escrow.buy(&cast.ana, event_id, PRICE).await?;
    escrow.buy(&cast.luis, event_id, PRICE).await?;
    let before = chain.balance(&cast.organizer.0).await?;

    // Before the end.
    let result = escrow.claim_payout(&cast.organizer, event_id).await?;
    assert_fails_with(&result, "ERR_NOT_COMPLETED");
    // After the end, without attestation.
    chain.advance_to(times[1]).await?;
    let result = escrow.claim_payout(&cast.organizer, event_id).await?;
    assert_fails_with(&result, "ERR_NOT_COMPLETED");
    // Nobody else can claim it either.
    let result = escrow.claim_payout(&cast.mallory, event_id).await?;
    assert_fails_with(&result, "ERR_UNAUTHORIZED");

    let after = chain.balance(&cast.organizer.0).await?;
    assert!(
        before - after < 2 * GAS_FEE_BOUND,
        "the organizer only paid gas"
    );
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "principal_reserved"), 2 * PRICE);
    assert_eq!(amount(&accounting, "organizer_available"), 0);
    assert_eq!(amount(&accounting, "organizer_pending"), 0);
    Ok(())
}

#[tokio::test]
async fn t07_refund_follows_the_holder() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (event_id, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 3).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;
    escrow
        .transfer(&cast.ana, &cast.luis.0, &token_id)
        .await?
        .assert_success();
    escrow.cancel(&cast.organizer, event_id).await?;

    // Ana sold the ticket: the right went with it.
    let result = escrow.claim_refund(&cast.ana, &token_id, 100).await?;
    assert_fails_with(&result, "ERR_UNAUTHORIZED");

    let before = chain.balance(&cast.luis.0).await?;
    let result = escrow.claim_refund(&cast.luis, &token_id, 100).await?;
    let paid: bool = result.assert_success().json()?;
    assert!(paid);
    let received = chain.balance(&cast.luis.0).await? - before;
    assert!(
        received > PRICE - GAS_FEE_BOUND && received < PRICE,
        "Luis received the principal minus his gas: {received}"
    );
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["owner_id"], cast.luis.0.as_str());
    assert_eq!(ticket["status"], "Refunded");
    assert_eq!(ticket["claim"], "Refunded");
    assert_eq!(
        amount(&escrow.accounting(event_id).await?, "refunds_settled"),
        PRICE
    );
    Ok(())
}

#[tokio::test]
async fn t08_no_double_refund() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (event_id, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 3).await?;
    // The holder is a contract, so that two claims can leave in one receipt and reach the escrow
    // one right after the other, the second while the first transfer is in flight.
    let holder = chain
        .deploy_fixture("twice.sandbox", 20, vanishing_holder_wasm())
        .await?;
    let bought = forward(
        &escrow,
        &holder,
        "buy_ticket",
        json!({ "event_id": event_id }),
        NearToken::from_yoctonear(PRICE),
    )
    .await?;
    let token_id: String = bought.assert_success().json()?;
    escrow.cancel(&cast.organizer, event_id).await?;
    let before = chain.balance(&holder.0).await?;

    let args = json!({ "ticket_contract": escrow.id(), "token_id": token_id });
    let result = chain
        .call(
            &holder,
            &holder.0,
            "claim_twice",
            args,
            NO_DEPOSIT,
            FIXTURE_TGAS,
        )
        .await?;
    let failures = receipt_failure_texts(&result);
    assert_eq!(failures.len(), 1, "exactly one claim failed: {failures:?}");
    assert!(failures[0].contains("ERR_TICKET_LOCKED"), "{failures:?}");
    assert_eq!(events_named(&result, "refund_requested").len(), 1);
    assert_eq!(events_named(&result, "refund_settled").len(), 1);
    assert_eq!(
        chain.transfers_from(&result, &escrow.id()).await?,
        [Transfer {
            receiver: holder.0.to_string(),
            amount: PRICE,
            succeeded: true
        }],
        "one refund transfer"
    );

    // After settlement, a new claim finds the ticket refunded.
    let again = forward(
        &escrow,
        &holder,
        "claim_refund",
        json!({ "token_id": token_id }),
        ONE_YOCTO,
    )
    .await?;
    assert_fails_with(&again, "ERR_ALREADY_REFUNDED");

    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refunds_settled"), PRICE);
    assert_eq!(amount(&accounting, "refund_pending"), 0);
    assert_eq!(amount(&accounting, "principal_reserved"), 0);
    let received = chain.balance(&holder.0).await? - before;
    assert!(
        received > PRICE - GAS_FEE_BOUND && received < PRICE + GAS_FEE_BOUND,
        "the principal arrived once: {received}"
    );
    Ok(())
}

#[tokio::test]
async fn t09_refund_pays_exact_principal() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (event_id, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 3).await?;
    let token_id = escrow.buy(&cast.luis, event_id, PRICE).await?;
    escrow.cancel(&cast.verifier, event_id).await?;

    let before = chain.balance(&cast.luis.0).await?;
    let result = escrow.claim_refund(&cast.luis, &token_id, 100).await?;
    let requested = events_named(&result, "refund_requested");
    let settled = events_named(&result, "refund_settled");
    result.assert_success();
    let received = chain.balance(&cast.luis.0).await? - before;
    assert!(
        received > PRICE - GAS_FEE_BOUND && received < PRICE,
        "Luis received P minus his own gas: {received}"
    );

    assert_eq!(requested.len(), 1);
    assert_eq!(settled.len(), 1);
    let data = &settled[0]["data"][0];
    assert_eq!(settled[0]["standard"], "ticket_escrow");
    assert_eq!(data["amount"], PRICE.to_string());
    assert_eq!(data["recipient_id"], cast.luis.0.as_str());
    assert_eq!(data["token_id"], token_id.as_str());
    let operation_id = data["operation_id"].as_u64().ok_or("no operation id")?;

    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refund_pending"), 0);
    assert_eq!(amount(&accounting, "refunds_settled"), PRICE);
    assert_eq!(amount(&accounting, "principal_reserved"), 0);
    assert_eq!(escrow.operation(operation_id).await?, Value::Null);
    let history = escrow.history(&token_id).await?;
    let kinds: Vec<&str> = history["entries"]
        .as_array()
        .ok_or("no entries")?
        .iter()
        .filter_map(|entry| entry["kind"].as_str())
        .collect();
    assert_eq!(kinds, ["Purchased", "RefundRequested", "RefundSettled"]);
    Ok(())
}

#[tokio::test]
async fn t10_failed_transfer_restores_claim_once() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (event_id, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 3).await?;
    let holder = chain
        .deploy_fixture("vanish.sandbox", 20, vanishing_holder_wasm())
        .await?;
    let bought = forward(
        &escrow,
        &holder,
        "buy_ticket",
        json!({ "event_id": event_id }),
        NearToken::from_yoctonear(PRICE),
    )
    .await?;
    let token_id: String = bought.assert_success().json()?;
    escrow.cancel(&cast.organizer, event_id).await?;

    // The holder claims and deletes its own account in the same receipt.
    let args = json!({
        "ticket_contract": escrow.id(),
        "token_id": token_id,
        "beneficiary": cast.mallory.0,
    });
    let result = chain
        .call(
            &holder,
            &holder.0,
            "claim_and_vanish",
            args,
            NO_DEPOSIT,
            FIXTURE_TGAS,
        )
        .await?;
    assert!(!chain.exists(&holder.0).await, "the holder deleted itself");
    assert_eq!(
        chain.transfers_from(&result, &escrow.id()).await?,
        [Transfer {
            receiver: holder.0.to_string(),
            amount: PRICE,
            succeeded: false
        }],
        "the refund transfer failed"
    );
    assert_eq!(events_named(&result, "refund_requested").len(), 1);
    assert_eq!(
        events_named(&result, "refund_failed").len(),
        1,
        "logged once"
    );
    assert!(events_named(&result, "refund_settled").is_empty());

    // The right is back, exactly once.
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["status"], "Active");
    assert_eq!(ticket["pending_operation_id"], Value::Null);
    assert_eq!(ticket["claim"], "Refundable");
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "principal_reserved"), PRICE);
    assert_eq!(amount(&accounting, "refund_pending"), 0);
    assert_eq!(amount(&accounting, "refunds_settled"), 0);
    let history = escrow.history(&token_id).await?;
    let entries = history["entries"].as_array().ok_or("no entries")?;
    assert_eq!(
        entries.last().ok_or("empty history")?["kind"],
        "RefundFailed"
    );
    Ok(())
}

#[tokio::test]
async fn t11_failed_callback_keeps_pending() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain
        .escrow_with("faulty.sandbox", faulty_escrow_wasm())
        .await?;
    let config: Value = escrow.view("get_config", json!({})).await?;
    assert_eq!(config["fault_injection"], true);
    let cast = chain.cast().await?;
    let (event_id, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 3).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;
    escrow.cancel(&cast.organizer, event_id).await?;

    let before = chain.balance(&cast.ana.0).await?;
    let first = escrow.claim_refund(&cast.ana, &token_id, 100).await?;
    assert_eq!(
        chain.transfers_from(&first, &escrow.id()).await?,
        [Transfer {
            receiver: cast.ana.0.to_string(),
            amount: PRICE,
            succeeded: true
        }],
        "the transfer ran"
    );
    assert_eq!(
        failed_receipts_on(&first, &escrow.id()),
        1,
        "the callback failed"
    );
    assert_eq!(events_named(&first, "refund_requested").len(), 1);
    assert!(events_named(&first, "refund_settled").is_empty());
    assert!(events_named(&first, "refund_failed").is_empty());
    let received = chain.balance(&cast.ana.0).await? - before;
    assert!(received > PRICE - GAS_FEE_BOUND && received < PRICE);

    // The record stays pending: the holder was paid, nothing restores the right.
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["status"], "RefundPending");
    assert_eq!(ticket["claim"], "RefundPending");
    let operation_id = ticket["pending_operation_id"]
        .as_u64()
        .ok_or("no operation")?;
    let operation = escrow.operation(operation_id).await?;
    assert_eq!(operation["kind"], "Refund");
    assert_eq!(operation["amount"], PRICE.to_string());
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refund_pending"), PRICE);
    assert_eq!(amount(&accounting, "principal_reserved"), 0);

    // A new claim is locked out and sends nothing.
    let second = escrow.claim_refund(&cast.ana, &token_id, 100).await?;
    assert_fails_with(&second, "ERR_TICKET_LOCKED");
    assert!(
        chain
            .transfers_from(&second, &escrow.id())
            .await?
            .is_empty(),
        "no second transfer"
    );
    let after_second = chain.balance(&cast.ana.0).await? - before;
    assert!(after_second <= received, "nothing was paid twice");
    Ok(())
}

#[tokio::test]
async fn t14_callbacks_are_private() -> TestResult {
    // A refund left pending by the fault-injection build gives the callbacks something real to
    // corrupt, and the transfer resolver a ticket to move: called directly with Ana as the
    // receiver and Mallory as the previous owner, it would "send back" Ana's ticket to Mallory.
    // Nobody can call them: not a stranger, not the holder, not the organizer, and not even a
    // transaction signed with the escrow's own key, which has no promise result to give.
    let chain = TestChain::start().await?;
    let escrow = chain
        .escrow_with("faulty.sandbox", faulty_escrow_wasm())
        .await?;
    let cast = chain.cast().await?;
    let (event_id, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 3).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;
    escrow.cancel(&cast.organizer, event_id).await?;
    let _ = escrow.claim_refund(&cast.ana, &token_id, 100).await?;
    let ticket_before = escrow.ticket(&token_id).await?;
    let operation_id = ticket_before["pending_operation_id"]
        .as_u64()
        .ok_or("no pending operation")?;
    let operation_before = escrow.operation(operation_id).await?;
    let accounting_before = escrow.accounting(event_id).await?;
    let history_before = escrow.history(&token_id).await?;

    let itself = Account(escrow.id());
    let operation = json!({ "operation_id": operation_id });
    let resolve = json!({
        "previous_owner_id": cast.mallory.0,
        "receiver_id": cast.ana.0,
        "token_id": token_id,
        "approved_account_ids": null,
    });
    let callbacks = [
        ("on_refund_result", &operation),
        ("on_payout_result", &operation),
        ("nft_resolve_transfer", &resolve),
    ];
    for caller in [&cast.mallory, &cast.ana, &cast.organizer, &itself] {
        for (callback, args) in callbacks {
            let result = escrow
                .call(caller, callback, args.clone(), NO_DEPOSIT, 100)
                .await?;
            let failure = common::failure_text(&result)
                .unwrap_or_else(|| panic!("{callback} by {} succeeded", caller.0));
            if caller.0 != escrow.id() {
                assert!(failure.contains("is private"), "{failure}");
            }
        }
    }

    assert_eq!(escrow.ticket(&token_id).await?, ticket_before);
    assert_eq!(escrow.history(&token_id).await?, history_before);
    assert_eq!(escrow.operation(operation_id).await?, operation_before);
    assert_eq!(escrow.accounting(event_id).await?, accounting_before);
    Ok(())
}

#[tokio::test]
async fn t18_payout_failure_paths() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;

    // An organizer that deletes itself while collecting: the payout transfer fails.
    let organizer = chain
        .deploy_fixture("vorg.sandbox", 20, vanishing_holder_wasm())
        .await?;
    let times = chain.times_from_now([20, 30, 600]).await?;
    let quote = NearToken::from_yoctonear(escrow.quote(2).await?);
    let created = forward(
        &escrow,
        &organizer,
        "create_event",
        json!({ "terms": terms(&cast.verifier, times, 2) }),
        quote,
    )
    .await?;
    let event_id: u32 = created.assert_success().json()?;
    escrow.accept(&cast.verifier, event_id).await?;
    escrow.buy(&cast.ana, event_id, PRICE).await?;
    chain.advance_to(times[1]).await?;
    escrow.attest(&cast.verifier, event_id).await?;

    let args = json!({ "ticket_contract": escrow.id(), "event_id": event_id, "beneficiary": cast.mallory.0 });
    let result = chain
        .call(
            &organizer,
            &organizer.0,
            "collect_and_vanish",
            args,
            NO_DEPOSIT,
            FIXTURE_TGAS,
        )
        .await?;
    assert!(!chain.exists(&organizer.0).await);
    assert_eq!(
        chain.transfers_from(&result, &escrow.id()).await?,
        [Transfer {
            receiver: organizer.0.to_string(),
            amount: PRICE,
            succeeded: false
        }],
        "the payout transfer failed"
    );
    assert_eq!(events_named(&result, "payout_requested").len(), 1);
    assert_eq!(
        events_named(&result, "payout_failed").len(),
        1,
        "restored once"
    );
    assert!(events_named(&result, "payout_settled").is_empty());
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "organizer_available"), PRICE);
    assert_eq!(amount(&accounting, "organizer_pending"), 0);
    assert_eq!(amount(&accounting, "organizer_settled"), 0);

    // Fault-injection build: the payout arrives but its callback fails.
    let faulty = chain
        .escrow_with("faulty.sandbox", faulty_escrow_wasm())
        .await?;
    let (event_id, times) = accepted_event(&faulty, &cast, [20, 30, 600], 2).await?;
    faulty.buy(&cast.luis, event_id, PRICE).await?;
    chain.advance_to(times[1]).await?;
    faulty.attest(&cast.verifier, event_id).await?;

    let before = chain.balance(&cast.organizer.0).await?;
    let first = faulty.claim_payout(&cast.organizer, event_id).await?;
    assert_eq!(
        chain.transfers_from(&first, &faulty.id()).await?,
        [Transfer {
            receiver: cast.organizer.0.to_string(),
            amount: PRICE,
            succeeded: true
        }],
        "the payout ran"
    );
    assert_eq!(
        failed_receipts_on(&first, &faulty.id()),
        1,
        "its callback failed"
    );
    let received = chain.balance(&cast.organizer.0).await? - before;
    assert!(received > PRICE - GAS_FEE_BOUND && received < PRICE);
    let accounting = faulty.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "organizer_pending"), PRICE);
    assert_eq!(amount(&accounting, "organizer_available"), 0);
    let operation_id = events_named(&first, "payout_requested")[0]["data"][0]["operation_id"]
        .as_u64()
        .ok_or("no operation id")?;
    let operation = faulty.operation(operation_id).await?;
    assert_eq!(operation["kind"], "Payout");
    assert_eq!(operation["token_id"], Value::Null);
    assert_eq!(operation["recipient_id"], cast.organizer.0.as_str());

    let second = faulty.claim_payout(&cast.organizer, event_id).await?;
    assert_fails_with(&second, "ERR_PAYOUT_PENDING");
    assert!(
        chain
            .transfers_from(&second, &faulty.id())
            .await?
            .is_empty(),
        "no second transfer"
    );
    Ok(())
}

#[tokio::test]
async fn t19_events_do_not_share_money() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (a, times) = accepted_event(&escrow, &cast, [20, 30, 600], 2).await?;
    let (b, _) = accepted_event(&escrow, &cast, [20, 30, 600], 3).await?;
    escrow.buy(&cast.ana, a, PRICE).await?;
    let luis_ticket = escrow.buy(&cast.luis, b, PRICE).await?;
    let mallory_ticket = escrow.buy(&cast.mallory, b, PRICE).await?;
    escrow.cancel(&cast.organizer, b).await?;
    chain.advance_to(times[1]).await?;
    escrow.attest(&cast.verifier, a).await?;

    // A forced shortfall: the balance covers storage and everything owed, minus a little.
    // Neither A's payout nor B's refund may be paid out of the other's money.
    let real = force_shortfall(&escrow, &[a, b], SHORTFALL).await?;
    let result = escrow.claim_payout(&cast.organizer, a).await?;
    assert_fails_with(&result, "ERR_INSUFFICIENT_LIQUIDITY");
    let result = escrow.claim_refund(&cast.luis, &luis_ticket, 100).await?;
    assert_fails_with(&result, "ERR_INSUFFICIENT_LIQUIDITY");
    let accounting_a = escrow.accounting(a).await?;
    assert_eq!(amount(&accounting_a, "organizer_available"), PRICE);
    assert_eq!(amount(&accounting_a, "organizer_pending"), 0);
    assert_eq!(escrow.ticket(&luis_ticket).await?["status"], "Active");

    // With the balance whole, A is paid out and every B holder is refunded in full.
    chain.set_balance(&escrow.id(), real).await?;
    let before = chain.balance(&cast.organizer.0).await?;
    escrow
        .claim_payout(&cast.organizer, a)
        .await?
        .assert_success();
    let paid = chain.balance(&cast.organizer.0).await? - before;
    assert!(paid > PRICE - GAS_FEE_BOUND && paid < PRICE);
    for (holder, ticket) in [(&cast.luis, &luis_ticket), (&cast.mallory, &mallory_ticket)] {
        let before = chain.balance(&holder.0).await?;
        let refunded: bool = escrow
            .claim_refund(holder, ticket, 100)
            .await?
            .assert_success()
            .json()?;
        assert!(refunded);
        let received = chain.balance(&holder.0).await? - before;
        assert!(received > PRICE - GAS_FEE_BOUND && received < PRICE);
    }
    let accounting_a = escrow.accounting(a).await?;
    assert_eq!(amount(&accounting_a, "organizer_settled"), PRICE);
    let accounting_b = escrow.accounting(b).await?;
    assert_eq!(amount(&accounting_b, "refunds_settled"), 2 * PRICE);
    assert_eq!(amount(&accounting_b, "principal_reserved"), 0);
    assert_eq!(amount(&accounting_b, "organizer_settled"), 0);
    Ok(())
}

#[tokio::test]
async fn t24_restored_claim_waits_for_liquidity() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (a, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 2).await?;
    let (b, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 2).await?;
    let holder = chain
        .deploy_fixture("vanish.sandbox", 20, vanishing_holder_wasm())
        .await?;
    let bought = forward(
        &escrow,
        &holder,
        "buy_ticket",
        json!({ "event_id": a }),
        NearToken::from_yoctonear(PRICE),
    )
    .await?;
    let token_id: String = bought.assert_success().json()?;
    escrow.buy(&cast.luis, b, PRICE).await?;
    escrow.cancel(&cast.organizer, a).await?;

    // The transfer fails; the right is restored at once.
    let args = json!({ "ticket_contract": escrow.id(), "token_id": token_id, "beneficiary": cast.mallory.0 });
    let result = chain
        .call(
            &holder,
            &holder.0,
            "claim_and_vanish",
            args,
            NO_DEPOSIT,
            FIXTURE_TGAS,
        )
        .await?;
    assert_eq!(events_named(&result, "refund_failed").len(), 1);
    assert_eq!(escrow.ticket(&token_id).await?["status"], "Active");
    assert_eq!(
        amount(&escrow.accounting(a).await?, "principal_reserved"),
        PRICE
    );

    // Whoever controls the name recreates the account; it still holds the ticket.
    let holder = chain.accounts(&["vanish.sandbox"], 5).await?.remove(0);
    assert_eq!(
        escrow.ticket(&token_id).await?["owner_id"],
        "vanish.sandbox"
    );

    // Until the returned funds are back, a new claim would have to use B's principal: rejected.
    let real = force_shortfall(&escrow, &[a, b], SHORTFALL).await?;
    let result = escrow.claim_refund(&holder, &token_id, 100).await?;
    assert_fails_with(&result, "ERR_INSUFFICIENT_LIQUIDITY");
    assert_eq!(escrow.ticket(&token_id).await?["status"], "Active");

    // Once they are back, the claim works and B is untouched.
    chain.set_balance(&escrow.id(), real).await?;
    let before = chain.balance(&holder.0).await?;
    let paid: bool = escrow
        .claim_refund(&holder, &token_id, 100)
        .await?
        .assert_success()
        .json()?;
    assert!(paid);
    let received = chain.balance(&holder.0).await? - before;
    assert!(received > PRICE - GAS_FEE_BOUND && received < PRICE);
    assert_eq!(
        amount(&escrow.accounting(a).await?, "refunds_settled"),
        PRICE
    );
    let accounting_b = escrow.accounting(b).await?;
    assert_eq!(amount(&accounting_b, "principal_reserved"), PRICE);
    assert_eq!(amount(&accounting_b, "refunds_settled"), 0);
    Ok(())
}

#[tokio::test]
async fn claim_with_low_gas_fails_whole() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (event_id, _) = accepted_event(&escrow, &cast, [600, 1_200, 1_800], 3).await?;
    let token_id = escrow.buy(&cast.luis, event_id, PRICE).await?;
    escrow.cancel(&cast.organizer, event_id).await?;

    for tgas in [30, 59] {
        let result = escrow.claim_refund(&cast.luis, &token_id, tgas).await?;
        assert_fails_with(&result, "ERR_INSUFFICIENT_GAS");
        assert!(
            chain
                .transfers_from(&result, &escrow.id())
                .await?
                .is_empty(),
            "nothing was sent"
        );
    }
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["status"], "Active");
    assert_eq!(ticket["pending_operation_id"], Value::Null);
    assert_eq!(escrow.operation(1).await?, Value::Null);
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refund_pending"), 0);
    assert_eq!(amount(&accounting, "principal_reserved"), PRICE);

    let paid: bool = escrow
        .claim_refund(&cast.luis, &token_id, 100)
        .await?
        .assert_success()
        .json()?;
    assert!(paid);
    Ok(())
}

#[tokio::test]
async fn claim_refund_expires_the_event_first() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let (event_id, times) = accepted_event(&escrow, &cast, [20, 30, 40], 3).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;

    // Before the deadline the event is unresolved: no refund.
    let result = escrow.claim_refund(&cast.ana, &token_id, 100).await?;
    assert_fails_with(&result, "ERR_NOT_REFUNDABLE");

    // After it, nobody expired the event; the holder's claim does it in the same call.
    chain.advance_to(times[2]).await?;
    assert_eq!(escrow.event(event_id).await?["outcome"], "Unresolved");
    let result = escrow.claim_refund(&cast.ana, &token_id, 100).await?;
    let resolved = events_named(&result, "event_resolved");
    let paid: bool = result.assert_success().json()?;
    assert!(paid);
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0]["data"][0]["reason"], "Expired");
    let event = escrow.event(event_id).await?;
    assert_eq!(event["outcome_reason"], "Expired");
    assert_eq!(event["resolved_by"], cast.ana.0.as_str());
    Ok(())
}
