//! Storage in the sandbox (plan, Task C4): what the contract stores never costs more than the
//! events' prepaid budgets (R9), and each ticket's history stays bounded.

mod common;

use common::{
    Escrow, ONE_YOCTO, PRICE, STORAGE_BYTE_COST, TestChain, USD, amount, assert_purchase_accepted,
    long_id, priced_terms, purchase_msg, terms,
};
use near_api::{Account, AccountId, Contract};
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

/// Tickets in the full event of `t16`.
const CAPACITY: u32 = 10;

/// Nothing the contract stored since its deployment costs more than the operating budgets the
/// events prepaid.
async fn assert_within_budgets(
    escrow: &Escrow<'_>,
    deployed_bytes: u64,
    event_ids: &[u32],
    when: &str,
) -> TestResult<()> {
    let used = escrow.chain.storage_usage(&escrow.id()).await? - deployed_bytes;
    let mut budgets = 0;
    for event_id in event_ids {
        budgets += amount(&escrow.accounting(*event_id).await?, "operating_budget");
    }
    assert!(
        u128::from(used) * STORAGE_BYTE_COST <= budgets,
        "{when}: {used} bytes cost more than the budgets ({budgets} yoctoNEAR)"
    );
    Ok(())
}

/// How many storage entries of the escrow start with `prefix`.
async fn entries_with_prefix(escrow: &Escrow<'_>, prefix: &[u8]) -> TestResult<usize> {
    let state = Contract(escrow.id())
        .view_storage_with_prefix(prefix)
        .fetch_from(&escrow.chain.network)
        .await?;
    Ok(state.data.values.len())
}

/// The key prefix of one holder's entry in the token owner index (`tokens_per_owner`, prefix
/// `p`, keyed by the borsh account id).
fn owner_index_key(account_id: &AccountId) -> Vec<u8> {
    let id = account_id.as_str().as_bytes();
    let mut key = vec![b'p'];
    key.extend(u32::try_from(id.len()).expect("short").to_le_bytes());
    key.extend(id);
    key
}

#[tokio::test]
async fn t16_storage_stays_within_budget() -> TestResult {
    // The fault-injection build leaves every refund and the payout pending, so their operation
    // records stay stored: the most a ticket and an event can hold.
    let chain = TestChain::start().await?;
    let escrow = chain.faulty_escrow("faulty.sandbox").await?;
    let deployed_bytes = chain.storage_usage(&escrow.id()).await?;

    let names: Vec<String> = ["organizer", "verifier", "bouncer-a", "bouncer-b", "buyer"]
        .iter()
        .map(|name| long_id(name))
        .chain((1..=CAPACITY).map(|i| long_id(&format!("holder-{i}"))))
        .collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let mut accounts = chain.accounts(&refs, 30).await?.into_iter();
    let mut next = || accounts.next().ok_or("an account is missing");
    let (organizer, verifier, bouncer_a, bouncer_b, buyer) =
        (next()?, next()?, next()?, next()?, next()?);
    let holders: Vec<Account> = (0..CAPACITY).map(|_| next()).collect::<Result<_, _>>()?;

    let largest = |times: [u64; 3], capacity: u32| {
        let mut terms = terms(&verifier, times, capacity);
        terms["title"] = json!("t".repeat(120));
        terms["venue"] = json!("v".repeat(120));
        terms
    };
    let mut event_ids = Vec::new();

    // An event of one ticket that will be completed and leave its payout pending.
    let times = chain.times_from_now([20, 25, 3_000]).await?;
    let paid_event = escrow.create_event(&organizer, largest(times, 1)).await?;
    event_ids.push(paid_event);
    escrow.accept(&verifier, paid_event).await?;
    let _ = escrow.buy(&buyer, paid_event, PRICE).await?;
    assert_within_budgets(&escrow, deployed_bytes, &event_ids, "first event").await?;

    // A full event: every ticket bought, moved twenty times and finally given to a holder of
    // its own.
    let times = chain.times_from_now([900, 1_200, 1_800]).await?;
    let full_event = escrow
        .create_event(&organizer, largest(times, CAPACITY))
        .await?;
    event_ids.push(full_event);
    escrow.accept(&verifier, full_event).await?;
    let buys = (0..CAPACITY)
        .map(|_| ("buy_ticket", json!({ "event_id": full_event }), PRICE))
        .collect();
    escrow.batch(&bouncer_a, buys).await?.assert_success();
    assert_within_budgets(&escrow, deployed_bytes, &event_ids, "sold out").await?;
    let token_ids: Vec<String> = (1..=CAPACITY)
        .map(|serial| format!("{full_event}-{serial}"))
        .collect();
    let transfers = |to: &Account| -> Vec<(&str, Value, u128)> {
        token_ids
            .iter()
            .map(|token_id| {
                let args = json!({
                    "receiver_id": to.0, "token_id": token_id, "approval_id": null,
                    "memo": "m".repeat(256),
                });
                ("nft_transfer", args, 1)
            })
            .collect()
    };
    for round in 0..19 {
        let (from, to) = if round % 2 == 0 {
            (&bouncer_a, &bouncer_b)
        } else {
            (&bouncer_b, &bouncer_a)
        };
        escrow.batch(from, transfers(to)).await?.assert_success();
        assert_within_budgets(&escrow, deployed_bytes, &event_ids, "moving tickets").await?;
    }
    let to_holders = token_ids
        .iter()
        .zip(&holders)
        .map(|(token_id, holder)| {
            let args = json!({
                "receiver_id": holder.0, "token_id": token_id, "approval_id": null, "memo": null,
            });
            ("nft_transfer", args, 1)
        })
        .collect();
    escrow.batch(&bouncer_b, to_holders).await?.assert_success();
    assert_within_budgets(&escrow, deployed_bytes, &event_ids, "one holder each").await?;

    // The bouncers hold nothing now, and their owner index entries are gone: one entry per
    // holder remains, and two inner entries (index and element) per ticket held.
    for bouncer in [&bouncer_a, &bouncer_b] {
        assert_eq!(
            entries_with_prefix(&escrow, &owner_index_key(&bouncer.0)).await?,
            0,
            "{} still has an owner index",
            bouncer.0
        );
    }
    let holders_now = CAPACITY as usize + 1;
    assert_eq!(entries_with_prefix(&escrow, b"p").await?, holders_now);
    // Inner keys of every owner set start with the borsh tag of `TokensPerOwner` (0) and the
    // length of its 32-byte hash.
    assert_eq!(
        entries_with_prefix(&escrow, &[0, 32, 0, 0, 0]).await?,
        2 * holders_now
    );

    // Outcomes with the longest texts, then every operation left pending.
    chain
        .advance_to(times_end(&escrow, paid_event).await?)
        .await?;
    let evidence = json!({ "event_id": paid_event, "evidence_ref": "e".repeat(256) });
    escrow
        .call(&verifier, "attest_completed", evidence, ONE_YOCTO, 100)
        .await?
        .assert_success();
    let _ = escrow.claim_payout(&organizer, paid_event).await?;
    let accounting = escrow.accounting(paid_event).await?;
    assert_eq!(
        amount(&accounting, "organizer_pending"),
        PRICE,
        "the payout stays pending"
    );
    assert_within_budgets(&escrow, deployed_bytes, &event_ids, "payout pending").await?;

    let reason = json!({ "event_id": full_event, "reason_ref": "r".repeat(256) });
    escrow
        .call(&organizer, "cancel_event", reason, ONE_YOCTO, 100)
        .await?
        .assert_success();
    for (token_id, holder) in token_ids.iter().zip(&holders) {
        let _ = escrow.claim_refund(holder, token_id, 100).await?;
        assert_within_budgets(&escrow, deployed_bytes, &event_ids, "refunds pending").await?;
    }
    for (token_id, holder) in token_ids.iter().zip(&holders) {
        let ticket = escrow.ticket(token_id).await?;
        assert_eq!(ticket["status"], "RefundPending");
        assert_eq!(ticket["owner_id"], holder.0.as_str());
        let history = escrow.history(token_id).await?;
        assert_eq!(history["entries"].as_array().map(Vec::len), Some(16));
        // The purchase, 20 transfers and the refund request: 22 entries, 16 kept.
        assert_eq!(history["dropped"], 6);
    }

    let used = chain.storage_usage(&escrow.id()).await? - deployed_bytes;
    let mut budgets = 0;
    for event_id in &event_ids {
        budgets += amount(&escrow.accounting(*event_id).await?, "operating_budget");
    }
    eprintln!(
        "t16: {used} bytes stored for {} bytes of budget",
        budgets / STORAGE_BYTE_COST
    );
    Ok(())
}

/// The end of an event, from `get_event`.
async fn times_end(escrow: &Escrow<'_>, event_id: u32) -> TestResult<u64> {
    escrow.event(event_id).await?["ends_at_ms"]
        .as_u64()
        .ok_or_else(|| "no ends_at_ms".into())
}

#[tokio::test]
async fn history_keeps_first_and_latest() -> TestResult {
    let chain = TestChain::start().await?;
    let cast = chain.cast().await?;
    let escrow = chain.escrow().await?;
    let times = chain.times_from_now([600, 1_200, 1_800]).await?;
    let event_id = escrow
        .create_event(&cast.organizer, terms(&cast.verifier, times, 3))
        .await?;
    escrow.accept(&cast.verifier, event_id).await?;
    let token_id = escrow.buy(&cast.ana, event_id, PRICE).await?;

    let mut holder = &cast.ana;
    for _ in 0..20 {
        let next = if holder.0 == cast.ana.0 {
            &cast.luis
        } else {
            &cast.ana
        };
        escrow
            .transfer(holder, &next.0, &token_id)
            .await?
            .assert_success();
        holder = next;
    }

    let history = escrow.history(&token_id).await?;
    let entries = history["entries"].as_array().ok_or("no entries")?;
    assert_eq!(entries.len(), 16);
    assert_eq!(history["dropped"], 5);
    assert_eq!(entries[0]["kind"], "Purchased");
    assert_eq!(entries[0]["account_id"], cast.ana.0.as_str());
    // The latest fifteen are transfers 6 to 20, oldest first: Luis after odd ones, Ana after
    // even ones.
    for (offset, entry) in entries[1..].iter().enumerate() {
        let transfer = offset + 6;
        let to = if transfer % 2 == 1 {
            &cast.luis
        } else {
            &cast.ana
        };
        assert_eq!(entry["kind"], "Transferred");
        assert_eq!(entry["account_id"], to.0.as_str(), "transfer {transfer}");
    }
    let times_ms: Vec<u64> = entries.iter().filter_map(|e| e["at_ms"].as_u64()).collect();
    assert!(
        times_ms.windows(2).all(|pair| pair[0] <= pair[1]),
        "oldest first"
    );
    assert_eq!(
        escrow.ticket(&token_id).await?["owner_id"],
        holder.0.as_str()
    );
    Ok(())
}

/// Bytes the escrow stores now.
async fn usage(escrow: &Escrow<'_>) -> TestResult<i64> {
    Ok(i64::try_from(
        escrow.chain.storage_usage(&escrow.id()).await?,
    )?)
}

/// `buyer` buys a ticket of `event_id` in NEAR, or in `token` when it is given.
async fn buy_in(
    escrow: &Escrow<'_>,
    token: Option<&common::Token<'_>>,
    buyer: &Account,
    event_id: u32,
) -> TestResult<()> {
    match token {
        None => {
            escrow.buy(buyer, event_id, PRICE).await?;
        }
        Some(token) => {
            let result = token
                .transfer_call(buyer, &escrow.id(), USD, &purchase_msg(event_id))
                .await?;
            assert_purchase_accepted(&result, USD);
        }
    }
    Ok(())
}

#[tokio::test]
async fn storage_of_a_token_event_and_ticket() -> TestResult {
    // Plan v2, Task T3: what an event priced in a token with a 64-character id, and one of its
    // tickets, store in the worst case, next to the same event and ticket in NEAR. The
    // fault-injection build keeps every refund and payout pending, so their records stay.
    // `cargo test --test storage storage_of_a_token -- --nocapture` prints the table.
    let chain = TestChain::start().await?;
    let currency = long_id("tusd");
    let tokens = json!([{ "account_id": currency, "symbol": "tUSD", "decimals": 6 }]);
    let contract = chain
        .deploy_escrow_listing("faulty.sandbox", true, tokens)
        .await?;
    let escrow = Escrow {
        chain: &chain,
        contract,
    };
    let tusd = chain.test_token(&currency, "tUSD", 6).await?;
    let names: Vec<String> = [
        "organizer",
        "verifier",
        "near-buyer",
        "near-bouncer-a",
        "near-bouncer-b",
        "near-holder",
        "near-payer",
        "tusd-buyer",
        "tusd-bouncer-a",
        "tusd-bouncer-b",
        "tusd-holder",
        "tusd-payer",
    ]
    .iter()
    .map(|name| long_id(name))
    .collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let people = chain.accounts(&refs, 30).await?;
    let [organizer, verifier, rest @ ..] = people.as_slice() else {
        return Err("twelve accounts".into());
    };
    let (near_side, tusd_side) = rest.split_at(5);
    tusd.register(organizer, &escrow.id()).await?;
    for person in [&tusd_side[0], &tusd_side[4]] {
        tusd.register(person, &person.0).await?;
        tusd.faucet(person).await?;
    }
    let price = |currency: Option<&str>| if currency.is_some() { USD } else { PRICE };
    let largest = |times: [u64; 3], currency: Option<&str>| {
        let mut terms = priced_terms(verifier, times, 1, currency, price(currency));
        terms["title"] = json!("t".repeat(120));
        terms["venue"] = json!("v".repeat(120));
        terms
    };
    let times = chain.times_from_now([900, 910, 3_000]).await?;
    let mut rows: Vec<(&str, i64, i64)> = Vec::new();
    let mut refund_events = [0; 2];
    let mut paid_events = [0; 2];
    let mut tickets = [String::new(), String::new()];
    let mut deltas = [[0i64; 7]; 2];
    let sides = [(None, near_side), (Some(currency.as_str()), tusd_side)];
    for (side, (currency, people)) in sides.into_iter().enumerate() {
        let [buyer, bouncer_a, bouncer_b, holder, payer] = people else {
            return Err("five accounts a side".into());
        };
        let token = currency.map(|_| &tusd);
        let before = usage(&escrow).await?;
        let created = escrow
            .create_event(organizer, largest(times, currency))
            .await?;
        deltas[side][0] = usage(&escrow).await? - before;
        refund_events[side] = created;
        escrow.accept(verifier, created).await?;
        let paid = escrow
            .create_event(organizer, largest(times, currency))
            .await?;
        escrow.accept(verifier, paid).await?;
        paid_events[side] = paid;

        let before = usage(&escrow).await?;
        buy_in(&escrow, token, buyer, created).await?;
        deltas[side][1] = usage(&escrow).await? - before;
        buy_in(&escrow, token, payer, paid).await?;

        // Twenty moves with the longest memo, then a holder of its own.
        let token_id = format!("{created}-1");
        let before = usage(&escrow).await?;
        let mut from = buyer;
        for round in 0..20 {
            let to = if round % 2 == 0 { bouncer_a } else { bouncer_b };
            let args = json!({
                "receiver_id": to.0, "token_id": token_id, "approval_id": null,
                "memo": "m".repeat(256),
            });
            escrow
                .call(from, "nft_transfer", args, ONE_YOCTO, 100)
                .await?
                .assert_success();
            from = to;
        }
        escrow
            .transfer(from, &holder.0, &token_id)
            .await?
            .assert_success();
        deltas[side][2] = usage(&escrow).await? - before;
        tickets[side] = token_id;
    }

    // Outcomes with the longest texts, then every refund and payout left pending.
    for side in 0..2 {
        let reason = json!({ "event_id": refund_events[side], "reason_ref": "r".repeat(256) });
        let before = usage(&escrow).await?;
        escrow
            .call(organizer, "cancel_event", reason, ONE_YOCTO, 100)
            .await?
            .assert_success();
        deltas[side][3] = usage(&escrow).await? - before;
        let holder = if side == 0 {
            &near_side[3]
        } else {
            &tusd_side[3]
        };
        let before = usage(&escrow).await?;
        let _ = escrow.claim_refund(holder, &tickets[side], 100).await?;
        deltas[side][4] = usage(&escrow).await? - before;
        assert_eq!(
            escrow.ticket(&tickets[side]).await?["status"],
            "RefundPending"
        );
    }
    chain.advance_to(times[1]).await?;
    for side in 0..2 {
        let evidence = json!({ "event_id": paid_events[side], "evidence_ref": "e".repeat(256) });
        let before = usage(&escrow).await?;
        escrow
            .call(verifier, "attest_completed", evidence, ONE_YOCTO, 100)
            .await?
            .assert_success();
        deltas[side][5] = usage(&escrow).await? - before;
        let before = usage(&escrow).await?;
        let _ = escrow.claim_payout(organizer, paid_events[side]).await?;
        deltas[side][6] = usage(&escrow).await? - before;
        let accounting = escrow.accounting(paid_events[side]).await?;
        assert!(
            amount(&accounting, "organizer_pending") > 0,
            "the payout stays pending"
        );
    }

    let steps = [
        "create_event (capacity 1, longest title and venue)",
        "buy (a holder of its own)",
        "twenty transfers, then a holder of its own (full history)",
        "cancel_event (longest reason)",
        "claim_refund left pending",
        "attest_completed (longest evidence)",
        "claim_payout left pending",
    ];
    for (index, step) in steps.iter().enumerate() {
        rows.push((step, deltas[0][index], deltas[1][index]));
    }
    // An event's worst case: its record, its outcome and a payout in flight. A ticket's: its
    // purchase, a full history and a refund in flight. The ticket id here is `N-1`; the longest
    // (`4294967295-100`) is 11 bytes longer and is stored six times
    // (`docs/decisions/2026-11-13-measured-storage-and-gas-constants.md`).
    let event_bytes = |d: &[i64; 7]| d[0] + d[3].max(d[5]) + d[6];
    let ticket_bytes = |d: &[i64; 7]| d[1] + d[2] + d[4] + 6 * 11;
    eprintln!("| Step | NEAR event (bytes) | tUSD event, 64-character id (bytes) | Difference |");
    eprintln!("|---|---:|---:|---:|");
    for (step, near, token) in &rows {
        eprintln!("| {step} | {near} | {token} | {} |", token - near);
    }
    let (near_event, token_event) = (event_bytes(&deltas[0]), event_bytes(&deltas[1]));
    let (near_ticket, token_ticket) = (ticket_bytes(&deltas[0]), ticket_bytes(&deltas[1]));
    eprintln!(
        "| Worst event | {near_event} | {token_event} | {} |",
        token_event - near_event
    );
    eprintln!(
        "| Worst ticket, longest id | {near_ticket} | {token_ticket} | {} |",
        token_ticket - near_ticket
    );
    eprintln!(
        "constants: STORAGE_BYTES_PER_EVENT {} STORAGE_BYTES_PER_TICKET {}",
        ticket_escrow::STORAGE_BYTES_PER_EVENT,
        ticket_escrow::STORAGE_BYTES_PER_TICKET
    );

    // The currency is stored once, in the event record: its Borsh `Option<String>` is 68 bytes
    // longer for a 64-character id than `None`. Nothing else differs.
    assert_eq!(
        deltas[1][0] - deltas[0][0],
        68,
        "the currency in the event record"
    );
    for index in 1..7 {
        assert_eq!(deltas[1][index], deltas[0][index], "{}", steps[index]);
    }
    // And the prepaid budget covers both worst cases.
    assert!(i128::from(token_event) <= i128::try_from(ticket_escrow::STORAGE_BYTES_PER_EVENT)?);
    assert!(i128::from(token_ticket) <= i128::try_from(ticket_escrow::STORAGE_BYTES_PER_TICKET)?);
    Ok(())
}
