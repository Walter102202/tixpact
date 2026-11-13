//! Gas in the sandbox (plan, Task C4): every change method, both settlement callbacks and the
//! transfer resolver, each in its worst case and sent with the gas the client attaches. The
//! numbers are the table in `docs/gas.md`; `cargo test --test gas -- --nocapture` prints it.

mod common;

use common::{
    Escrow, NEAR, NO_DEPOSIT, ONE_YOCTO, TestChain, amount, long_id, terms, ticket_receiver_wasm,
    vanishing_holder_wasm,
};
use near_api::types::transaction::result::{ExecutionFinalResult, ValueOrReceiptId};
use near_api::{Account, NearToken};
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;
use ticket_escrow::{
    GAS_CLAIM_MIN, GAS_FOR_CALLBACK, GAS_FOR_RESOLVE_TRANSFER, GAS_TRANSFER_CALL_MIN,
};

/// Gas the client attaches per method (plan, "Gas"; `packages/client/src/actions.ts`), in Tgas.
fn client_tgas(method: &str) -> u64 {
    match method {
        "create_event"
        | "accept_verification"
        | "cancel_event"
        | "attest_completed"
        | "expire_event"
        | "nft_transfer" => 30,
        "buy_ticket" => 50,
        "claim_refund" | "claim_payout" => 100,
        "nft_transfer_call" => 150,
        other => panic!("no client gas for {other}"),
    }
}

/// Gas attached to a transaction that makes a fixture call the escrow, in Tgas.
const FIXTURE_TGAS: u64 = 300;
/// Gas that lets the receiver fixture return the protocol's longest answer (4 MiB costs it about
/// 292 Tgas), within the protocol's 1,000 Tgas per transaction.
const HUGE_ANSWER_TGAS: u64 = 400;
/// Gas the vanishing-holder fixture attaches to its call into the escrow, in Tgas.
const FIXTURE_CALL_TGAS: u64 = 100;
/// The contract cannot be upgraded, so its gas constants keep this factor over the measured
/// worst case: each settlement callback burns at most a fifth of its static gas, and each minimum
/// covers the static gas it attaches plus five times what the call itself burns.
const MARGIN: u64 = 5;
/// The resolver must read whatever the receiver answers. Its static gas covers twice its measured
/// worst case plus the protocol's register-write fee on the longest possible answer, charged in
/// full, so a doubling of every cost still leaves it room.
const RESOLVER_MARGIN: u64 = 2;

/// Which later escrow receipt of a transaction is the one to measure besides the call.
#[derive(Clone, Copy)]
enum FollowUp {
    None,
    /// The first later escrow receipt that logged this NEP-297 event.
    Logged(&'static str),
    /// The next escrow receipt, whatever it logged.
    Next,
}

/// One line of the gas table.
struct Row {
    case: String,
    attached_tgas: u64,
    call: u64,
    follow_up: Option<u64>,
    total: u64,
}

fn tgas(gas: u64) -> f64 {
    gas as f64 / 1e12
}

/// One value of the sandbox's runtime configuration (`EXPERIMENTAL_protocol_config`), by JSON
/// pointer below `result`. `near-api` has no call for it, so this sends the request itself.
async fn protocol_config(chain: &TestChain, pointer: &str) -> TestResult<u64> {
    use std::io::{Read, Write};
    let addr = chain
        .sandbox
        .rpc_addr
        .trim_start_matches("http://")
        .to_string();
    let body = r#"{"jsonrpc":"2.0","id":"0","method":"EXPERIMENTAL_protocol_config","params":{"finality":"final"}}"#;
    let response = tokio::task::spawn_blocking(move || -> std::io::Result<String> {
        let mut stream = std::net::TcpStream::connect(&addr)?;
        let length = body.len();
        write!(
            stream,
            "POST / HTTP/1.0\r\nHost: {addr}\r\nContent-Type: application/json\r\n\
             Content-Length: {length}\r\n\r\n{body}"
        )?;
        let mut response = String::new();
        stream.read_to_string(&mut response)?;
        Ok(response)
    })
    .await??;
    let json = response.split_once("\r\n\r\n").map_or("", |(_, json)| json);
    let config: Value = near_sdk::serde_json::from_str(json)?;
    config["result"]
        .pointer(pointer)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("no {pointer} in the protocol config").into())
}

/// Checks that a transaction succeeded and that every receipt the escrow ran succeeded, and adds
/// its row: the gas burnt by the escrow's first receipt (the call), by the follow-up receipt, and
/// by the whole transaction.
fn record(
    rows: &mut Vec<Row>,
    escrow: &Escrow<'_>,
    case: &str,
    attached_tgas: u64,
    result: &ExecutionFinalResult,
    follow_up: FollowUp,
) -> TestResult<()> {
    let _ = result.clone().assert_success();
    let escrow_id = escrow.id();
    let receipts: Vec<_> = result
        .receipt_outcomes()
        .iter()
        .filter(|outcome| outcome.executor_id == escrow_id)
        .collect();
    assert!(
        receipts.iter().all(|outcome| outcome.is_success()),
        "{case}: an escrow receipt failed: {result:?}"
    );
    let call = receipts.first().ok_or("no escrow receipt")?;
    let later = receipts.iter().skip(1);
    let follow_up = match follow_up {
        FollowUp::None => None,
        FollowUp::Next => Some(later.clone().next().ok_or("no follow-up receipt")?),
        FollowUp::Logged(event) => {
            let marker = format!("\"event\":\"{event}\"");
            Some(
                later
                    .clone()
                    .find(|outcome| outcome.logs.iter().any(|line| line.contains(&marker)))
                    .ok_or_else(|| format!("{case}: no receipt logged {event}"))?,
            )
        }
    };
    rows.push(Row {
        case: case.to_string(),
        attached_tgas,
        call: call.gas_burnt.as_gas(),
        follow_up: follow_up.map(|outcome| outcome.gas_burnt.as_gas()),
        total: result.total_gas_burnt.as_gas(),
    });
    Ok(())
}

/// Event terms with the longest title and venue.
fn largest(verifier: &Account, times: [u64; 3], capacity: u32) -> Value {
    let mut terms = terms(verifier, times, capacity);
    terms["title"] = json!("t".repeat(120));
    terms["venue"] = json!("v".repeat(120));
    terms["price"] = json!(NEAR.to_string());
    terms
}

/// `nft_transfer` arguments for one ticket, with the given memo.
fn transfer_args(to: &Account, token_id: &str, memo: Option<String>) -> Value {
    json!({ "receiver_id": to.0, "token_id": token_id, "approval_id": null, "memo": memo })
}

#[tokio::test]
async fn gas_of_every_method_in_its_worst_case() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let names: Vec<String> = [
        "organizer",
        "verifier",
        "buyer",
        "stranger",
        "bouncer-a",
        "bouncer-b",
        "holder-1",
        "holder-2",
        "holder-3",
        "holder-4",
    ]
    .iter()
    .map(|name| long_id(name))
    .collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let [
        organizer,
        verifier,
        buyer,
        stranger,
        bouncer_a,
        bouncer_b,
        h1,
        h2,
        h3,
        h4,
    ]: [Account; 10] = chain
        .accounts(&refs, 200)
        .await?
        .try_into()
        .map_err(|_| "ten accounts")?;
    let receiver = chain
        .deploy_fixture(&long_id("receiver"), 10, ticket_receiver_wasm())
        .await?;
    let vanishing_holder = chain
        .deploy_fixture(&long_id("vanishing-holder"), 10, vanishing_holder_wasm())
        .await?;
    let vanishing_organizer = chain
        .deploy_fixture(&long_id("vanishing-organizer"), 20, vanishing_holder_wasm())
        .await?;
    let mut rows = Vec::new();

    // Three one-ticket events with short windows: one is paid out, one is paid out to an
    // organizer that deletes itself, one expires. Their tickets are bought before they start.
    let short = chain.times_from_now([120, 150, 200]).await?;
    let paid = escrow
        .create_event(&organizer, largest(&verifier, short, 1))
        .await?;
    escrow.accept(&verifier, paid).await?;
    escrow.buy(&buyer, paid, NEAR).await?;
    let args = json!({
        "receiver_id": escrow.id(),
        "method_name": "create_event",
        "args": json!({ "terms": largest(&verifier, short, 1) }).to_string(),
    });
    let deposit = NearToken::from_yoctonear(escrow.quote(1).await?);
    let created = chain
        .call(
            &vanishing_organizer,
            &vanishing_organizer.0,
            "forward",
            args,
            deposit,
            FIXTURE_TGAS,
        )
        .await?;
    let vanished: u32 = created.assert_success().json()?;
    escrow.accept(&verifier, vanished).await?;
    escrow.buy(&buyer, vanished, NEAR).await?;
    let expired = escrow
        .create_event(&organizer, largest(&verifier, short, 1))
        .await?;

    // The measured event: full capacity and the longest texts.
    let times = chain.times_from_now([400, 600, 900]).await?;
    let deposit = NearToken::from_yoctonear(escrow.quote(100).await?);
    let args = json!({ "terms": largest(&verifier, times, 100) });
    let result = escrow
        .call(
            &organizer,
            "create_event",
            args,
            deposit,
            client_tgas("create_event"),
        )
        .await?;
    let case = "create_event (capacity 100, longest title and venue)";
    record(
        &mut rows,
        &escrow,
        case,
        client_tgas("create_event"),
        &result,
        FollowUp::None,
    )?;
    let event: u32 = result.assert_success().json()?;

    let hash = escrow.event(event).await?["terms_hash"].clone();
    let args = json!({ "event_id": event, "terms_hash": hash });
    let tgas_used = client_tgas("accept_verification");
    let result = escrow
        .call(&verifier, "accept_verification", args, ONE_YOCTO, tgas_used)
        .await?;
    record(
        &mut rows,
        &escrow,
        "accept_verification",
        tgas_used,
        &result,
        FollowUp::None,
    )?;

    // Buying grows the token tree, so the first and the last ticket of the event are measured.
    let buy = json!({ "event_id": event });
    let deposit = NearToken::from_yoctonear(NEAR);
    let tgas_used = client_tgas("buy_ticket");
    let result = escrow
        .call(&buyer, "buy_ticket", buy.clone(), deposit, tgas_used)
        .await?;
    let case = "buy_ticket (3rd ticket of the contract)";
    record(&mut rows, &escrow, case, tgas_used, &result, FollowUp::None)?;
    let mut fillers = 94;
    while fillers > 0 {
        let count = fillers.min(12);
        let calls = vec![("buy_ticket", buy.clone(), NEAR); count];
        escrow.batch(&buyer, calls).await?.assert_success();
        fillers -= count;
    }
    let calls = vec![("buy_ticket", buy.clone(), NEAR); 4];
    escrow.batch(&bouncer_a, calls).await?.assert_success();
    let mut tickets: Vec<String> = (96..=99)
        .map(|serial| format!("{event}-{serial}"))
        .collect();
    let result = escrow
        .call(&buyer, "buy_ticket", buy, deposit, tgas_used)
        .await?;
    let case = "buy_ticket (100th ticket of the event, 102nd of the contract)";
    record(&mut rows, &escrow, case, tgas_used, &result, FollowUp::None)?;

    // Two one-ticket events on the measured event's window, made after the purchases above so
    // those keep their place in the token tree. One is paid out at the minimum gas. Nobody
    // resolves the other: its deadline passes, and the claim of its ticket expires it.
    let paid_at_minimum = escrow
        .create_event(&organizer, largest(&verifier, times, 1))
        .await?;
    escrow.accept(&verifier, paid_at_minimum).await?;
    escrow.buy(&buyer, paid_at_minimum, NEAR).await?;
    let unresolved = escrow
        .create_event(&organizer, largest(&verifier, times, 1))
        .await?;
    escrow.accept(&verifier, unresolved).await?;
    tickets.push(escrow.buy(&bouncer_a, unresolved, NEAR).await?);

    // Full histories: five tickets move fifteen times between two accounts.
    for round in 0..15 {
        let (from, to) = if round % 2 == 0 {
            (&bouncer_a, &bouncer_b)
        } else {
            (&bouncer_b, &bouncer_a)
        };
        let calls = tickets
            .iter()
            .map(|token_id| ("nft_transfer", transfer_args(to, token_id, None), 1))
            .collect();
        escrow.batch(from, calls).await?.assert_success();
    }
    let [t1, t2, t3, t4, t5] = [
        &tickets[0],
        &tickets[1],
        &tickets[2],
        &tickets[3],
        &tickets[4],
    ];

    let args = transfer_args(&h1, t1, Some("m".repeat(256)));
    let tgas_used = client_tgas("nft_transfer");
    let result = escrow
        .call(&bouncer_b, "nft_transfer", args, ONE_YOCTO, tgas_used)
        .await?;
    let case = "nft_transfer (full history, longest memo)";
    record(&mut rows, &escrow, case, tgas_used, &result, FollowUp::None)?;
    let calls = vec![
        ("nft_transfer", transfer_args(&h2, t2, None), 1),
        (
            "nft_transfer",
            transfer_args(&vanishing_holder, t3, None),
            1,
        ),
        ("nft_transfer", transfer_args(&h3, t4, None), 1),
        ("nft_transfer", transfer_args(&h4, t5, None), 1),
    ];
    escrow.batch(&bouncer_b, calls).await?.assert_success();

    // Transfers to a contract. The longest msg is no mode the receiver knows, so it panics and
    // the resolver sends the ticket back: the resolver's most expensive path.
    let refuse = json!({
        "receiver_id": receiver.0, "token_id": t1, "approval_id": null,
        "memo": "m".repeat(256), "msg": "x".repeat(1024),
    });
    let minimum = GAS_TRANSFER_CALL_MIN.as_tgas();
    let result = escrow
        .call(&h1, "nft_transfer_call", refuse.clone(), ONE_YOCTO, minimum)
        .await?;
    let case = "nft_transfer_call at GAS_TRANSFER_CALL_MIN + nft_resolve_transfer (returned)";
    record(&mut rows, &escrow, case, minimum, &result, FollowUp::Next)?;
    let ticket = escrow.ticket(t1).await?;
    assert_eq!(
        ticket["owner_id"],
        h1.0.as_str(),
        "the resolver ran at the minimum"
    );
    assert_eq!(ticket["status"], "Active");
    let tgas_used = client_tgas("nft_transfer_call");
    let result = escrow
        .call(&h1, "nft_transfer_call", refuse, ONE_YOCTO, tgas_used)
        .await?;
    let case = "nft_transfer_call + nft_resolve_transfer (receiver panics, returned)";
    record(&mut rows, &escrow, case, tgas_used, &result, FollowUp::Next)?;
    let huge = json!({
        "receiver_id": receiver.0, "token_id": t1, "approval_id": null,
        "memo": "m".repeat(256), "msg": "huge",
    });
    let result = escrow
        .call(&h1, "nft_transfer_call", huge, ONE_YOCTO, HUGE_ANSWER_TGAS)
        .await?;
    // With this much gas the receiver can pay for the protocol's longest answer.
    let answer_bytes = result
        .receipt_outcomes()
        .iter()
        .filter(|outcome| outcome.executor_id == receiver.0)
        .find_map(|outcome| match outcome.clone().into_result() {
            Ok(ValueOrReceiptId::Value(value)) => value.raw_bytes().ok().map(|b| b.len()),
            _ => None,
        })
        .ok_or("the receiver returned no value")?;
    assert_eq!(answer_bytes, 4 * 1024 * 1024);
    let case = "nft_transfer_call + nft_resolve_transfer (4 MiB answer, returned)";
    record(
        &mut rows,
        &escrow,
        case,
        HUGE_ANSWER_TGAS,
        &result,
        FollowUp::Next,
    )?;
    assert_eq!(escrow.ticket(t1).await?["owner_id"], h1.0.as_str());
    let keep = json!({
        "receiver_id": receiver.0, "token_id": t1, "approval_id": null,
        "memo": "m".repeat(256), "msg": "keep",
    });
    let result = escrow
        .call(&h1, "nft_transfer_call", keep, ONE_YOCTO, tgas_used)
        .await?;
    let case = "nft_transfer_call + nft_resolve_transfer (receiver keeps)";
    record(&mut rows, &escrow, case, tgas_used, &result, FollowUp::Next)?;
    assert_eq!(escrow.ticket(t1).await?["owner_id"], receiver.0.as_str());

    // Outcomes with the longest texts, and payouts.
    chain.advance_to(short[1]).await?;
    let args = json!({ "event_id": paid, "evidence_ref": "e".repeat(256) });
    let tgas_used = client_tgas("attest_completed");
    let result = escrow
        .call(&verifier, "attest_completed", args, ONE_YOCTO, tgas_used)
        .await?;
    let case = "attest_completed (longest evidence)";
    record(&mut rows, &escrow, case, tgas_used, &result, FollowUp::None)?;
    escrow.attest(&verifier, vanished).await?;

    let args = json!({ "event_id": paid });
    let tgas_used = client_tgas("claim_payout");
    let result = escrow
        .call(&organizer, "claim_payout", args, ONE_YOCTO, tgas_used)
        .await?;
    let case = "claim_payout + on_payout_result (delivered)";
    let settled = FollowUp::Logged("payout_settled");
    record(&mut rows, &escrow, case, tgas_used, &result, settled)?;
    let args = json!({
        "ticket_contract": escrow.id(), "event_id": vanished, "beneficiary": stranger.0,
    });
    let result = chain
        .call(
            &vanishing_organizer,
            &vanishing_organizer.0,
            "collect_and_vanish",
            args,
            NO_DEPOSIT,
            FIXTURE_TGAS,
        )
        .await?;
    let case = "claim_payout + on_payout_result (transfer failed)";
    let failed = FollowUp::Logged("payout_failed");
    record(&mut rows, &escrow, case, FIXTURE_CALL_TGAS, &result, failed)?;

    chain.advance_to(short[2]).await?;
    let args = json!({ "event_id": expired });
    let tgas_used = client_tgas("expire_event");
    let result = escrow
        .call(&stranger, "expire_event", args, NO_DEPOSIT, tgas_used)
        .await?;
    record(
        &mut rows,
        &escrow,
        "expire_event",
        tgas_used,
        &result,
        FollowUp::None,
    )?;

    // Refunds of tickets with full histories.
    let args = json!({ "event_id": event, "reason_ref": "r".repeat(256) });
    let tgas_used = client_tgas("cancel_event");
    let result = escrow
        .call(&organizer, "cancel_event", args, ONE_YOCTO, tgas_used)
        .await?;
    let case = "cancel_event (longest reason)";
    record(&mut rows, &escrow, case, tgas_used, &result, FollowUp::None)?;

    let tgas_used = client_tgas("claim_refund");
    let result = escrow.claim_refund(&h2, t2, tgas_used).await?;
    let case = "claim_refund + on_refund_result (full history, delivered)";
    let settled = FollowUp::Logged("refund_settled");
    record(&mut rows, &escrow, case, tgas_used, &result, settled)?;
    let args = json!({ "ticket_contract": escrow.id(), "token_id": t3, "beneficiary": stranger.0 });
    let result = chain
        .call(
            &vanishing_holder,
            &vanishing_holder.0,
            "claim_and_vanish",
            args,
            NO_DEPOSIT,
            FIXTURE_TGAS,
        )
        .await?;
    let case = "claim_refund + on_refund_result (full history, transfer failed)";
    let failed = FollowUp::Logged("refund_failed");
    record(&mut rows, &escrow, case, FIXTURE_CALL_TGAS, &result, failed)?;
    let minimum = GAS_CLAIM_MIN.as_tgas();
    let result = escrow.claim_refund(&h3, t4, minimum).await?;
    let case = "claim_refund at GAS_CLAIM_MIN + on_refund_result (full history, delivered)";
    let settled = FollowUp::Logged("refund_settled");
    record(&mut rows, &escrow, case, minimum, &result, settled)?;
    assert_eq!(escrow.ticket(t4).await?["status"], "Refunded");

    // A payout at exactly the minimum.
    chain.advance_to(times[1]).await?;
    escrow.attest(&verifier, paid_at_minimum).await?;
    let args = json!({ "event_id": paid_at_minimum });
    let result = escrow
        .call(&organizer, "claim_payout", args, ONE_YOCTO, minimum)
        .await?;
    let case = "claim_payout at GAS_CLAIM_MIN + on_payout_result (delivered)";
    let settled = FollowUp::Logged("payout_settled");
    record(&mut rows, &escrow, case, minimum, &result, settled)?;
    let accounting = escrow.accounting(paid_at_minimum).await?;
    assert_eq!(amount(&accounting, "organizer_settled"), NEAR);

    // The deadline passes with no outcome; the claim resolves the event before it claims.
    chain.advance_to(times[2]).await?;
    assert_eq!(escrow.event(unresolved).await?["outcome"], "Unresolved");
    let result = escrow.claim_refund(&h4, t5, minimum).await?;
    let case = "claim_refund at GAS_CLAIM_MIN + on_refund_result (expires the event first, full history, delivered)";
    let settled = FollowUp::Logged("refund_settled");
    record(&mut rows, &escrow, case, minimum, &result, settled)?;
    let call_logs = &result
        .receipt_outcomes()
        .iter()
        .find(|outcome| outcome.executor_id == escrow.id())
        .ok_or("no escrow receipt")?
        .logs;
    assert!(
        call_logs
            .iter()
            .any(|line| line.contains("\"event\":\"event_resolved\"")),
        "the claim itself expired the event: {call_logs:?}"
    );
    assert_eq!(escrow.event(unresolved).await?["outcome"], "Refundable");
    assert_eq!(escrow.ticket(t5).await?["status"], "Refunded");

    eprintln!(
        "| Case | Gas attached (Tgas) | Call (Tgas) | Callback or resolver (Tgas) | Whole transaction (Tgas) |"
    );
    eprintln!("|---|---:|---:|---:|---:|");
    for row in &rows {
        let follow_up = row
            .follow_up
            .map_or("-".to_string(), |gas| format!("{:.2}", tgas(gas)));
        eprintln!(
            "| {} | {} | {:.2} | {} | {:.2} |",
            row.case,
            row.attached_tgas,
            tgas(row.call),
            follow_up,
            tgas(row.total)
        );
    }

    // What loading the longest possible answer into a register would cost the resolver if the
    // protocol charged its published per-byte fee in full.
    let write_register_byte = protocol_config(
        &chain,
        "/runtime_config/wasm_config/ext_costs/write_register_byte",
    )
    .await?;
    let longest_answer = protocol_config(
        &chain,
        "/runtime_config/wasm_config/limit_config/max_length_returned_data",
    )
    .await?;
    let read_longest_answer = write_register_byte * longest_answer;
    eprintln!(
        "write_register_byte {write_register_byte} gas x longest answer {longest_answer} bytes \
         = {:.2} Tgas",
        tgas(read_longest_answer)
    );

    for row in &rows {
        let Some(follow_up) = row.follow_up else {
            continue;
        };
        let (static_gas, minimum, need) = if row.case.starts_with("nft_transfer_call") {
            let need = (follow_up + read_longest_answer) * RESOLVER_MARGIN;
            (GAS_FOR_RESOLVE_TRANSFER, GAS_TRANSFER_CALL_MIN, need)
        } else {
            (GAS_FOR_CALLBACK, GAS_CLAIM_MIN, follow_up * MARGIN)
        };
        assert!(
            need <= static_gas.as_gas(),
            "{}: the follow-up burns {:.2} Tgas and the rule needs {:.2} of its {:.2}",
            row.case,
            tgas(follow_up),
            tgas(need),
            tgas(static_gas.as_gas())
        );
        assert!(
            static_gas.as_gas() + row.call * MARGIN <= minimum.as_gas(),
            "{}: the call burns {:.2} Tgas; its minimum is {:.2}",
            row.case,
            tgas(row.call),
            tgas(minimum.as_gas())
        );
    }
    Ok(())
}
