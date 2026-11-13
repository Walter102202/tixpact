//! Events priced in a NEP-141 token (plan v2, "Currencies"): the two token fixtures first (Task
//! T1), then the escrow's money path in a token (Task T2).

mod common;

use common::{
    HOSTILE_ID, NEAR, NO_DEPOSIT, TUSD_ID, TestChain, TokenMove, failure_text, token_moves,
    value_returned_by,
};
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

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
