//! `new(tokens)` fixes the tokens events may be priced in, for good. Only the contract account
//! itself can call it (`#[private]`), so nobody can slip a token of their own in between the
//! deployment and the init. The deployment sends both in one transaction signed by the contract
//! account, which is how every other test file deploys the escrow.

mod common;

use common::{NO_DEPOSIT, TGAS, TestChain, escrow_wasm, failure_text};
use near_api::Contract;
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

#[tokio::test]
async fn only_the_contract_account_can_call_new() -> TestResult {
    let chain = TestChain::start().await?;
    let mut accounts = chain
        .accounts(&["uninitialized.sandbox", "mallory.sandbox"], 50)
        .await?;
    let mallory = accounts.remove(1);
    let escrow = accounts.remove(0);
    Contract::deploy(escrow.0.clone())
        .use_code(escrow_wasm())
        .without_init_call()
        .with_signer(chain.signer.clone())
        .send_to(&chain.network)
        .await?
        .assert_success();

    // A stranger reaches the code before its init and lists a token of their own.
    let fake = json!({ "tokens": [{ "account_id": mallory.0, "symbol": "FAKE", "decimals": 6 }] });
    let result = chain
        .call(&mallory, &escrow.0, "new", fake, NO_DEPOSIT, TGAS)
        .await?;
    let failure = failure_text(&result).ok_or("a stranger initialized the escrow")?;
    assert!(failure.contains("is private"), "{failure}");

    // The contract account itself still can, so the stranger wrote nothing.
    let result = chain
        .call(
            &escrow,
            &escrow.0,
            "new",
            json!({ "tokens": [] }),
            NO_DEPOSIT,
            TGAS,
        )
        .await?;
    assert_eq!(failure_text(&result), None);
    let config: Value = escrow
        .as_contract()
        .call_function("get_config", ())
        .read_only()
        .fetch_from(&chain.network)
        .await?
        .data;
    assert_eq!(config["tokens"], json!([]));
    Ok(())
}
