//! Transfers to contracts in the sandbox (plan, Task C3): `nft_transfer_call`, its per-ticket lock
//! and its resolver (R8), and the standard token surface (NEP-171, NEP-177, NEP-181).

mod common;

use std::time::Duration;

use common::{
    Escrow, ONE_YOCTO, PRICE, TGAS, TestChain, amount, assert_fails_with, nep171_events,
    receipt_failure_texts, terms, ticket_receiver_wasm,
};
use near_api::advanced::TransactionableOrSigned;
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::types::{Reference, TxExecutionStatus};
use near_api::{Account, AccountId, Chain, CryptoHash, NearGas, NearToken, Transaction};
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

/// Where the receiver fixture is deployed.
const RECEIVER_ID: &str = "receiver.sandbox";
/// Gas for an `nft_transfer_call` to the fixture: its `reenter` mode schedules 120 Tgas.
const TRANSFER_CALL_TGAS: u64 = 300;

/// The kinds of a ticket's history entries, oldest first, with the account each one names.
async fn history_of(escrow: &Escrow<'_>, token_id: &str) -> TestResult<Vec<(String, String)>> {
    let history = escrow.history(token_id).await?;
    let entries = history["entries"].as_array().ok_or("no entries")?;
    Ok(entries
        .iter()
        .map(|entry| {
            (
                entry["kind"].as_str().unwrap_or_default().to_string(),
                entry["account_id"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect())
}

#[tokio::test]
async fn t12_transfer_call_receiver_outcomes() -> TestResult {
    let chain = TestChain::start().await?;
    let cast = chain.cast().await?;
    let escrow = chain.escrow().await?;
    let receiver = chain
        .deploy_fixture(RECEIVER_ID, 10, ticket_receiver_wasm())
        .await?;
    let times = chain.times_from_now([120, 180, 240]).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 6))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let ana = cast.ana.0.as_str();
    let receiver_id = receiver.0.as_str();

    // Each mode, and whether the receiver keeps the ticket. Only a clean `false` keeps it.
    let modes = [
        ("keep", true),
        ("return", false),
        ("panic", false),
        ("garbage", false),
        ("oversized", false),
        ("reenter", true),
    ];
    for (msg, kept) in modes {
        let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;
        let result = escrow
            .transfer_call(&cast.ana, &receiver.0, &token_id, msg, TRANSFER_CALL_TGAS)
            .await?;
        let answer: bool = result.clone().assert_success().json()?;
        assert_eq!(
            answer, kept,
            "{msg}: the call resolves to whether the receiver kept it"
        );

        let ticket = escrow.ticket(&token_id).await?;
        let holder = if kept { receiver_id } else { ana };
        assert_eq!(ticket["owner_id"], holder, "{msg}: final holder");
        assert_eq!(ticket["status"], "Active", "{msg}: the lock is cleared");
        assert_eq!(ticket["claim"], "Reserved", "{msg}");

        let mut expected_history = vec![
            ("Purchased".to_string(), ana.to_string()),
            ("Transferred".to_string(), receiver_id.to_string()),
        ];
        let mut expected_moves = vec![json!({
            "old_owner_id": ana, "new_owner_id": receiver_id, "token_ids": [token_id],
        })];
        if !kept {
            expected_history.push(("TransferReturned".to_string(), ana.to_string()));
            expected_moves.push(json!({
                "old_owner_id": receiver_id, "new_owner_id": ana, "token_ids": [token_id],
            }));
        }
        assert_eq!(
            history_of(&escrow, &token_id).await?,
            expected_history,
            "{msg}"
        );
        assert_eq!(
            nep171_events(&result, "nft_transfer"),
            expected_moves,
            "{msg}"
        );

        let failures = receipt_failure_texts(&result);
        match msg {
            "panic" => {
                assert_eq!(failures.len(), 1, "{failures:?}");
                assert!(
                    failures[0].contains("the receiver refuses this ticket"),
                    "{failures:?}"
                );
            }
            "reenter" => {
                // While unresolved, the receiver holds the ticket and still can neither claim nor
                // move it.
                assert_eq!(
                    failures.len(),
                    2,
                    "claim and transfer both fail: {failures:?}"
                );
                assert!(
                    failures
                        .iter()
                        .all(|text| text.contains("ERR_TICKET_LOCKED")),
                    "{failures:?}"
                );
                let seen = "reenter: claim=failed transfer=failed status=TransferPending";
                assert!(
                    result.logs().iter().any(|line| line.contains(seen)),
                    "{:?}",
                    result.logs()
                );
            }
            _ => assert!(failures.is_empty(), "{msg}: {failures:?}"),
        }
    }

    // Moving tickets moves no money.
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "principal_reserved"), 6 * PRICE);
    Ok(())
}

/// Signs an `nft_transfer_call` as `from` and returns its hash once it is in a block, before it
/// has finished.
async fn start_transfer_call(
    escrow: &Escrow<'_>,
    from: &Account,
    receiver_id: &AccountId,
    token_id: &str,
    msg: &str,
) -> TestResult<CryptoHash> {
    let args = json!({
        "receiver_id": receiver_id,
        "token_id": token_id,
        "approval_id": null,
        "memo": null,
        "msg": msg,
    });
    let transaction = escrow
        .contract
        .call_function("nft_transfer_call", args)
        .transaction()
        .deposit(ONE_YOCTO)
        .gas(NearGas::from_tgas(TRANSFER_CALL_TGAS))
        .with_signer(from.0.clone(), escrow.chain.signer.clone())
        .presign_with(&escrow.chain.network)
        .await?;
    let TransactionableOrSigned::Signed((signed, _)) = &transaction.transaction else {
        return Err("the transaction was not signed".into());
    };
    let hash = signed.get_hash();
    let _ = transaction
        .wait_until(TxExecutionStatus::Included)
        .send_to(&escrow.chain.network)
        .await?;
    Ok(hash)
}

/// The final outcome of a transaction sent earlier, waiting for it to finish.
async fn final_outcome(
    chain: &TestChain,
    sender: &AccountId,
    hash: CryptoHash,
) -> TestResult<ExecutionFinalResult> {
    let mut last_error = String::new();
    for _ in 0..20 {
        match Transaction::status_with_options(sender.clone(), hash, TxExecutionStatus::Final)
            .fetch_from(&chain.network)
            .await
        {
            Ok(result) => return Ok(result),
            Err(error) => last_error = error.to_string(),
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err(format!("the transaction did not finish: {last_error}").into())
}

/// Reads a ticket until its status is `status`, for up to 10 seconds.
async fn wait_for_status(escrow: &Escrow<'_>, token_id: &str, status: &str) -> TestResult<()> {
    for _ in 0..100 {
        if escrow.ticket(token_id).await?["status"] == status {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!("ticket {token_id} never reached {status}").into())
}

#[tokio::test]
async fn t13_resolver_ignores_time_window() -> TestResult {
    // The receiver holds the transfer unresolved until the event has started, then asks to send
    // the ticket back. No transfer can begin after the start, but this one began before it: the
    // resolver still returns the ticket and clears the lock.
    let chain = TestChain::start().await?;
    let cast = chain.cast().await?;
    let escrow = chain.escrow().await?;
    let receiver = chain
        .deploy_fixture(RECEIVER_ID, 10, ticket_receiver_wasm())
        .await?;
    let times = chain.times_from_now([40, 80, 120]).await?;
    let starts_ms = times[0];
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 3))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;

    chain.advance_to(starts_ms - 5_000).await?;
    let hash = start_transfer_call(&escrow, &cast.ana, &receiver.0, &token_id, "hold").await?;
    wait_for_status(&escrow, &token_id, "TransferPending").await?;
    chain.advance_to(starts_ms + 1_000).await?;

    // Unresolved after the start: the receiver holds the ticket and can neither claim nor move it.
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["status"], "TransferPending");
    assert_eq!(ticket["owner_id"], receiver.0.as_str());
    let claim = escrow.claim_refund(&receiver, &token_id, 100).await?;
    assert_fails_with(&claim, "ERR_TICKET_LOCKED");
    let transfer = escrow.transfer(&receiver, &cast.luis.0, &token_id).await?;
    assert_fails_with(&transfer, "ERR_TICKET_LOCKED");

    chain
        .call(
            &receiver,
            &receiver.0,
            "release",
            json!({}),
            NearToken::from_yoctonear(0),
            TGAS,
        )
        .await?
        .assert_success();
    let result = final_outcome(&chain, &cast.ana.0, hash).await?;
    let failures = receipt_failure_texts(&result);
    assert!(
        failures.is_empty(),
        "the receiver answered and the resolver ran: {failures:?}"
    );
    let kept: bool = result.clone().assert_success().json()?;
    assert!(!kept, "the receiver asked to send the ticket back");

    // The return ran after the start.
    let from_receiver = format!("\"old_owner_id\":\"{RECEIVER_ID}\"");
    let returned_in = result
        .receipt_outcomes()
        .iter()
        .find(|outcome| {
            outcome.executor_id == escrow.id()
                && outcome.logs.iter().any(|line| {
                    line.contains("\"event\":\"nft_transfer\"") && line.contains(&from_receiver)
                })
        })
        .ok_or("no receipt returned the ticket")?;
    let block = Chain::block()
        .at(Reference::AtBlockHash(returned_in.block_hash))
        .fetch_from(&chain.network)
        .await?;
    assert!(
        block.header.timestamp / 1_000_000 >= starts_ms,
        "the resolver ran after the start"
    );

    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["owner_id"], cast.ana.0.as_str());
    assert_eq!(ticket["status"], "Active", "the lock is cleared");
    let last = history_of(&escrow, &token_id).await?.pop();
    assert_eq!(
        last,
        Some(("TransferReturned".to_string(), cast.ana.0.to_string()))
    );

    // Ana has it back, but after the start she cannot begin a new transfer.
    let late = escrow.transfer(&cast.ana, &cast.luis.0, &token_id).await?;
    assert_fails_with(&late, "ERR_TOO_LATE");
    Ok(())
}

#[tokio::test]
async fn transfer_call_with_low_gas_fails_whole() -> TestResult {
    // Below GAS_TRANSFER_CALL_MIN the call fails before it locks or moves anything. At exactly
    // the minimum the receiver still answers and the resolver still clears the lock.
    let chain = TestChain::start().await?;
    let cast = chain.cast().await?;
    let escrow = chain.escrow().await?;
    let receiver = chain
        .deploy_fixture(RECEIVER_ID, 10, ticket_receiver_wasm())
        .await?;
    let times = chain.times_from_now([600, 1_200, 1_800]).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 3))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;
    let minimum = ticket_escrow::GAS_TRANSFER_CALL_MIN.as_tgas();

    let low = escrow
        .transfer_call(&cast.ana, &receiver.0, &token_id, "keep", minimum - 1)
        .await?;
    assert_fails_with(&low, "ERR_INSUFFICIENT_GAS");
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["owner_id"], cast.ana.0.as_str());
    assert_eq!(ticket["status"], "Active");
    assert_eq!(history_of(&escrow, &token_id).await?.len(), 1);

    let at_minimum = escrow
        .transfer_call(&cast.ana, &receiver.0, &token_id, "keep", minimum)
        .await?;
    let failures = receipt_failure_texts(&at_minimum);
    assert!(failures.is_empty(), "{failures:?}");
    let kept: bool = at_minimum.clone().assert_success().json()?;
    assert!(kept);
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["owner_id"], receiver.0.as_str());
    assert_eq!(ticket["status"], "Active");
    Ok(())
}

#[tokio::test]
async fn t22_standard_token_surface() -> TestResult {
    let chain = TestChain::start().await?;
    let cast = chain.cast().await?;
    let escrow = chain.escrow().await?;
    let times = chain.times_from_now([600, 1_200, 1_800]).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 3))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let ana = cast.ana.0.as_str();
    let luis = cast.luis.0.as_str();

    // NEP-177 contract metadata.
    let metadata: Value = escrow.view("nft_metadata", json!({})).await?;
    assert_eq!(
        metadata,
        json!({
            "spec": "nft-1.0.0",
            "name": "Ticket escrow",
            "symbol": "TICKET",
            "icon": null,
            "base_uri": null,
            "reference": null,
            "reference_hash": null,
        })
    );

    // A purchase is a NEP-171 mint.
    let buy = escrow
        .call(
            &cast.ana,
            "buy_ticket",
            json!({ "event_id": event_id }),
            NearToken::from_yoctonear(PRICE),
            TGAS,
        )
        .await?;
    let first: String = buy.clone().assert_success().json()?;
    assert_eq!(
        nep171_events(&buy, "nft_mint"),
        vec![json!({ "owner_id": ana, "token_ids": [first] })]
    );
    let second = escrow.buy(&cast.luis, event_id, PRICE).await?;

    // `nft_token`: the standard token, with metadata derived from the event.
    let token: Value = escrow
        .view("nft_token", json!({ "token_id": first }))
        .await?;
    assert_eq!(token["token_id"], first.as_str());
    assert_eq!(token["owner_id"], ana);
    assert_eq!(token["approved_account_ids"], Value::Null);
    let token_metadata = &token["metadata"];
    assert_eq!(token_metadata["title"], "Jazz night - ticket 1");
    let description = token_metadata["description"].as_str().unwrap_or_default();
    assert!(
        description.contains("Jazz night") && description.contains("Teatro Municipal"),
        "{description}"
    );
    for field in [
        "media",
        "media_hash",
        "copies",
        "issued_at",
        "expires_at",
        "starts_at",
        "updated_at",
        "extra",
        "reference",
        "reference_hash",
    ] {
        assert_eq!(token_metadata[field], Value::Null, "{field}");
    }
    let missing: Value = escrow
        .view("nft_token", json!({ "token_id": "9-9" }))
        .await?;
    assert_eq!(missing, Value::Null);

    // A plain transfer with a memo is a NEP-171 transfer.
    let args = json!({
        "receiver_id": luis, "token_id": first, "approval_id": null, "memo": "for Luis",
    });
    let transfer = escrow
        .call(&cast.ana, "nft_transfer", args, ONE_YOCTO, TGAS)
        .await?;
    let _ = transfer.clone().assert_success();
    assert_eq!(
        nep171_events(&transfer, "nft_transfer"),
        vec![json!({
            "old_owner_id": ana, "new_owner_id": luis, "token_ids": [first], "memo": "for Luis",
        })]
    );
    let token: Value = escrow
        .view("nft_token", json!({ "token_id": first }))
        .await?;
    assert_eq!(token["owner_id"], luis);

    // NEP-181 enumeration.
    let total: String = escrow.view("nft_total_supply", json!({})).await?;
    assert_eq!(total, "2");
    let all: Vec<Value> = escrow.view("nft_tokens", json!({})).await?;
    let ids: Vec<&str> = all.iter().filter_map(|t| t["token_id"].as_str()).collect();
    assert_eq!(ids, [first.as_str(), second.as_str()]);
    assert!(all.iter().all(|t| t["owner_id"] == luis));
    let page: Vec<Value> = escrow
        .view("nft_tokens", json!({ "from_index": "1", "limit": 1 }))
        .await?;
    assert_eq!(page.len(), 1);
    assert_eq!(page[0]["token_id"], second.as_str());
    let past_the_end: Vec<Value> = escrow
        .view("nft_tokens", json!({ "from_index": "5" }))
        .await?;
    assert!(past_the_end.is_empty());

    let luis_supply: String = escrow
        .view("nft_supply_for_owner", json!({ "account_id": luis }))
        .await?;
    assert_eq!(luis_supply, "2");
    let ana_supply: String = escrow
        .view("nft_supply_for_owner", json!({ "account_id": ana }))
        .await?;
    assert_eq!(ana_supply, "0");
    let luis_tokens: Vec<Value> = escrow
        .view("nft_tokens_for_owner", json!({ "account_id": luis }))
        .await?;
    assert_eq!(luis_tokens.len(), 2);
    for listed in &luis_tokens {
        let single: Value = escrow
            .view("nft_token", json!({ "token_id": listed["token_id"] }))
            .await?;
        assert_eq!(listed, &single, "the listing and nft_token agree");
    }
    let ana_tokens: Vec<Value> = escrow
        .view("nft_tokens_for_owner", json!({ "account_id": ana }))
        .await?;
    assert!(ana_tokens.is_empty());
    let luis_page: Vec<Value> = escrow
        .view(
            "nft_tokens_for_owner",
            json!({ "account_id": luis, "from_index": "1", "limit": 5 }),
        )
        .await?;
    assert_eq!(luis_page.len(), 1);
    let luis_past_the_end: Vec<Value> = escrow
        .view(
            "nft_tokens_for_owner",
            json!({ "account_id": luis, "from_index": "9" }),
        )
        .await?;
    assert!(luis_past_the_end.is_empty());

    // Approvals are disabled on both transfer methods.
    let args = json!({ "receiver_id": ana, "token_id": first, "approval_id": 0, "memo": null });
    let result = escrow
        .call(&cast.luis, "nft_transfer", args, ONE_YOCTO, TGAS)
        .await?;
    assert_fails_with(&result, "ERR_APPROVALS_DISABLED");
    let args = json!({
        "receiver_id": ana, "token_id": first, "approval_id": 0, "memo": null, "msg": "",
    });
    let result = escrow
        .call(
            &cast.luis,
            "nft_transfer_call",
            args,
            ONE_YOCTO,
            TRANSFER_CALL_TGAS,
        )
        .await?;
    assert_fails_with(&result, "ERR_APPROVALS_DISABLED");
    Ok(())
}
