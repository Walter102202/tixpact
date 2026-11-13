//! Shared sandbox helpers. Every integration test file starts with `mod common;`.
//!
//! Each test file is its own binary and uses a different subset of these helpers, so unused ones
//! are expected.
#![allow(dead_code)]

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use near_api::types::{PublicKey, Reference};
use near_api::{Account, AccountId, Contract, NearToken, NetworkConfig, Signer};
use near_sandbox::Sandbox;
use near_sandbox::config::{
    DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY, DEFAULT_GENESIS_ACCOUNT_PUBLIC_KEY,
};
use testresult::TestResult;

/// Account the contract under test is deployed to.
pub const ESCROW_ID: &str = "escrow.sandbox";

/// A local sandbox node, the way to reach it and the one key that signs for every test account.
pub struct TestChain {
    pub sandbox: Sandbox,
    pub network: NetworkConfig,
    pub signer: Arc<Signer>,
}

impl TestChain {
    /// Starts a fresh sandbox node. It stops when the value is dropped.
    pub async fn start() -> TestResult<Self> {
        let sandbox = Sandbox::start_sandbox().await?;
        let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
        Ok(Self {
            sandbox,
            network,
            signer,
        })
    }

    /// Creates accounts with `near` NEAR each and returns them once they can sign.
    ///
    /// The sandbox creates an account by patching state, and the new account only shows up in
    /// final blocks a moment later. `near-api` reads the signer's nonce from a final block
    /// (`Signer::fetch_tx_nonce`), so a transaction signed too early fails with "Failed to fetch
    /// nonce". Waiting here keeps every test deterministic.
    pub async fn accounts(&self, ids: &[&str], near: u128) -> TestResult<Vec<Account>> {
        let mut accounts = Vec::with_capacity(ids.len());
        for id in ids {
            let account_id: AccountId = id.parse()?;
            // `near-sandbox` and `near-api` use different versions of the account id type, so the
            // text is parsed once for each.
            self.sandbox
                .create_account(id.parse()?)
                .initial_balance(NearToken::from_near(near))
                .send()
                .await?;
            accounts.push(Account(account_id));
        }
        for account in &accounts {
            self.wait_until_final(&account.0).await?;
        }
        Ok(accounts)
    }

    /// Deploys the ticket escrow to [`ESCROW_ID`] and initializes it.
    pub async fn deploy_escrow(&self) -> TestResult<Contract> {
        let account = self.accounts(&[ESCROW_ID], 50).await?.remove(0);
        Contract::deploy(account.0.clone())
            .use_code(escrow_wasm())
            .with_init_call("new", ())?
            .with_signer(self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        Ok(account.as_contract())
    }

    async fn wait_until_final(&self, account_id: &AccountId) -> TestResult<()> {
        let public_key: PublicKey = DEFAULT_GENESIS_ACCOUNT_PUBLIC_KEY.parse()?;
        for _ in 0..200 {
            let key = Account(account_id.clone())
                .access_key(public_key)
                .at(Reference::Final)
                .fetch_from(&self.network)
                .await;
            if key.is_ok() {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("{account_id} did not show up in a final block within 10 seconds");
    }
}

/// The contract's wasm, built once per test binary with `cargo near build`.
pub fn escrow_wasm() -> Vec<u8> {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| {
        let path =
            cargo_near_build::build_with_cli(Default::default()).expect("cargo near build failed");
        std::fs::read(path).expect("the built wasm is readable")
    })
    .clone()
}
