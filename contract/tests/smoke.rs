//! Proves the toolchain end to end: build the wasm, start a local sandbox, deploy, initialize,
//! read a view and sign with a freshly created account. Every other sandbox test builds on the
//! same steps (`common/mod.rs`).

mod common;

use common::TestChain;
use near_sdk::serde_json::Value;

#[tokio::test]
async fn deploys_and_reports_config() -> testresult::TestResult<()> {
    let chain = TestChain::start().await?;
    let contract = chain.deploy_escrow().await?;

    let config: Value = contract
        .call_function("get_config", ())
        .read_only()
        .fetch_from(&chain.network)
        .await?
        .data;

    assert_eq!(config["version"], "1.0.0");
    assert_eq!(config["max_capacity"], 100);
    assert_eq!(config["fault_injection"], false);

    // The quote for one ticket is the event's own storage plus one ticket's.
    let per_event: u128 = config["storage_per_event"].as_str().unwrap_or("").parse()?;
    let per_ticket: u128 = config["storage_per_ticket"]
        .as_str()
        .unwrap_or("")
        .parse()?;
    let quote: String = contract
        .call_function(
            "quote_event_budget",
            near_sdk::serde_json::json!({ "capacity": 1 }),
        )
        .read_only()
        .fetch_from(&chain.network)
        .await?
        .data;
    assert!(per_event > 0 && per_ticket > 0);
    assert_eq!(quote.parse::<u128>()?, per_event + per_ticket);

    Ok(())
}

#[tokio::test]
async fn new_accounts_can_sign_at_once() -> testresult::TestResult<()> {
    let chain = TestChain::start().await?;
    let contract = chain.deploy_escrow().await?;
    let accounts = chain.accounts(&["ana.sandbox", "luis.sandbox"], 10).await?;

    // A second `new` is rejected by the contract, which proves the call was signed, sent and run.
    for account in &accounts {
        contract
            .call_function("new", ())
            .transaction()
            .with_signer(account.0.clone(), chain.signer.clone())
            .send_to(&chain.network)
            .await?
            .assert_failure();
    }

    Ok(())
}
