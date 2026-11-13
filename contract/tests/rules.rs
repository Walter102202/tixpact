//! Event rules and purchases in the sandbox (plan, Task C1): who may do what, when, and that every
//! yoctoNEAR of a purchase is reserved.

mod common;

use common::{
    GAS_FEE_BOUND, NO_DEPOSIT, ONE_YOCTO, PRICE, TGAS, TestChain, amount, assert_fails_with,
    events_named, terms,
};
use near_api::NearToken;
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

/// Start, end and deadline used when a test does not need to move time: far enough to never be
/// reached while it runs.
const LATER: [u64; 3] = [600, 1_200, 1_800];

#[tokio::test]
async fn t01_purchase_reserves_exact_price() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now(LATER).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 3))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;

    for wrong in [PRICE - 1, PRICE + 1, 0] {
        let result = escrow
            .call(
                &cast.ana,
                "buy_ticket",
                json!({ "event_id": event_id }),
                NearToken::from_yoctonear(wrong),
                TGAS,
            )
            .await?;
        assert_fails_with(&result, "ERR_WRONG_DEPOSIT");
    }
    let untouched = escrow.accounting(event_id).await?;
    assert_eq!(amount(&untouched, "principal_received"), 0);
    assert_eq!(amount(&untouched, "principal_reserved"), 0);
    let supply: String = escrow.view("nft_total_supply", json!({})).await?;
    assert_eq!(supply, "0", "a rejected purchase mints nothing");

    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;
    assert_eq!(token_id, "1-1");
    let token: Value = escrow
        .view("nft_token", json!({ "token_id": token_id }))
        .await?;
    assert_eq!(token["owner_id"], cast.ana.0.as_str());
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(amount(&ticket, "principal"), PRICE);
    assert_eq!(ticket["status"], "Active");
    assert_eq!(ticket["claim"], "Reserved");
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "principal_received"), PRICE);
    assert_eq!(amount(&accounting, "principal_reserved"), PRICE);
    assert_eq!(escrow.event(event_id).await?["sold"], 1);
    Ok(())
}

#[tokio::test]
async fn t02_purchase_needs_acceptance_and_capacity() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now(LATER).await?;

    // Creation below the quote: no event, the deposit goes back with the failed receipt.
    let below = NearToken::from_yoctonear(escrow.quote(1).await? - 1);
    let args = json!({ "terms": terms(&cast.verifier, times, 1) });
    let result = escrow
        .call(&cast.organizer, "create_event", args, below, TGAS)
        .await?;
    assert_fails_with(&result, "ERR_WRONG_DEPOSIT");
    let events: Vec<Value> = escrow
        .view("list_events", json!({ "from_index": 0, "limit": 10 }))
        .await?;
    assert!(events.is_empty());

    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 1))
        .await?;
    assert_eq!(event_id, 1);
    assert_eq!(escrow.event(event_id).await?["phase"], "AwaitingVerifier");

    // Not accepted yet.
    let buy = json!({ "event_id": event_id });
    let deposit = NearToken::from_yoctonear(PRICE);
    let result = escrow
        .call(&cast.ana, "buy_ticket", buy.clone(), deposit, TGAS)
        .await?;
    assert_fails_with(&result, "ERR_NOT_ACCEPTED");

    // A hash that is not the event's terms hash, and a caller who is not the verifier.
    let wrong_hash = json!({ "event_id": event_id, "terms_hash": "0".repeat(64) });
    let result = escrow
        .call(
            &cast.verifier,
            "accept_verification",
            wrong_hash,
            ONE_YOCTO,
            TGAS,
        )
        .await?;
    assert_fails_with(&result, "ERR_TERMS_MISMATCH");
    let hash = escrow.event(event_id).await?["terms_hash"].clone();
    let right_hash = json!({ "event_id": event_id, "terms_hash": hash });
    let result = escrow
        .call(
            &cast.organizer,
            "accept_verification",
            right_hash,
            ONE_YOCTO,
            TGAS,
        )
        .await?;
    assert_fails_with(&result, "ERR_UNAUTHORIZED");
    assert_eq!(escrow.event(event_id).await?["verifier_accepted"], false);

    escrow.accept(&cast.verifier, event_id).await?;
    let event = escrow.event(event_id).await?;
    assert_eq!(event["verifier_accepted"], true);
    assert_eq!(event["phase"], "OnSale");

    // Capacity reached.
    escrow.buy(&cast.ana, event_id, PRICE).await?;
    let result = escrow
        .call(&cast.luis, "buy_ticket", buy, deposit, TGAS)
        .await?;
    assert_fails_with(&result, "ERR_SOLD_OUT");
    let event = escrow.event(event_id).await?;
    assert_eq!(event["sold"], 1);
    assert_eq!(event["phase"], "SoldOut");
    assert_eq!(
        amount(&escrow.accounting(event_id).await?, "principal_reserved"),
        PRICE
    );
    Ok(())
}

#[tokio::test]
async fn t04_attestation_completes_event() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now([20, 30, 600]).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 5))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    escrow.buy(&cast.ana, event_id, PRICE).await?;
    escrow.buy(&cast.luis, event_id, PRICE).await?;

    let attest = json!({ "event_id": event_id, "evidence_ref": "https://teatro.example/report" });
    let result = escrow
        .call(
            &cast.verifier,
            "attest_completed",
            attest.clone(),
            ONE_YOCTO,
            TGAS,
        )
        .await?;
    assert_fails_with(&result, "ERR_TOO_EARLY");

    chain.advance_to(times[1]).await?;
    for impostor in [&cast.mallory, &cast.organizer, &cast.ana] {
        let result = escrow
            .call(
                impostor,
                "attest_completed",
                attest.clone(),
                ONE_YOCTO,
                TGAS,
            )
            .await?;
        assert_fails_with(&result, "ERR_UNAUTHORIZED");
    }
    assert_eq!(escrow.event(event_id).await?["outcome"], "Unresolved");

    let result = escrow
        .call(
            &cast.verifier,
            "attest_completed",
            attest.clone(),
            ONE_YOCTO,
            TGAS,
        )
        .await?;
    let resolved = events_named(&result, "event_resolved");
    result.assert_success();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0]["data"][0]["outcome"], "Completed");

    let event = escrow.event(event_id).await?;
    assert_eq!(event["outcome"], "Completed");
    assert_eq!(event["outcome_reason"], "Attested");
    assert_eq!(event["resolved_by"], cast.verifier.0.as_str());
    assert_eq!(event["evidence_ref"], "https://teatro.example/report");
    assert_eq!(event["phase"], "Completed");
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "organizer_available"), 2 * PRICE);
    assert_eq!(amount(&accounting, "principal_reserved"), 0);
    assert_eq!(escrow.ticket("1-1").await?["claim"], "ReleasedToOrganizer");

    // The outcome is written once.
    let result = escrow
        .call(&cast.verifier, "attest_completed", attest, ONE_YOCTO, TGAS)
        .await?;
    assert_fails_with(&result, "ERR_ALREADY_RESOLVED");
    let cancel = json!({ "event_id": event_id, "reason_ref": null });
    let result = escrow
        .call(&cast.organizer, "cancel_event", cancel, ONE_YOCTO, TGAS)
        .await?;
    assert_fails_with(&result, "ERR_ALREADY_RESOLVED");
    Ok(())
}

#[tokio::test]
async fn t05_anyone_expires_after_deadline() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now([20, 30, 40]).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 5))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;

    // Nobody acts. After the deadline a third account expires the event.
    chain.advance_to(times[2]).await?;
    assert_eq!(escrow.event(event_id).await?["phase"], "Expirable");
    let expire = json!({ "event_id": event_id });
    let result = escrow
        .call(
            &cast.mallory,
            "expire_event",
            expire.clone(),
            NO_DEPOSIT,
            TGAS,
        )
        .await?;
    let resolved = events_named(&result, "event_resolved");
    let outcome: String = result.assert_success().json()?;
    assert_eq!(outcome, "Refundable");
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0]["data"][0]["reason"], "Expired");

    let event = escrow.event(event_id).await?;
    assert_eq!(event["outcome"], "Refundable");
    assert_eq!(event["outcome_reason"], "Expired");
    assert_eq!(event["resolved_by"], cast.mallory.0.as_str());
    assert_eq!(event["evidence_ref"], Value::Null);
    assert_eq!(event["phase"], "Refundable");
    assert_eq!(escrow.ticket(&token_id).await?["claim"], "Refundable");
    assert_eq!(
        amount(&escrow.accounting(event_id).await?, "principal_reserved"),
        PRICE
    );

    // Expiring again changes nothing and returns the outcome.
    let result = escrow
        .call(&cast.luis, "expire_event", expire, NO_DEPOSIT, TGAS)
        .await?;
    assert!(events_named(&result, "event_resolved").is_empty());
    let outcome: String = result.assert_success().json()?;
    assert_eq!(outcome, "Refundable");
    assert_eq!(
        escrow.event(event_id).await?["resolved_by"],
        cast.mallory.0.as_str()
    );
    Ok(())
}

#[tokio::test]
async fn t06_cancel_only_by_roles() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now([20, 30, 40]).await?;
    let mut ids = Vec::new();
    for _ in 0..3 {
        ids.push(
            escrow
                .create_event(&cast.organizer, terms(&cast.verifier, times, 2))
                .await?,
        );
    }
    let cancel =
        |event_id: u32, reason: Value| json!({ "event_id": event_id, "reason_ref": reason });

    // The organizer cancels before the start.
    let result = escrow
        .call(
            &cast.organizer,
            "cancel_event",
            cancel(ids[0], json!("artist ill")),
            NO_DEPOSIT,
            TGAS,
        )
        .await?;
    assert_fails_with(&result, "ERR_ONE_YOCTO");
    escrow
        .call(
            &cast.organizer,
            "cancel_event",
            cancel(ids[0], json!("artist ill")),
            ONE_YOCTO,
            TGAS,
        )
        .await?
        .assert_success();
    let event = escrow.event(ids[0]).await?;
    assert_eq!(event["outcome"], "Refundable");
    assert_eq!(event["outcome_reason"], "Cancelled");
    assert_eq!(event["resolved_by"], cast.organizer.0.as_str());
    assert_eq!(event["evidence_ref"], "artist ill");

    // A third account cannot cancel, before or after the start.
    for event_id in [ids[1], ids[2]] {
        let result = escrow
            .call(
                &cast.mallory,
                "cancel_event",
                cancel(event_id, Value::Null),
                ONE_YOCTO,
                TGAS,
            )
            .await?;
        assert_fails_with(&result, "ERR_UNAUTHORIZED");
    }

    // The verifier cancels while the event awaits its attestation.
    chain.advance_to(times[1]).await?;
    assert_eq!(escrow.event(ids[1]).await?["phase"], "AwaitingAttestation");
    escrow
        .call(
            &cast.verifier,
            "cancel_event",
            cancel(ids[1], Value::Null),
            ONE_YOCTO,
            TGAS,
        )
        .await?
        .assert_success();
    let event = escrow.event(ids[1]).await?;
    assert_eq!(event["outcome_reason"], "Cancelled");
    assert_eq!(event["resolved_by"], cast.verifier.0.as_str());
    assert_eq!(event["evidence_ref"], Value::Null);

    // After the deadline nobody can cancel: the event can only expire.
    chain.advance_to(times[2]).await?;
    for role in [&cast.organizer, &cast.verifier] {
        let result = escrow
            .call(
                role,
                "cancel_event",
                cancel(ids[2], Value::Null),
                ONE_YOCTO,
                TGAS,
            )
            .await?;
        assert_fails_with(&result, "ERR_TOO_LATE");
    }
    let result = escrow
        .call(
            &cast.mallory,
            "cancel_event",
            cancel(ids[2], Value::Null),
            ONE_YOCTO,
            TGAS,
        )
        .await?;
    assert_fails_with(&result, "ERR_UNAUTHORIZED");
    assert_eq!(escrow.event(ids[2]).await?["outcome"], "Unresolved");
    Ok(())
}

#[tokio::test]
async fn t15_deadline_boundaries() -> TestResult {
    // The sandbox cannot place a transaction on a chosen millisecond, so each window is shown
    // from both sides here, with the block time each call ran at. The exact millisecond is pinned
    // by the unit test `deadline_boundaries_are_exact` (docs/decisions/
    // 2026-11-12-exact-time-boundaries-in-unit-tests.md).
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now([20, 30, 45]).await?;
    let [starts, ends, deadline] = times;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 5))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;

    // Before the start: buying and transferring work.
    let buy = json!({ "event_id": event_id });
    let deposit = NearToken::from_yoctonear(PRICE);
    let result = escrow
        .call(&cast.luis, "buy_ticket", buy.clone(), deposit, TGAS)
        .await?;
    assert!(chain.executed_at_ms(&result).await? < starts);
    result.assert_success();
    let result = escrow
        .transfer(&cast.ana, &cast.mallory.0, &token_id)
        .await?;
    assert!(chain.executed_at_ms(&result).await? < starts);
    result.assert_success();

    // From the start on: both are too late.
    chain.advance_to(starts).await?;
    let result = escrow
        .call(&cast.luis, "buy_ticket", buy, deposit, TGAS)
        .await?;
    assert!(chain.executed_at_ms(&result).await? >= starts);
    assert_fails_with(&result, "ERR_TOO_LATE");
    let result = escrow
        .transfer(&cast.mallory, &cast.ana.0, &token_id)
        .await?;
    assert!(chain.executed_at_ms(&result).await? >= starts);
    assert_fails_with(&result, "ERR_TOO_LATE");

    // Shortly before the deadline: expiry is too early, attestation still works.
    chain.advance_to(deadline - 6_000).await?;
    let expire = json!({ "event_id": event_id });
    let result = escrow
        .call(
            &cast.mallory,
            "expire_event",
            expire.clone(),
            NO_DEPOSIT,
            TGAS,
        )
        .await?;
    let ran_at = chain.executed_at_ms(&result).await?;
    assert!((ends..deadline).contains(&ran_at));
    assert_fails_with(&result, "ERR_TOO_EARLY");

    // From the deadline on: attestation is too late, expiry works.
    chain.advance_to(deadline).await?;
    let attest = json!({ "event_id": event_id, "evidence_ref": null });
    let result = escrow
        .call(&cast.verifier, "attest_completed", attest, ONE_YOCTO, TGAS)
        .await?;
    assert!(chain.executed_at_ms(&result).await? >= deadline);
    assert_fails_with(&result, "ERR_TOO_LATE");
    let result = escrow
        .call(&cast.mallory, "expire_event", expire, NO_DEPOSIT, TGAS)
        .await?;
    assert!(chain.executed_at_ms(&result).await? >= deadline);
    let outcome: String = result.assert_success().json()?;
    assert_eq!(outcome, "Refundable");
    Ok(())
}

#[tokio::test]
async fn t17_mint_keeps_the_deposit() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now(LATER).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 3))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;

    let ana_before = chain.balance(&cast.ana.0).await?;
    let escrow_before = chain.balance(&escrow.id()).await?;
    let result = escrow
        .call(
            &cast.ana,
            "buy_ticket",
            json!({ "event_id": event_id }),
            NearToken::from_yoctonear(PRICE),
            TGAS,
        )
        .await?;
    // The only transfers a purchase may cause are gas refunds from the system.
    let refunds_to_ana = result
        .receipt_outcomes()
        .iter()
        .filter(|outcome| outcome.executor_id == cast.ana.0)
        .count();
    result.assert_success();
    let ana_after = chain.balance(&cast.ana.0).await?;
    let escrow_after = chain.balance(&escrow.id()).await?;

    let spent = ana_before - ana_after;
    assert!(
        (PRICE..PRICE + GAS_FEE_BOUND).contains(&spent),
        "Ana paid {spent}: the price plus gas, nothing refunded by the mint"
    );
    assert!(escrow_after >= escrow_before + PRICE);
    assert!(refunds_to_ana <= 1, "at most the gas refund reaches Ana");
    Ok(())
}

#[tokio::test]
async fn t21_false_attestation_is_a_trust_limit() -> TestResult {
    // The trust limit, stated as a test: the contract enforces who decides and when, not whether
    // the decision is true. A verifier who attests an event that never took place is obeyed.
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now([20, 30, 600]).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 2))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;

    // The event does not happen. The verifier attests anyway, inside its window.
    chain.advance_to(times[1]).await?;
    let attest = json!({ "event_id": event_id, "evidence_ref": "it was great" });
    escrow
        .call(&cast.verifier, "attest_completed", attest, ONE_YOCTO, TGAS)
        .await?
        .assert_success();

    let event = escrow.event(event_id).await?;
    assert_eq!(event["outcome"], "Completed");
    assert_eq!(
        amount(&escrow.accounting(event_id).await?, "organizer_available"),
        PRICE
    );
    assert_eq!(
        escrow.ticket(&token_id).await?["claim"],
        "ReleasedToOrganizer"
    );
    Ok(())
}

#[tokio::test]
async fn create_event_rejects_bad_terms() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let now = chain.now_ms().await?;
    let good = terms(&cast.verifier, chain.times_from_now(LATER).await?, 3);
    let with = |field: &str, value: Value| {
        let mut terms = good.clone();
        terms[field] = value;
        terms
    };
    let cases = [
        (
            "verifier equal to organizer",
            with("verifier_id", json!(cast.organizer.0)),
            "ERR_INVALID_TERMS",
        ),
        ("price 0", with("price", json!("0")), "ERR_INVALID_TERMS"),
        (
            "capacity 0",
            with("capacity", json!(0)),
            "ERR_INVALID_TERMS",
        ),
        (
            "capacity 101",
            with("capacity", json!(101)),
            "ERR_INVALID_TERMS",
        ),
        (
            "start in the past",
            with("starts_at_ms", json!(now - 1_000)),
            "ERR_INVALID_TERMS",
        ),
        (
            "end before start",
            with("ends_at_ms", good["starts_at_ms"].clone()),
            "ERR_INVALID_TERMS",
        ),
        (
            "deadline before end",
            with("resolution_deadline_ms", good["ends_at_ms"].clone()),
            "ERR_INVALID_TERMS",
        ),
        (
            "title of 121 bytes",
            with("title", json!("a".repeat(121))),
            "ERR_LIMIT",
        ),
        (
            "venue of 121 bytes",
            with("venue", json!("v".repeat(121))),
            "ERR_LIMIT",
        ),
    ];

    let organizer_before = chain.balance(&cast.organizer.0).await?;
    // Every case attaches more than any quote, so only the terms can be what is rejected.
    let generous = NearToken::from_yoctonear(escrow.quote(101).await?);
    for (case, terms, code) in cases {
        let result = escrow
            .call(
                &cast.organizer,
                "create_event",
                json!({ "terms": terms }),
                generous,
                TGAS,
            )
            .await?;
        assert_fails_with(&result, code);
        eprintln!("rejected as expected: {case}");
    }
    let below = NearToken::from_yoctonear(escrow.quote(3).await? - 1);
    let result = escrow
        .call(
            &cast.organizer,
            "create_event",
            json!({ "terms": good }),
            below,
            TGAS,
        )
        .await?;
    assert_fails_with(&result, "ERR_WRONG_DEPOSIT");

    let events: Vec<Value> = escrow
        .view("list_events", json!({ "from_index": 0, "limit": 50 }))
        .await?;
    assert!(events.is_empty(), "no event was created");
    let organizer_after = chain.balance(&cast.organizer.0).await?;
    assert!(
        organizer_before - organizer_after < 11 * GAS_FEE_BOUND,
        "every deposit came back; only gas was spent"
    );
    Ok(())
}
