//! Events priced in a NEP-141 token (plan v2, "Currencies"): the two token fixtures first (Task
//! T1), then the escrow's money path in a token (Task T2).

mod common;

use common::{
    Call, Cast, Escrow, GAS_FEE_BOUND, HOST, HOSTILE_ID, NEAR, NO_DEPOSIT, ONE_YOCTO, PRICE,
    STORAGE_BYTE_COST, TEUR_ID, TUSD_ID, TestChain, Token, TokenMove, Transfer, UNLISTED_ID, USD,
    amount, assert_fails_with, assert_purchase_accepted, assert_purchase_rejected, events_named,
    failed_receipts_on, failure_text, nep171_events, priced_terms, purchase_msg,
    receipt_failure_texts, token_moves, value_returned_by, vanishing_holder_wasm,
};
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{Account, AccountId, NearToken};
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD as BASE64;
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

/// The price of a ticket in tUSD: 10 whole tUSD.
const TUSD_PRICE: u128 = 10 * USD;
/// Gas for a call into a fixture that then calls the escrow, in Tgas.
const FIXTURE_TGAS: u64 = 300;
/// Gas of a claim, as the client attaches it, in Tgas.
const CLAIM_TGAS: u64 = 100;

#[tokio::test]
async fn test_token_registers_and_gives_from_its_faucet() -> TestResult {
    let chain = TestChain::start().await?;
    let token = chain.test_token(TUSD_ID, "tUSD", 6).await?;
    let [ana, luis]: [near_api::Account; 2] = chain
        .accounts(&["ana.sandbox", "luis.sandbox"], 10)
        .await?
        .try_into()
        .map_err(|_| "two accounts")?;

    let metadata: Value = token.view("ft_metadata", json!({})).await?;
    assert_eq!(metadata["spec"], "ft-1.0.0");
    assert_eq!(metadata["name"], "Test tUSD");
    assert_eq!(metadata["symbol"], "tUSD");
    assert_eq!(metadata["decimals"], 6);

    // The faucet serves only registered accounts.
    let result = token
        .call(&ana, "faucet", json!({}), NO_DEPOSIT, 30)
        .await?;
    let failure = failure_text(&result).ok_or("the faucet served an unregistered account")?;
    assert!(
        failure.contains("register with storage_deposit"),
        "{failure}"
    );
    assert!(!token.is_registered(&ana.0).await?);

    token.register(&ana, &ana.0).await?;
    assert!(token.is_registered(&ana.0).await?);
    assert_eq!(token.faucet(&ana).await?, 100_000_000, "100 whole units");
    assert_eq!(token.balance_of(&ana.0).await?, 100_000_000);
    let supply: String = token.view("ft_total_supply", json!({})).await?;
    assert_eq!(supply, "100000000");

    // A transfer to an account that is not registered fails and moves nothing.
    let result = token.transfer(&ana, &luis.0, 2_500_000).await?;
    let failure = failure_text(&result).ok_or("a transfer reached an unregistered account")?;
    assert!(failure.contains("is not registered"), "{failure}");
    assert_eq!(token.balance_of(&ana.0).await?, 100_000_000);

    // Anybody can register someone else.
    token.register(&ana, &luis.0).await?;
    let result = token.transfer(&ana, &luis.0, 2_500_000).await?;
    assert_eq!(
        token_moves(&result, &token.id),
        [TokenMove {
            from: ana.0.to_string(),
            to: luis.0.to_string(),
            amount: 2_500_000
        }]
    );
    assert_eq!(token.balance_of(&ana.0).await?, 97_500_000);
    assert_eq!(token.balance_of(&luis.0).await?, 2_500_000);
    Ok(())
}

#[tokio::test]
async fn hostile_token_fails_answers_garbage_and_forges() -> TestResult {
    let chain = TestChain::start().await?;
    let token = chain.hostile_token(HOSTILE_ID, "HOST", 18).await?;
    let [ana, luis]: [near_api::Account; 2] = chain
        .accounts(&["ana.sandbox", "luis.sandbox"], 10)
        .await?
        .try_into()
        .map_err(|_| "two accounts")?;
    token.register(&ana, &ana.0).await?;
    token.register(&ana, &luis.0).await?;
    token.mint(&luis, &ana.0, 10 * NEAR).await?;
    assert_eq!(token.balance_of(&ana.0).await?, 10 * NEAR);

    // `normal`: the standard token.
    let result = token.transfer(&ana, &luis.0, NEAR).await?;
    assert_eq!(token_moves(&result, &token.id).len(), 1);
    assert_eq!(value_returned_by(&result, &token.id), Some(Vec::new()));
    assert_eq!(token.balance_of(&luis.0).await?, NEAR);

    // `fail`: every transfer panics and nothing moves.
    token.set_mode(&luis, "fail").await?;
    let result = token.transfer(&ana, &luis.0, NEAR).await?;
    let failure = failure_text(&result).ok_or("a failing token transferred")?;
    assert!(
        failure.contains("this token fails every transfer"),
        "{failure}"
    );
    let result = token.transfer_call(&ana, &luis.0, NEAR, "").await?;
    assert!(
        failure_text(&result).is_some(),
        "ft_transfer_call fails too"
    );
    assert_eq!(token.balance_of(&ana.0).await?, 9 * NEAR);

    // `garbage`: the tokens move, then the answer is not JSON.
    token.set_mode(&luis, "garbage").await?;
    let result = token.transfer(&ana, &luis.0, NEAR).await?;
    assert_eq!(token_moves(&result, &token.id).len(), 1);
    assert_eq!(
        value_returned_by(&result, &token.id),
        Some(b"maybe".to_vec())
    );

    // `long`: the tokens move, then the answer is as long as the gas allows.
    token.set_mode(&luis, "long").await?;
    let result = token.transfer(&ana, &luis.0, NEAR).await?;
    assert_eq!(token_moves(&result, &token.id).len(), 1);
    let answer = value_returned_by(&result, &token.id).ok_or("no answer")?;
    assert!(answer.len() > 100_000, "{} bytes", answer.len());
    assert!(answer.iter().all(|byte| *byte == 0));
    assert_eq!(token.balance_of(&luis.0).await?, 3 * NEAR);

    // A forged `ft_on_transfer` reaches its target with any sender, amount and message, and moves
    // no token.
    token.set_mode(&luis, "normal").await?;
    let result = token
        .forge_on_transfer(&ana, &luis.0, &ana.0, 5 * NEAR, "{\"event_id\":1}")
        .await?;
    assert!(token_moves(&result, &token.id).is_empty());
    let calls = chain.calls_from(&result, &token.id).await?;
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0].receiver, luis.0.as_str());
    assert_eq!(calls[0].method, "ft_on_transfer");
    assert_eq!(calls[0].deposit, 0);
    assert_eq!(
        calls[0].args,
        json!({ "sender_id": ana.0, "amount": (5 * NEAR).to_string(), "msg": "{\"event_id\":1}" })
    );
    // Luis has no contract, so the forged call itself fails.
    assert!(!calls[0].succeeded);
    assert_eq!(token.balance_of(&ana.0).await?, 7 * NEAR);
    Ok(())
}

// The escrow's money path in a token (Task T2). Every test deploys only the token contracts it
// needs, at the ids the escrow lists (`common::listed_tokens`), and registers the escrow with
// them, as a deployment must before sales.

/// Deploys the listed token `id` (tUSD, tEUR or HOST) or the unlisted one, and registers each of
/// `escrows` with it.
async fn token<'a>(
    chain: &'a TestChain,
    id: &str,
    escrows: &[&Escrow<'_>],
    payer: &Account,
) -> TestResult<Token<'a>> {
    let token = match id {
        TUSD_ID => chain.test_token(id, "tUSD", 6).await?,
        TEUR_ID => chain.test_token(id, "tEUR", 24).await?,
        HOSTILE_ID => chain.hostile_token(id, "HOST", 18).await?,
        UNLISTED_ID => chain.hostile_token(id, "FAKE", 6).await?,
        other => return Err(format!("no token is planned at {other}").into()),
    };
    for escrow in escrows {
        token.register(payer, &escrow.id()).await?;
    }
    Ok(token)
}

/// Registers `account` with the token and gives it 100 whole units: from the faucet of a test
/// token, minted by a hostile one.
async fn fund(token: &Token<'_>, account: &Account) -> TestResult<u128> {
    token.register(account, &account.0).await?;
    let decimals = token.view::<Value>("ft_metadata", json!({})).await?["decimals"]
        .as_u64()
        .ok_or("no decimals")?;
    let hundred = 100 * 10u128.pow(u32::try_from(decimals)?);
    if token.id.as_str() == TUSD_ID || token.id.as_str() == TEUR_ID {
        assert_eq!(token.faucet(account).await?, hundred);
    } else {
        token.mint(account, &account.0, hundred).await?;
    }
    Ok(hundred)
}

/// An event priced in `currency` (`None` is NEAR) and accepted by its verifier, with start, end
/// and deadline `offsets_s` seconds from now.
async fn on_sale(
    escrow: &Escrow<'_>,
    cast: &Cast,
    offsets_s: [u64; 3],
    capacity: u32,
    currency: Option<&str>,
    price: u128,
) -> TestResult<(u32, [u64; 3])> {
    let times = escrow.chain.times_from_now(offsets_s).await?;
    let terms = priced_terms(&cast.verifier, times, capacity, currency, price);
    let event_id = escrow.create_event(&cast.organizer, terms).await?;
    escrow.accept(&cast.verifier, event_id).await?;
    Ok((event_id, times))
}

/// `buyer` buys a ticket of `event_id` for `price` through the token; returns its id.
async fn buy_with(
    token: &Token<'_>,
    escrow: &Escrow<'_>,
    buyer: &Account,
    event_id: u32,
    price: u128,
) -> TestResult<String> {
    let result = token
        .transfer_call(buyer, &escrow.id(), price, &purchase_msg(event_id))
        .await?;
    Ok(assert_purchase_accepted(&result, price))
}

/// The `ft_transfer` calls the escrow made in a transaction.
async fn ft_transfers_by(
    escrow: &Escrow<'_>,
    result: &ExecutionFinalResult,
) -> TestResult<Vec<Call>> {
    Ok(escrow
        .chain
        .calls_from(result, &escrow.id())
        .await?
        .into_iter()
        .filter(|call| call.method == "ft_transfer")
        .collect())
}

/// Asserts that the escrow sent `amount` of `token` to `to` with one `ft_transfer` that carried
/// 1 yoctoNEAR and no memo, and that `succeeded` says whether it went through.
async fn assert_one_ft_transfer(
    escrow: &Escrow<'_>,
    result: &ExecutionFinalResult,
    token: &str,
    to: &AccountId,
    amount: u128,
    succeeded: bool,
) -> TestResult<()> {
    let calls = ft_transfers_by(escrow, result).await?;
    assert_eq!(
        calls,
        [Call {
            receiver: token.to_string(),
            method: "ft_transfer".to_string(),
            args: json!({ "receiver_id": to, "amount": amount.to_string(), "memo": null }),
            deposit: 1,
            succeeded,
        }],
        "one ft_transfer to {to}"
    );
    Ok(())
}

/// Makes a fixture call `method` on `receiver` with `args`, as if it were a person.
async fn forward(
    chain: &TestChain,
    fixture: &Account,
    receiver: &AccountId,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> TestResult<ExecutionFinalResult> {
    let args = json!({
        "receiver_id": receiver,
        "method_name": method,
        "args": args.to_string(),
    });
    chain
        .call(fixture, &fixture.0, "forward", args, deposit, FIXTURE_TGAS)
        .await
}

/// The kinds of a ticket's history entries, oldest first.
async fn history_kinds(escrow: &Escrow<'_>, token_id: &str) -> TestResult<Vec<String>> {
    let history = escrow.history(token_id).await?;
    Ok(history["entries"]
        .as_array()
        .ok_or("no entries")?
        .iter()
        .filter_map(|entry| entry["kind"].as_str().map(str::to_string))
        .collect())
}

/// The total ticket supply of the escrow.
async fn supply(escrow: &Escrow<'_>) -> TestResult<u128> {
    let total: String = escrow.view("nft_total_supply", json!({})).await?;
    Ok(total.parse()?)
}

#[tokio::test]
async fn t25_token_purchase_reserves_exact_price() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow], &cast.mallory).await?;
    let funds = fund(&tusd, &cast.ana).await?;
    let (event_id, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        2,
        Some(TUSD_ID),
        TUSD_PRICE,
    )
    .await?;
    let event = escrow.event(event_id).await?;
    assert_eq!(event["currency"], TUSD_ID);
    assert_eq!(event["price"], TUSD_PRICE.to_string());

    // Any other amount is rejected, and every token comes back.
    for wrong in [TUSD_PRICE - 1, TUSD_PRICE + 1, 1] {
        let result = tusd
            .transfer_call(&cast.ana, &escrow.id(), wrong, &purchase_msg(event_id))
            .await?;
        assert_purchase_rejected(&result, &escrow.id(), "ERR_WRONG_DEPOSIT");
        assert_eq!(
            tusd.balance_of(&cast.ana.0).await?,
            funds,
            "{wrong}: all back"
        );
        assert_eq!(tusd.balance_of(&escrow.id()).await?, 0);
    }
    assert_eq!(supply(&escrow).await?, 0, "no ticket");
    assert_eq!(escrow.event(event_id).await?["sold"], 0);
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "principal_received"), 0);

    // The exact price buys the ticket, and the whole price stays in the contract.
    let near_before = chain.balance(&cast.ana.0).await?;
    let result = tusd
        .transfer_call(&cast.ana, &escrow.id(), TUSD_PRICE, &purchase_msg(event_id))
        .await?;
    let token_id = assert_purchase_accepted(&result, TUSD_PRICE);
    assert_eq!(token_id, format!("{event_id}-1"));
    let purchased = &events_named(&result, "ticket_purchased")[0];
    assert_eq!(purchased["standard"], "ticket_escrow");
    assert_eq!(purchased["version"], "2.0.0");
    assert_eq!(purchased["data"][0]["currency"], TUSD_ID);
    assert_eq!(
        nep171_events(&result, "nft_mint"),
        vec![json!({ "owner_id": cast.ana.0, "token_ids": [token_id] })]
    );
    assert_eq!(
        token_moves(&result, &tusd.id),
        [TokenMove {
            from: cast.ana.0.to_string(),
            to: escrow.id().to_string(),
            amount: TUSD_PRICE
        }],
        "the price moved once, and nothing came back"
    );
    assert_eq!(tusd.balance_of(&cast.ana.0).await?, funds - TUSD_PRICE);
    assert_eq!(tusd.balance_of(&escrow.id()).await?, TUSD_PRICE);
    let near_spent = near_before - chain.balance(&cast.ana.0).await?;
    assert!(
        near_spent < GAS_FEE_BOUND,
        "Ana paid only gas in NEAR: {near_spent}"
    );

    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["owner_id"], cast.ana.0.as_str());
    assert_eq!(ticket["principal"], TUSD_PRICE.to_string());
    assert_eq!(ticket["currency"], TUSD_ID);
    assert_eq!(ticket["status"], "Active");
    assert_eq!(ticket["claim"], "Reserved");
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(accounting["currency"], TUSD_ID);
    assert_eq!(amount(&accounting, "principal_received"), TUSD_PRICE);
    assert_eq!(amount(&accounting, "principal_reserved"), TUSD_PRICE);
    assert_eq!(escrow.event(event_id).await?["sold"], 1);
    assert_eq!(supply(&escrow).await?, 1);
    Ok(())
}

#[tokio::test]
async fn rejected_token_purchases_return_every_token() -> TestResult {
    // Every rule of a purchase (R4) holds for a purchase in a token, and each refusal sends the
    // whole amount back to the buyer with no ticket.
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow], &cast.mallory).await?;
    let funds = fund(&tusd, &cast.ana).await?;
    fund(&tusd, &cast.luis).await?;
    let times = chain.times_from_now([600, 1_200, 1_800]).await?;
    let terms = priced_terms(&cast.verifier, times, 1, Some(TUSD_ID), TUSD_PRICE);
    let unaccepted = escrow.create_event(&cast.organizer, terms).await?;
    let (one_seat, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        1,
        Some(TUSD_ID),
        TUSD_PRICE,
    )
    .await?;
    let (soon, soon_times) =
        on_sale(&escrow, &cast, [30, 60, 600], 3, Some(TUSD_ID), TUSD_PRICE).await?;

    let attempt = |msg: String| {
        let tusd = &tusd;
        let escrow = &escrow;
        let ana = &cast.ana;
        async move {
            tusd.transfer_call(ana, &escrow.id(), TUSD_PRICE, &msg)
                .await
        }
    };
    let mut cases: Vec<(String, &str)> = vec![
        ("not json".to_string(), "ERR_BAD_MESSAGE"),
        (String::new(), "ERR_BAD_MESSAGE"),
        ("{}".to_string(), "ERR_BAD_MESSAGE"),
        (json!({ "event_id": "one" }).to_string(), "ERR_BAD_MESSAGE"),
        (purchase_msg(999), "ERR_NOT_FOUND"),
        (purchase_msg(unaccepted), "ERR_NOT_ACCEPTED"),
    ];
    for (msg, code) in cases.drain(..) {
        let result = attempt(msg.clone()).await?;
        assert_purchase_rejected(&result, &escrow.id(), code);
        assert_eq!(
            tusd.balance_of(&cast.ana.0).await?,
            funds,
            "{msg}: all back"
        );
    }

    // Sold out.
    buy_with(&tusd, &escrow, &cast.luis, one_seat, TUSD_PRICE).await?;
    let result = attempt(purchase_msg(one_seat)).await?;
    assert_purchase_rejected(&result, &escrow.id(), "ERR_SOLD_OUT");
    assert_eq!(tusd.balance_of(&cast.ana.0).await?, funds);

    // At the start and after it.
    chain.advance_to(soon_times[0]).await?;
    let result = attempt(purchase_msg(soon)).await?;
    assert_purchase_rejected(&result, &escrow.id(), "ERR_TOO_LATE");
    assert_eq!(tusd.balance_of(&cast.ana.0).await?, funds);

    assert_eq!(supply(&escrow).await?, 1, "only Luis's ticket exists");
    assert_eq!(tusd.balance_of(&escrow.id()).await?, TUSD_PRICE);
    for event_id in [unaccepted, soon] {
        let accounting = escrow.accounting(event_id).await?;
        assert_eq!(amount(&accounting, "principal_received"), 0);
    }
    Ok(())
}

#[tokio::test]
async fn t26_only_the_event_currency_buys() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow], &cast.mallory).await?;
    let teur = token(&chain, TEUR_ID, &[&escrow], &cast.mallory).await?;
    let hostile = token(&chain, HOSTILE_ID, &[&escrow], &cast.mallory).await?;
    let unlisted = token(&chain, UNLISTED_ID, &[&escrow], &cast.mallory).await?;
    let usd_funds = fund(&tusd, &cast.ana).await?;
    let eur_funds = fund(&teur, &cast.ana).await?;
    let fake_funds = fund(&unlisted, &cast.ana).await?;

    // A token the deployment does not list cannot even price an event.
    let times = chain.times_from_now([600, 1_200, 1_800]).await?;
    let terms = priced_terms(&cast.verifier, times, 3, Some(UNLISTED_ID), TUSD_PRICE);
    let deposit = NearToken::from_yoctonear(escrow.quote(3).await?);
    let result = escrow
        .call(
            &cast.organizer,
            "create_event",
            json!({ "terms": terms }),
            deposit,
            100,
        )
        .await?;
    assert_fails_with(&result, "ERR_INVALID_TERMS");
    assert_eq!(escrow.event(1).await?, Value::Null, "no event was created");

    let (usd_event, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        3,
        Some(TUSD_ID),
        TUSD_PRICE,
    )
    .await?;
    let (near_event, _) = on_sale(&escrow, &cast, [600, 1_200, 1_800], 3, None, PRICE).await?;
    let to_usd = purchase_msg(usd_event);
    let to_near = purchase_msg(near_event);

    // Another listed token, with the same number as the price: a real transfer, then a forged one.
    let result = teur
        .transfer_call(&cast.ana, &escrow.id(), TUSD_PRICE, &to_usd)
        .await?;
    assert_purchase_rejected(&result, &escrow.id(), "ERR_WRONG_CURRENCY");
    assert_eq!(teur.balance_of(&cast.ana.0).await?, eur_funds);
    let result = hostile
        .forge_on_transfer(
            &cast.mallory,
            &escrow.id(),
            &cast.mallory.0,
            TUSD_PRICE,
            &to_usd,
        )
        .await?;
    assert_fails_with(&result, "ERR_WRONG_CURRENCY");

    // A token contract the deployment does not list: a real transfer, then a forged one.
    let result = unlisted
        .transfer_call(&cast.ana, &escrow.id(), TUSD_PRICE, &to_usd)
        .await?;
    assert_purchase_rejected(&result, &escrow.id(), "ERR_WRONG_CURRENCY");
    assert_eq!(unlisted.balance_of(&cast.ana.0).await?, fake_funds);
    let result = unlisted
        .forge_on_transfer(
            &cast.mallory,
            &escrow.id(),
            &cast.ana.0,
            TUSD_PRICE,
            &to_usd,
        )
        .await?;
    assert_fails_with(&result, "ERR_WRONG_CURRENCY");

    // A plain account calling `ft_on_transfer` itself, in its own name or in Ana's.
    for sender in [&cast.mallory.0, &cast.ana.0] {
        let args = json!({ "sender_id": sender, "amount": TUSD_PRICE.to_string(), "msg": to_usd });
        let result = escrow
            .call(&cast.mallory, "ft_on_transfer", args, NO_DEPOSIT, 100)
            .await?;
        assert_fails_with(&result, "ERR_WRONG_CURRENCY");
    }

    // NEAR sent to the token event, as the price's number of yoctoNEAR or as a NEAR price.
    for deposit in [TUSD_PRICE, PRICE] {
        let before = chain.balance(&cast.luis.0).await?;
        let args = json!({ "event_id": usd_event });
        let result = escrow
            .call(
                &cast.luis,
                "buy_ticket",
                args,
                NearToken::from_yoctonear(deposit),
                100,
            )
            .await?;
        assert_fails_with(&result, "ERR_WRONG_CURRENCY");
        let spent = before - chain.balance(&cast.luis.0).await?;
        assert!(spent < GAS_FEE_BOUND, "the NEAR came back: {spent}");
    }

    // A token sent to the NEAR event, as the NEAR price's number of its smallest unit: a real
    // transfer of tEUR, then a forged one.
    let result = teur
        .transfer_call(&cast.ana, &escrow.id(), PRICE, &to_near)
        .await?;
    assert_purchase_rejected(&result, &escrow.id(), "ERR_WRONG_CURRENCY");
    assert_eq!(teur.balance_of(&cast.ana.0).await?, eur_funds);
    let result = hostile
        .forge_on_transfer(
            &cast.mallory,
            &escrow.id(),
            &cast.mallory.0,
            PRICE,
            &to_near,
        )
        .await?;
    assert_fails_with(&result, "ERR_WRONG_CURRENCY");

    // Nothing was sold, and the contract holds none of these tokens.
    assert_eq!(supply(&escrow).await?, 0);
    for event_id in [usd_event, near_event] {
        assert_eq!(escrow.event(event_id).await?["sold"], 0);
        let accounting = escrow.accounting(event_id).await?;
        assert_eq!(amount(&accounting, "principal_received"), 0);
    }
    for token in [&tusd, &teur, &hostile, &unlisted] {
        assert_eq!(token.balance_of(&escrow.id()).await?, 0, "{}", token.id);
    }

    // The event's own currency buys, on both events.
    let token_id = buy_with(&tusd, &escrow, &cast.ana, usd_event, TUSD_PRICE).await?;
    assert_eq!(
        escrow.ticket(&token_id).await?["owner_id"],
        cast.ana.0.as_str()
    );
    assert_eq!(tusd.balance_of(&cast.ana.0).await?, usd_funds - TUSD_PRICE);
    escrow.buy(&cast.luis, near_event, PRICE).await?;
    assert_eq!(supply(&escrow).await?, 2);
    Ok(())
}

#[tokio::test]
async fn t27_token_refund_follows_the_holder() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow], &cast.mallory).await?;
    let funds = fund(&tusd, &cast.ana).await?;
    tusd.register(&cast.luis, &cast.luis.0).await?;
    let (event_id, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        3,
        Some(TUSD_ID),
        TUSD_PRICE,
    )
    .await?;
    let token_id = buy_with(&tusd, &escrow, &cast.ana, event_id, TUSD_PRICE).await?;
    escrow
        .transfer(&cast.ana, &cast.luis.0, &token_id)
        .await?
        .assert_success();
    escrow.cancel(&cast.organizer, event_id).await?;

    // Ana sold the ticket: the right went with it.
    let result = escrow
        .claim_refund(&cast.ana, &token_id, CLAIM_TGAS)
        .await?;
    assert_fails_with(&result, "ERR_UNAUTHORIZED");
    assert!(token_moves(&result, &tusd.id).is_empty());

    // Luis is paid exactly the price, in the token, and no NEAR leaves the contract.
    let near_before = chain.balance(&cast.luis.0).await?;
    let result = escrow
        .claim_refund(&cast.luis, &token_id, CLAIM_TGAS)
        .await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(paid);
    assert_eq!(
        token_moves(&result, &tusd.id),
        [TokenMove {
            from: escrow.id().to_string(),
            to: cast.luis.0.to_string(),
            amount: TUSD_PRICE
        }]
    );
    assert_one_ft_transfer(&escrow, &result, TUSD_ID, &cast.luis.0, TUSD_PRICE, true).await?;
    assert!(
        chain
            .transfers_from(&result, &escrow.id())
            .await?
            .is_empty(),
        "no NEAR transfer"
    );
    let near_after = chain.balance(&cast.luis.0).await?;
    assert!(near_after <= near_before && near_before - near_after < GAS_FEE_BOUND);
    assert_eq!(events_named(&result, "refund_requested").len(), 1);
    let settled = events_named(&result, "refund_settled");
    assert_eq!(settled.len(), 1);
    let data = &settled[0]["data"][0];
    assert_eq!(data["amount"], TUSD_PRICE.to_string());
    assert_eq!(data["recipient_id"], cast.luis.0.as_str());
    assert_eq!(data["token_id"], token_id.as_str());
    assert_eq!(data["currency"], TUSD_ID);

    assert_eq!(tusd.balance_of(&cast.luis.0).await?, TUSD_PRICE);
    assert_eq!(tusd.balance_of(&cast.ana.0).await?, funds - TUSD_PRICE);
    assert_eq!(tusd.balance_of(&escrow.id()).await?, 0);
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["owner_id"], cast.luis.0.as_str());
    assert_eq!(ticket["status"], "Refunded");
    assert_eq!(ticket["claim"], "Refunded");
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refunds_settled"), TUSD_PRICE);
    assert_eq!(amount(&accounting, "refund_pending"), 0);
    assert_eq!(amount(&accounting, "principal_reserved"), 0);
    assert_eq!(
        history_kinds(&escrow, &token_id).await?,
        [
            "Purchased",
            "Transferred",
            "RefundRequested",
            "RefundSettled"
        ]
    );

    // Once is all.
    let result = escrow
        .claim_refund(&cast.luis, &token_id, CLAIM_TGAS)
        .await?;
    assert_fails_with(&result, "ERR_ALREADY_REFUNDED");
    assert!(ft_transfers_by(&escrow, &result).await?.is_empty());
    assert_eq!(tusd.balance_of(&cast.luis.0).await?, TUSD_PRICE);
    Ok(())
}

#[tokio::test]
async fn t28_unregistered_holder_gets_the_right_back_once() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow], &cast.mallory).await?;
    fund(&tusd, &cast.ana).await?;
    let (event_id, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        3,
        Some(TUSD_ID),
        TUSD_PRICE,
    )
    .await?;
    let token_id = buy_with(&tusd, &escrow, &cast.ana, event_id, TUSD_PRICE).await?;
    // Luis can receive the ticket without being registered with the token.
    escrow
        .transfer(&cast.ana, &cast.luis.0, &token_id)
        .await?
        .assert_success();
    escrow.cancel(&cast.organizer, event_id).await?;
    assert!(!tusd.is_registered(&cast.luis.0).await?);

    // The token refuses the transfer; the right comes back, once.
    let result = escrow
        .claim_refund(&cast.luis, &token_id, CLAIM_TGAS)
        .await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(!paid, "no money moved");
    assert_one_ft_transfer(&escrow, &result, TUSD_ID, &cast.luis.0, TUSD_PRICE, false).await?;
    assert!(token_moves(&result, &tusd.id).is_empty());
    assert_eq!(events_named(&result, "refund_requested").len(), 1);
    let failed = events_named(&result, "refund_failed");
    assert_eq!(failed.len(), 1, "restored once");
    assert_eq!(failed[0]["data"][0]["currency"], TUSD_ID);
    assert!(events_named(&result, "refund_settled").is_empty());
    let ticket = escrow.ticket(&token_id).await?;
    assert_eq!(ticket["owner_id"], cast.luis.0.as_str());
    assert_eq!(ticket["status"], "Active");
    assert_eq!(ticket["claim"], "Refundable");
    assert_eq!(ticket["pending_operation_id"], Value::Null);
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "principal_reserved"), TUSD_PRICE);
    assert_eq!(amount(&accounting, "refund_pending"), 0);
    assert_eq!(amount(&accounting, "refunds_settled"), 0);
    assert_eq!(tusd.balance_of(&escrow.id()).await?, TUSD_PRICE);
    assert_eq!(
        history_kinds(&escrow, &token_id)
            .await?
            .last()
            .map(String::as_str),
        Some("RefundFailed")
    );

    // Registered, Luis claims again and is paid the price.
    tusd.register(&cast.luis, &cast.luis.0).await?;
    let result = escrow
        .claim_refund(&cast.luis, &token_id, CLAIM_TGAS)
        .await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(paid);
    assert_one_ft_transfer(&escrow, &result, TUSD_ID, &cast.luis.0, TUSD_PRICE, true).await?;
    assert_eq!(events_named(&result, "refund_settled").len(), 1);
    assert!(events_named(&result, "refund_failed").is_empty());
    assert_eq!(tusd.balance_of(&cast.luis.0).await?, TUSD_PRICE);
    assert_eq!(tusd.balance_of(&escrow.id()).await?, 0);
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refunds_settled"), TUSD_PRICE);
    assert_eq!(amount(&accounting, "principal_reserved"), 0);
    assert_eq!(escrow.ticket(&token_id).await?["status"], "Refunded");

    let result = escrow
        .claim_refund(&cast.luis, &token_id, CLAIM_TGAS)
        .await?;
    assert_fails_with(&result, "ERR_ALREADY_REFUNDED");
    assert_eq!(tusd.balance_of(&cast.luis.0).await?, TUSD_PRICE);
    Ok(())
}

#[tokio::test]
async fn t29_token_payout_failure_paths() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let faulty = chain.faulty_escrow("faulty.sandbox").await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow, &faulty], &cast.mallory).await?;
    let hostile = token(&chain, HOSTILE_ID, &[&escrow], &cast.mallory).await?;
    fund(&tusd, &cast.ana).await?;
    fund(&hostile, &cast.luis).await?;
    hostile.register(&cast.organizer, &cast.organizer.0).await?;
    let host_price = 5 * HOST;
    let offsets = [60, 70, 900];
    let (unregistered, times) =
        on_sale(&escrow, &cast, offsets, 2, Some(TUSD_ID), TUSD_PRICE).await?;
    let (failing, _) = on_sale(&escrow, &cast, offsets, 2, Some(HOSTILE_ID), host_price).await?;
    let (pending, _) = on_sale(&faulty, &cast, offsets, 2, Some(TUSD_ID), TUSD_PRICE).await?;
    buy_with(&tusd, &escrow, &cast.ana, unregistered, TUSD_PRICE).await?;
    buy_with(&hostile, &escrow, &cast.luis, failing, host_price).await?;
    buy_with(&tusd, &faulty, &cast.ana, pending, TUSD_PRICE).await?;
    chain.advance_to(times[1]).await?;
    escrow.attest(&cast.verifier, unregistered).await?;
    escrow.attest(&cast.verifier, failing).await?;
    faulty.attest(&cast.verifier, pending).await?;

    // An organizer who is not registered with the token: the payout comes back, once.
    let organizer = &cast.organizer.0;
    let result = escrow.claim_payout(&cast.organizer, unregistered).await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(!paid);
    assert_one_ft_transfer(&escrow, &result, TUSD_ID, organizer, TUSD_PRICE, false).await?;
    assert_eq!(events_named(&result, "payout_requested").len(), 1);
    let failed = events_named(&result, "payout_failed");
    assert_eq!(failed.len(), 1, "restored once");
    assert_eq!(failed[0]["data"][0]["currency"], TUSD_ID);
    assert!(events_named(&result, "payout_settled").is_empty());
    let accounting = escrow.accounting(unregistered).await?;
    assert_eq!(amount(&accounting, "organizer_available"), TUSD_PRICE);
    assert_eq!(amount(&accounting, "organizer_pending"), 0);
    assert_eq!(amount(&accounting, "organizer_settled"), 0);
    assert_eq!(tusd.balance_of(&escrow.id()).await?, TUSD_PRICE);

    // Registered, the organizer is paid the whole amount.
    tusd.register(&cast.organizer, organizer).await?;
    let result = escrow.claim_payout(&cast.organizer, unregistered).await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(paid);
    assert_one_ft_transfer(&escrow, &result, TUSD_ID, organizer, TUSD_PRICE, true).await?;
    let settled = events_named(&result, "payout_settled");
    assert_eq!(settled.len(), 1);
    assert_eq!(settled[0]["data"][0]["currency"], TUSD_ID);
    assert_eq!(settled[0]["data"][0]["amount"], TUSD_PRICE.to_string());
    assert_eq!(tusd.balance_of(organizer).await?, TUSD_PRICE);
    let accounting = escrow.accounting(unregistered).await?;
    assert_eq!(amount(&accounting, "organizer_settled"), TUSD_PRICE);
    assert_eq!(amount(&accounting, "organizer_available"), 0);
    let result = escrow.claim_payout(&cast.organizer, unregistered).await?;
    assert_fails_with(&result, "ERR_NOTHING_TO_PAY");

    // A token that fails every transfer: the payout comes back; once it works, it pays once.
    hostile.set_mode(&cast.mallory, "fail").await?;
    let result = escrow.claim_payout(&cast.organizer, failing).await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(!paid);
    assert_one_ft_transfer(&escrow, &result, HOSTILE_ID, organizer, host_price, false).await?;
    assert_eq!(events_named(&result, "payout_failed").len(), 1);
    let accounting = escrow.accounting(failing).await?;
    assert_eq!(amount(&accounting, "organizer_available"), host_price);
    assert_eq!(amount(&accounting, "organizer_pending"), 0);
    hostile.set_mode(&cast.mallory, "normal").await?;
    let result = escrow.claim_payout(&cast.organizer, failing).await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(paid);
    assert_eq!(hostile.balance_of(organizer).await?, host_price);
    assert_eq!(hostile.balance_of(&escrow.id()).await?, 0);
    let result = escrow.claim_payout(&cast.organizer, failing).await?;
    assert_fails_with(&result, "ERR_NOTHING_TO_PAY");
    assert_eq!(hostile.balance_of(organizer).await?, host_price);

    // Fault-injection build: the payout arrives but its callback fails. It stays pending and is
    // never sent again.
    let before = tusd.balance_of(organizer).await?;
    let result = faulty.claim_payout(&cast.organizer, pending).await?;
    assert_one_ft_transfer(&faulty, &result, TUSD_ID, organizer, TUSD_PRICE, true).await?;
    assert_eq!(
        failed_receipts_on(&result, &faulty.id()),
        1,
        "the callback failed"
    );
    assert!(events_named(&result, "payout_settled").is_empty());
    assert!(events_named(&result, "payout_failed").is_empty());
    assert_eq!(tusd.balance_of(organizer).await? - before, TUSD_PRICE);
    let accounting = faulty.accounting(pending).await?;
    assert_eq!(amount(&accounting, "organizer_pending"), TUSD_PRICE);
    assert_eq!(amount(&accounting, "organizer_available"), 0);
    let operation_id = events_named(&result, "payout_requested")[0]["data"][0]["operation_id"]
        .as_u64()
        .ok_or("no operation id")?;
    let operation = faulty.operation(operation_id).await?;
    assert_eq!(operation["kind"], "Payout");
    assert_eq!(operation["currency"], TUSD_ID);
    assert_eq!(operation["amount"], TUSD_PRICE.to_string());
    assert_eq!(operation["recipient_id"], organizer.as_str());
    assert_eq!(operation["token_id"], Value::Null);
    let result = faulty.claim_payout(&cast.organizer, pending).await?;
    assert_fails_with(&result, "ERR_PAYOUT_PENDING");
    assert!(
        ft_transfers_by(&faulty, &result).await?.is_empty(),
        "no second transfer"
    );
    assert_eq!(tusd.balance_of(organizer).await? - before, TUSD_PRICE);
    Ok(())
}

#[tokio::test]
async fn t30_currencies_do_not_share_money() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow], &cast.mallory).await?;
    let teur = token(&chain, TEUR_ID, &[&escrow], &cast.mallory).await?;
    fund(&tusd, &cast.ana).await?;
    let luis_eur = fund(&teur, &cast.luis).await?;
    let mallory_eur = fund(&teur, &cast.mallory).await?;
    tusd.register(&cast.organizer, &cast.organizer.0).await?;

    // Two NEAR events and two token events. B is priced in tEUR at the same number as the NEAR
    // price, so any amount that crossed currencies would show.
    let offsets = [90, 100, 900];
    let (a, times) = on_sale(&escrow, &cast, offsets, 2, None, PRICE).await?;
    let (b, _) = on_sale(&escrow, &cast, offsets, 2, Some(TEUR_ID), PRICE).await?;
    let (c, _) = on_sale(&escrow, &cast, offsets, 2, Some(TUSD_ID), TUSD_PRICE).await?;
    let (d, _) = on_sale(&escrow, &cast, offsets, 2, None, PRICE).await?;
    escrow.buy(&cast.ana, a, PRICE).await?;
    let luis_b = buy_with(&teur, &escrow, &cast.luis, b, PRICE).await?;
    let mallory_b = buy_with(&teur, &escrow, &cast.mallory, b, PRICE).await?;
    buy_with(&tusd, &escrow, &cast.ana, c, TUSD_PRICE).await?;
    let mallory_d = escrow.buy(&cast.mallory, d, PRICE).await?;
    escrow.cancel(&cast.organizer, b).await?;
    escrow.cancel(&cast.organizer, d).await?;
    chain.advance_to(times[1]).await?;
    escrow.attest(&cast.verifier, a).await?;
    escrow.attest(&cast.verifier, c).await?;
    for (event_id, currency) in [
        (a, Value::Null),
        (b, json!(TEUR_ID)),
        (c, json!(TUSD_ID)),
        (d, Value::Null),
    ] {
        assert_eq!(escrow.accounting(event_id).await?["currency"], currency);
    }

    // The contract holds each token exactly as its token events owe it.
    assert_eq!(teur.balance_of(&escrow.id()).await?, 2 * PRICE);
    assert_eq!(tusd.balance_of(&escrow.id()).await?, TUSD_PRICE);

    // Its NEAR balance is cut to its storage plus what the NEAR events owe, plus a margin far
    // smaller than the tEUR it holds. If token money counted as NEAR anywhere, the NEAR payout
    // would fail the liquidity check, or a token refund would.
    let margin = NEAR / 10;
    let storage = u128::from(chain.storage_usage(&escrow.id()).await?) * STORAGE_BYTE_COST;
    let near_owed = escrow.held(&[a, d]).await?;
    assert_eq!(near_owed, 2 * PRICE);
    chain
        .set_balance(&escrow.id(), storage + near_owed + margin)
        .await?;

    let organizer = &cast.organizer.0;
    let before = chain.balance(organizer).await?;
    let result = escrow.claim_payout(&cast.organizer, a).await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(paid, "the NEAR payout");
    assert_eq!(
        chain.transfers_from(&result, &escrow.id()).await?,
        [Transfer {
            receiver: organizer.to_string(),
            amount: PRICE,
            succeeded: true
        }]
    );
    assert!(ft_transfers_by(&escrow, &result).await?.is_empty());
    let received = chain.balance(organizer).await? - before;
    assert!(received > PRICE - GAS_FEE_BOUND && received < PRICE);

    let result = escrow.claim_payout(&cast.organizer, c).await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(paid, "the tUSD payout");
    assert_one_ft_transfer(&escrow, &result, TUSD_ID, organizer, TUSD_PRICE, true).await?;
    assert!(
        chain
            .transfers_from(&result, &escrow.id())
            .await?
            .is_empty()
    );
    assert_eq!(tusd.balance_of(organizer).await?, TUSD_PRICE);

    for (holder, ticket, funds) in [
        (&cast.luis, &luis_b, luis_eur),
        (&cast.mallory, &mallory_b, mallory_eur),
    ] {
        let near_before = chain.balance(&holder.0).await?;
        let result = escrow.claim_refund(holder, ticket, CLAIM_TGAS).await?;
        let paid: bool = result.clone().assert_success().json()?;
        assert!(paid, "the tEUR refund of {ticket}");
        assert_one_ft_transfer(&escrow, &result, TEUR_ID, &holder.0, PRICE, true).await?;
        assert!(
            chain
                .transfers_from(&result, &escrow.id())
                .await?
                .is_empty()
        );
        assert_eq!(
            teur.balance_of(&holder.0).await?,
            funds,
            "{ticket}: the price came back in tEUR"
        );
        let near_after = chain.balance(&holder.0).await?;
        assert!(near_after <= near_before, "{ticket}: no NEAR was paid");
    }

    let before = chain.balance(&cast.mallory.0).await?;
    let result = escrow
        .claim_refund(&cast.mallory, &mallory_d, CLAIM_TGAS)
        .await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(paid, "the NEAR refund");
    assert!(ft_transfers_by(&escrow, &result).await?.is_empty());
    let received = chain.balance(&cast.mallory.0).await? - before;
    assert!(received > PRICE - GAS_FEE_BOUND && received < PRICE);
    assert_eq!(teur.balance_of(&cast.mallory.0).await?, mallory_eur);

    // Every currency is settled from its own money.
    assert_eq!(teur.balance_of(&escrow.id()).await?, 0);
    assert_eq!(tusd.balance_of(&escrow.id()).await?, 0);
    assert_eq!(
        amount(&escrow.accounting(a).await?, "organizer_settled"),
        PRICE
    );
    assert_eq!(
        amount(&escrow.accounting(b).await?, "refunds_settled"),
        2 * PRICE
    );
    assert_eq!(
        amount(&escrow.accounting(c).await?, "organizer_settled"),
        TUSD_PRICE
    );
    assert_eq!(
        amount(&escrow.accounting(d).await?, "refunds_settled"),
        PRICE
    );
    Ok(())
}

#[tokio::test]
async fn t31_a_failing_token_never_pays_twice() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let hostile = token(&chain, HOSTILE_ID, &[&escrow], &cast.mallory).await?;
    fund(&hostile, &cast.ana).await?;
    let price = 5 * HOST;
    // The first holder is a contract, so that two claims leave in one receipt and reach the
    // escrow one right after the other, the second while the first one's transfer is in flight.
    let holder = chain
        .deploy_fixture("twice.sandbox", 20, vanishing_holder_wasm())
        .await?;
    hostile.register(&cast.ana, &holder.0).await?;
    let (event_id, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        1,
        Some(HOSTILE_ID),
        price,
    )
    .await?;
    let token_id = buy_with(&hostile, &escrow, &cast.ana, event_id, price).await?;
    escrow
        .transfer(&cast.ana, &holder.0, &token_id)
        .await?
        .assert_success();
    escrow.cancel(&cast.organizer, event_id).await?;
    let claim_twice = || {
        let args = json!({ "ticket_contract": escrow.id(), "token_id": token_id });
        chain.call(
            &holder,
            &holder.0,
            "claim_twice",
            args,
            NO_DEPOSIT,
            FIXTURE_TGAS,
        )
    };
    let escrow_id = escrow.id();
    let claim_once = || {
        forward(
            &chain,
            &holder,
            &escrow_id,
            "claim_refund",
            json!({ "token_id": token_id }),
            ONE_YOCTO,
        )
    };
    let assert_right_is_whole = |when: &'static str| {
        let escrow = &escrow;
        let token_id = &token_id;
        async move {
            let ticket = escrow.ticket(token_id).await?;
            assert_eq!(ticket["status"], "Active", "{when}");
            assert_eq!(ticket["claim"], "Refundable", "{when}");
            assert_eq!(ticket["pending_operation_id"], Value::Null, "{when}");
            let accounting = escrow.accounting(event_id).await?;
            assert_eq!(amount(&accounting, "principal_reserved"), price, "{when}");
            assert_eq!(amount(&accounting, "refund_pending"), 0, "{when}");
            assert_eq!(amount(&accounting, "refunds_settled"), 0, "{when}");
            TestResult::Ok(())
        }
    };

    // While the token fails, two claims at once: one is locked out, the other's transfer fails,
    // and the right comes back once.
    hostile.set_mode(&cast.mallory, "fail").await?;
    let result = claim_twice().await?;
    let failures = receipt_failure_texts(&result);
    let locked = failures
        .iter()
        .filter(|text| text.contains("ERR_TICKET_LOCKED"))
        .count();
    assert_eq!(locked, 1, "{failures:?}");
    assert_eq!(failed_receipts_on(&result, &hostile.id), 1, "{failures:?}");
    assert_eq!(ft_transfers_by(&escrow, &result).await?.len(), 1);
    assert_eq!(events_named(&result, "refund_requested").len(), 1);
    assert_eq!(events_named(&result, "refund_failed").len(), 1);
    assert!(events_named(&result, "refund_settled").is_empty());
    assert_right_is_whole("after two claims on a failing token").await?;

    // Again, alone: the same, and the right is still counted once.
    let result = claim_once().await?;
    let paid: bool = result.clone().assert_success().json()?;
    assert!(!paid);
    assert_eq!(events_named(&result, "refund_failed").len(), 1);
    assert_right_is_whole("after a third claim on a failing token").await?;
    assert_eq!(hostile.balance_of(&escrow.id()).await?, price);
    assert_eq!(hostile.balance_of(&holder.0).await?, 0);

    // The token works again: two claims at once pay once.
    hostile.set_mode(&cast.mallory, "normal").await?;
    let result = claim_twice().await?;
    let failures = receipt_failure_texts(&result);
    assert_eq!(failures.len(), 1, "{failures:?}");
    assert!(failures[0].contains("ERR_TICKET_LOCKED"), "{failures:?}");
    assert_eq!(
        token_moves(&result, &hostile.id),
        [TokenMove {
            from: escrow.id().to_string(),
            to: holder.0.to_string(),
            amount: price
        }]
    );
    assert_eq!(events_named(&result, "refund_settled").len(), 1);

    // And never again.
    let result = claim_once().await?;
    assert_fails_with(&result, "ERR_ALREADY_REFUNDED");
    assert!(token_moves(&result, &hostile.id).is_empty());
    assert_eq!(hostile.balance_of(&holder.0).await?, price);
    assert_eq!(hostile.balance_of(&escrow.id()).await?, 0);
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refunds_settled"), price);
    assert_eq!(amount(&accounting, "principal_reserved"), 0);
    assert_eq!(escrow.ticket(&token_id).await?["status"], "Refunded");
    Ok(())
}

#[tokio::test]
async fn a_token_that_pays_but_answers_oddly_never_pays_twice() -> TestResult {
    // A token whose `ft_transfer` moves the money and then answers something other than nothing
    // (garbage, or as many bytes as its gas allows). The holder is paid once. The right must
    // never come back after that payment (R7): the ticket ends `Refunded` (the callback confirmed
    // the success) or stays `RefundPending` (it could not read the answer). A second claim never
    // pays.
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let hostile = token(&chain, HOSTILE_ID, &[&escrow], &cast.mallory).await?;
    fund(&hostile, &cast.ana).await?;
    let price = 5 * HOST;
    let (event_id, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        2,
        Some(HOSTILE_ID),
        price,
    )
    .await?;
    let mut statuses = Vec::new();
    for (mode, holder) in [("garbage", &cast.luis), ("long", &cast.mallory)] {
        hostile.register(holder, &holder.0).await?;
        let token_id = buy_with(&hostile, &escrow, &cast.ana, event_id, price).await?;
        escrow
            .transfer(&cast.ana, &holder.0, &token_id)
            .await?
            .assert_success();
        statuses.push((mode, holder, token_id));
    }
    escrow.cancel(&cast.organizer, event_id).await?;

    for (mode, holder, token_id) in &statuses {
        hostile.set_mode(&cast.mallory, mode).await?;
        let result = escrow.claim_refund(holder, token_id, CLAIM_TGAS).await?;
        assert_eq!(
            token_moves(&result, &hostile.id),
            [TokenMove {
                from: escrow.id().to_string(),
                to: holder.0.to_string(),
                amount: price
            }],
            "{mode}: paid once"
        );
        assert!(
            events_named(&result, "refund_failed").is_empty(),
            "{mode}: never restored"
        );
        let status = escrow.ticket(token_id).await?["status"].clone();
        assert!(
            status == "Refunded" || status == "RefundPending",
            "{mode}: the right came back after the payment: {status}"
        );
        let again = escrow.claim_refund(holder, token_id, CLAIM_TGAS).await?;
        let failure =
            failure_text(&again).ok_or_else(|| format!("{mode}: a second claim succeeded"))?;
        assert!(
            failure.contains("ERR_ALREADY_REFUNDED") || failure.contains("ERR_TICKET_LOCKED"),
            "{mode}: {failure}"
        );
        assert!(token_moves(&again, &hostile.id).is_empty());
        assert_eq!(hostile.balance_of(&holder.0).await?, price, "{mode}");
        hostile.set_mode(&cast.mallory, "normal").await?;
    }
    assert_eq!(hostile.balance_of(&escrow.id()).await?, 0);
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "principal_reserved"), 0);
    assert_eq!(
        amount(&accounting, "refunds_settled") + amount(&accounting, "refund_pending"),
        2 * price
    );
    Ok(())
}

#[tokio::test]
async fn a_token_answer_does_not_stop_the_confirmation() -> TestResult {
    // R7 says the callback confirms a transfer that succeeded. A token that answers its
    // `ft_transfer` with a value still succeeded, so the refund is recorded as settled, not left
    // pending for good.
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let hostile = token(&chain, HOSTILE_ID, &[&escrow], &cast.mallory).await?;
    fund(&hostile, &cast.ana).await?;
    let price = 5 * HOST;
    let (event_id, _) = on_sale(
        &escrow,
        &cast,
        [600, 1_200, 1_800],
        2,
        Some(HOSTILE_ID),
        price,
    )
    .await?;
    let tickets = [
        buy_with(&hostile, &escrow, &cast.ana, event_id, price).await?,
        buy_with(&hostile, &escrow, &cast.ana, event_id, price).await?,
    ];
    escrow.cancel(&cast.organizer, event_id).await?;
    for (mode, token_id) in ["garbage", "long"].iter().zip(&tickets) {
        hostile.set_mode(&cast.mallory, mode).await?;
        let result = escrow.claim_refund(&cast.ana, token_id, CLAIM_TGAS).await?;
        assert_eq!(token_moves(&result, &hostile.id).len(), 1, "{mode}: paid");
        assert_eq!(
            events_named(&result, "refund_settled").len(),
            1,
            "{mode}: confirmed"
        );
        assert_eq!(
            escrow.ticket(token_id).await?["status"],
            "Refunded",
            "{mode}"
        );
    }
    let accounting = escrow.accounting(event_id).await?;
    assert_eq!(amount(&accounting, "refunds_settled"), 2 * price);
    assert_eq!(amount(&accounting, "refund_pending"), 0);
    Ok(())
}

/// What a ticket's metadata shows, read from `nft_token`, after checking the drawn ticket: an SVG
/// data URL of at most 2 KB before encoding, whose `media_hash` is the base64 SHA-256 of its
/// bytes.
struct Shown {
    title: String,
    description: String,
    extra: Value,
    svg: String,
}

async fn shown(escrow: &Escrow<'_>, token_id: &str) -> TestResult<Shown> {
    let token: Value = escrow
        .view("nft_token", json!({ "token_id": token_id }))
        .await?;
    let metadata = &token["metadata"];
    let extra = metadata["extra"].as_str().ok_or("extra is not a string")?;
    let media = metadata["media"].as_str().ok_or("no media")?;
    let encoded = media
        .strip_prefix("data:image/svg+xml;base64,")
        .ok_or_else(|| format!("media is not an SVG data URL: {media}"))?;
    let svg = BASE64.decode(encoded)?;
    assert!(
        svg.len() <= 2048,
        "{token_id}: the SVG has {} bytes",
        svg.len()
    );
    let media_hash = metadata["media_hash"].as_str().ok_or("no media_hash")?;
    assert_eq!(
        BASE64.decode(media_hash)?,
        near_sdk::env::sha256(&svg),
        "{token_id}: media_hash is the SHA-256 of the SVG"
    );
    let svg = String::from_utf8(svg)?;
    assert!(svg.contains("<svg"), "{token_id}: {svg}");
    Ok(Shown {
        title: metadata["title"].as_str().unwrap_or_default().to_string(),
        description: metadata["description"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        extra: near_sdk::serde_json::from_str(extra)?,
        svg,
    })
}

/// The description of ticket `serial` of `capacity` of the default event, then `sentence`.
fn described(serial: u32, capacity: u32, sentence: &str) -> String {
    format!("Ticket {serial} of {capacity} for Jazz night at Teatro Municipal. {sentence}")
}

/// The `extra` JSON of a ticket.
fn extra(
    event_id: u32,
    status: &str,
    claim: &str,
    outcome: &str,
    principal: u128,
    currency: Option<&str>,
) -> Value {
    json!({
        "event_id": event_id, "serial": 1, "status": status, "claim": claim, "outcome": outcome,
        "principal": principal.to_string(), "currency": currency,
    })
}

#[tokio::test]
async fn t32_metadata_follows_the_state() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let faulty = chain.faulty_escrow("faulty.sandbox").await?;
    let cast = chain.cast().await?;
    let tusd = token(&chain, TUSD_ID, &[&escrow], &cast.mallory).await?;
    let teur = token(&chain, TEUR_ID, &[&faulty], &cast.mallory).await?;
    fund(&tusd, &cast.ana).await?;
    fund(&teur, &cast.luis).await?;

    // Events whose prices exercise the amount format: a fraction, the smallest unit, a whole
    // number, half a NEAR, and the most digits a buyer here can pay.
    let offsets = [120, 130, 900];
    let usd_price = 10 * USD + USD / 2;
    let (refunded, times) = on_sale(&escrow, &cast, offsets, 3, Some(TUSD_ID), usd_price).await?;
    let (tiny, _) = on_sale(&escrow, &cast, offsets, 2, Some(TUSD_ID), 1).await?;
    let (completed, _) = on_sale(&escrow, &cast, offsets, 2, None, PRICE).await?;
    let (half, _) = on_sale(&escrow, &cast, offsets, 2, None, NEAR / 2).await?;
    let (pending, _) = on_sale(&faulty, &cast, offsets, 2, Some(TEUR_ID), 2 * NEAR).await?;
    // The worst title for the drawing: 120 bytes that all need escaping in XML.
    let mut worst = priced_terms(
        &cast.verifier,
        chain.times_from_now(offsets).await?,
        2,
        None,
        NEAR + 1,
    );
    worst["title"] = json!("<&>\"'\u{20}".repeat(20));
    let worst_event = escrow.create_event(&cast.organizer, worst).await?;
    escrow.accept(&cast.verifier, worst_event).await?;

    let refunded_ticket = buy_with(&tusd, &escrow, &cast.ana, refunded, usd_price).await?;
    let tiny_ticket = buy_with(&tusd, &escrow, &cast.ana, tiny, 1).await?;
    let completed_ticket = escrow.buy(&cast.luis, completed, PRICE).await?;
    let half_ticket = escrow.buy(&cast.ana, half, NEAR / 2).await?;
    let pending_ticket = buy_with(&teur, &faulty, &cast.luis, pending, 2 * NEAR).await?;
    let worst_ticket = escrow.buy(&cast.ana, worst_event, NEAR + 1).await?;

    // Reserved.
    let reserved = shown(&escrow, &refunded_ticket).await?;
    assert_eq!(reserved.title, "Jazz night - ticket 1");
    assert_eq!(
        reserved.description,
        described(
            1,
            3,
            "10.5 tUSD is reserved in the contract until the event is resolved."
        )
    );
    assert_eq!(
        reserved.extra,
        extra(
            refunded,
            "Active",
            "Reserved",
            "Unresolved",
            usd_price,
            Some(TUSD_ID)
        )
    );
    for fact in ["Jazz night", "10.5 tUSD", "Reserved"] {
        assert!(
            reserved.svg.contains(fact),
            "the drawing shows {fact}: {}",
            reserved.svg
        );
    }
    for (token_id, amount_text) in [
        (&tiny_ticket, "0.000001 tUSD"),
        (&completed_ticket, "1.5 NEAR"),
        (&half_ticket, "0.5 NEAR"),
        (&worst_ticket, "1.000000000000000000000001 NEAR"),
    ] {
        let ticket = shown(&escrow, token_id).await?;
        let sentence =
            format!("{amount_text} is reserved in the contract until the event is resolved.");
        assert!(
            ticket.description.ends_with(&sentence),
            "{}",
            ticket.description
        );
        assert!(
            ticket.svg.contains(amount_text),
            "{token_id}: {}",
            ticket.svg
        );
    }
    let worst_svg = shown(&escrow, &worst_ticket).await?.svg;
    assert!(
        !worst_svg.contains("<&>"),
        "the title is escaped: {worst_svg}"
    );

    // The enumeration views show the same metadata as `nft_token`.
    let listed: Vec<Value> = escrow
        .view("nft_tokens_for_owner", json!({ "account_id": cast.ana.0 }))
        .await?;
    assert_eq!(listed.len(), 4);
    let all: Vec<Value> = escrow.view("nft_tokens", json!({})).await?;
    for token in listed.iter().chain(&all) {
        let single: Value = escrow
            .view("nft_token", json!({ "token_id": token["token_id"] }))
            .await?;
        assert_eq!(token, &single);
    }

    // Refundable.
    escrow.cancel(&cast.organizer, refunded).await?;
    let refundable = shown(&escrow, &refunded_ticket).await?;
    assert_eq!(
        refundable.description,
        described(
            1,
            3,
            "The event was not confirmed: whoever holds this ticket can claim 10.5 tUSD."
        )
    );
    assert_eq!(
        refundable.extra,
        extra(
            refunded,
            "Active",
            "Refundable",
            "Refundable",
            usd_price,
            Some(TUSD_ID)
        )
    );
    // The drawing names each claim with the web's word (`Claimable`, `Sending`, ...): lane C2's
    // reading of "the claim word" (`docs/decisions/2026-11-13-the-ticket-draws-its-state.md`).
    assert!(refundable.svg.contains("Claimable"), "{}", refundable.svg);
    assert_ne!(refundable.svg, reserved.svg);

    // Refunded.
    escrow
        .claim_refund(&cast.ana, &refunded_ticket, CLAIM_TGAS)
        .await?
        .assert_success();
    let done = shown(&escrow, &refunded_ticket).await?;
    assert_eq!(
        done.description,
        described(1, 3, "10.5 tUSD was refunded to the holder.")
    );
    assert_eq!(
        done.extra,
        extra(
            refunded,
            "Refunded",
            "Refunded",
            "Refundable",
            usd_price,
            Some(TUSD_ID)
        )
    );
    assert!(done.svg.contains("Refunded"), "{}", done.svg);

    // RefundPending: the fault-injection build leaves the refund pending.
    faulty.cancel(&cast.organizer, pending).await?;
    let _ = faulty
        .claim_refund(&cast.luis, &pending_ticket, CLAIM_TGAS)
        .await?;
    let on_its_way = shown(&faulty, &pending_ticket).await?;
    assert_eq!(
        on_its_way.description,
        described(1, 2, "A refund of 2 tEUR is on its way to the holder.")
    );
    assert_eq!(
        on_its_way.extra,
        extra(
            pending,
            "RefundPending",
            "RefundPending",
            "Refundable",
            2 * NEAR,
            Some(TEUR_ID)
        )
    );
    assert!(on_its_way.svg.contains("Sending"), "{}", on_its_way.svg);

    // ReleasedToOrganizer.
    chain.advance_to(times[1]).await?;
    escrow.attest(&cast.verifier, completed).await?;
    let released = shown(&escrow, &completed_ticket).await?;
    assert_eq!(
        released.description,
        described(
            1,
            2,
            "The event was confirmed and the price went to the organizer."
        )
    );
    assert_eq!(
        released.extra,
        extra(
            completed,
            "Active",
            "ReleasedToOrganizer",
            "Completed",
            PRICE,
            None
        )
    );
    assert!(
        released.svg.contains("Released to the organizer"),
        "{}",
        released.svg
    );
    Ok(())
}

/// `terms_hash` as the interface defines it: the lowercase hex SHA-256 of the Borsh encoding of
/// `(organizer_id, verifier_id, title, venue, starts_at_ms, ends_at_ms, resolution_deadline_ms,
/// price, capacity, currency)`. An account id encodes like a string.
fn expected_terms_hash(organizer: &AccountId, terms: &Value) -> TestResult<String> {
    let text = |field: &str| -> TestResult<String> {
        Ok(terms[field]
            .as_str()
            .ok_or_else(|| format!("no {field}"))?
            .to_string())
    };
    let time = |field: &str| -> TestResult<u64> {
        terms[field]
            .as_u64()
            .ok_or_else(|| format!("no {field}").into())
    };
    let tuple = (
        organizer.to_string(),
        text("verifier_id")?,
        text("title")?,
        text("venue")?,
        time("starts_at_ms")?,
        time("ends_at_ms")?,
        time("resolution_deadline_ms")?,
        text("price")?.parse::<u128>()?,
        u32::try_from(time("capacity")?)?,
        terms["currency"].as_str().map(str::to_string),
    );
    let digest = near_sdk::env::sha256(near_sdk::borsh::to_vec(&tuple)?);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[tokio::test]
async fn t33_terms_hash_covers_the_currency() -> TestResult {
    let chain = TestChain::start().await?;
    let escrow = chain.escrow().await?;
    let cast = chain.cast().await?;
    let times = chain.times_from_now([600, 1_200, 1_800]).await?;

    // Three events with the same terms and the same number as price: in NEAR, in tEUR (whose
    // unit is as large as NEAR's) and in tUSD.
    let mut hashes = Vec::new();
    let mut events = Vec::new();
    for currency in [None, Some(TEUR_ID), Some(TUSD_ID)] {
        let terms = priced_terms(&cast.verifier, times, 3, currency, PRICE);
        let event_id = escrow.create_event(&cast.organizer, terms.clone()).await?;
        let event = escrow.event(event_id).await?;
        assert_eq!(event["currency"], json!(currency));
        let hash = event["terms_hash"]
            .as_str()
            .ok_or("no terms_hash")?
            .to_string();
        assert_eq!(
            hash,
            expected_terms_hash(&cast.organizer.0, &terms)?,
            "{currency:?}: the hash is the documented one"
        );
        hashes.push(hash);
        events.push(event_id);
    }
    assert_ne!(hashes[0], hashes[1]);
    assert_ne!(hashes[0], hashes[2]);
    assert_ne!(hashes[1], hashes[2]);

    // A verifier's acceptance of one currency's terms cannot accept another's.
    for (event_id, own) in events.iter().zip(&hashes) {
        for other in hashes.iter().filter(|hash| hash != &own) {
            let args = json!({ "event_id": event_id, "terms_hash": other });
            let result = escrow
                .call(&cast.verifier, "accept_verification", args, ONE_YOCTO, 100)
                .await?;
            assert_fails_with(&result, "ERR_TERMS_MISMATCH");
            assert_eq!(escrow.event(*event_id).await?["verifier_accepted"], false);
        }
        let args = json!({ "event_id": event_id, "terms_hash": own });
        escrow
            .call(&cast.verifier, "accept_verification", args, ONE_YOCTO, 100)
            .await?
            .assert_success();
        assert_eq!(escrow.event(*event_id).await?["verifier_accepted"], true);
    }
    Ok(())
}

#[tokio::test]
async fn new_takes_a_fixed_list_of_tokens() -> TestResult {
    let chain = TestChain::start().await?;
    let spec = |id: &str, symbol: &str, decimals: u8| json!({ "account_id": id, "symbol": symbol, "decimals": decimals });

    // Four tokens is the most, with symbols of 1 to 12 ASCII bytes and 0 to 24 decimals.
    let four = json!([
        spec(TUSD_ID, "tUSD", 6),
        spec(TEUR_ID, "tEUR", 24),
        spec(HOSTILE_ID, "H", 18),
        spec("tjpy.sandbox", "TWELVEBYTES1", 0),
    ]);
    let contract = chain
        .deploy_escrow_listing("four.sandbox", false, four.clone())
        .await?;
    let config: Value = contract
        .call_function("get_config", ())
        .read_only()
        .fetch_from(&chain.network)
        .await?
        .data;
    assert_eq!(config["version"], "2.0.0");
    assert_eq!(config["tokens"], four);
    let contract = chain
        .deploy_escrow_listing("none.sandbox", false, json!([]))
        .await?;
    let config: Value = contract
        .call_function("get_config", ())
        .read_only()
        .fetch_from(&chain.network)
        .await?
        .data;
    assert_eq!(config["tokens"], json!([]));

    // Each bad list is refused, and the account is left without code.
    let mut five = four.clone();
    five.as_array_mut()
        .ok_or("a list")?
        .push(spec("tgbp.sandbox", "tGBP", 6));
    // The codes are lane C2's reading (`docs/decisions/2026-11-13-token-list-checks-at-new.md`):
    // a count over the limit is `ERR_LIMIT`, every other bad entry `ERR_INVALID_TERMS`.
    let bad_lists = [
        ("five tokens", five, "ERR_LIMIT"),
        (
            "a duplicate",
            json!([spec(TUSD_ID, "tUSD", 6), spec(TUSD_ID, "tUSD2", 6)]),
            "ERR_INVALID_TERMS",
        ),
        (
            "an empty symbol",
            json!([spec(TUSD_ID, "", 6)]),
            "ERR_INVALID_TERMS",
        ),
        (
            "a symbol of 13 bytes",
            json!([spec(TUSD_ID, "THIRTEENBYTES", 6)]),
            "ERR_INVALID_TERMS",
        ),
        (
            "a symbol that is not ASCII",
            json!([spec(TUSD_ID, "t\u{dc}SD", 6)]),
            "ERR_INVALID_TERMS",
        ),
        (
            "25 decimals",
            json!([spec(TUSD_ID, "tUSD", 25)]),
            "ERR_INVALID_TERMS",
        ),
    ];
    let account = chain.accounts(&["refused.sandbox"], 50).await?.remove(0);
    for (why, tokens, code) in bad_lists {
        let result = near_api::Contract::deploy(account.0.clone())
            .use_code(common::escrow_wasm())
            .with_init_call("new", json!({ "tokens": tokens }))?
            .with_signer(chain.signer.clone())
            .send_to(&chain.network)
            .await?
            .into_full()
            .ok_or("send_to returned before the transaction ran")?;
        let failure = failure_text(&result).ok_or_else(|| format!("{why}: accepted"))?;
        assert!(
            failure.contains(&format!("Smart contract panicked: {code}: ")),
            "{why}: expected {code}, got {failure}"
        );
    }
    let view = Account(account.0.clone())
        .view()
        .fetch_from(&chain.network)
        .await?
        .data;
    assert!(
        !matches!(
            view.contract_state,
            near_api::types::account::ContractState::LocalHash(_)
        ),
        "no code was left behind"
    );
    Ok(())
}
