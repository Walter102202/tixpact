//! Shared sandbox helpers. Every integration test file starts with `mod common;`.
//!
//! Each test file is its own binary and uses a different subset of these helpers, so unused ones
//! are expected.
#![allow(dead_code)]

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::types::{PublicKey, Reference};
use near_api::{Account, AccountId, Chain, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::Sandbox;
use near_sandbox::config::{
    DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY, DEFAULT_GENESIS_ACCOUNT_PUBLIC_KEY,
};
use near_sdk::serde::de::DeserializeOwned;
use near_sdk::serde_json::{Value, json};
use testresult::TestResult;

/// Account the contract under test is deployed to.
pub const ESCROW_ID: &str = "escrow.sandbox";
/// The deposit of every 1-yocto method.
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// No deposit.
pub const NO_DEPOSIT: NearToken = NearToken::from_yoctonear(0);
/// One NEAR in yoctoNEAR.
pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
/// A ticket price used across the tests: 1.5 NEAR.
pub const PRICE: u128 = 1_500_000_000_000_000_000_000_000;
/// Gas attached to every call unless a test needs another amount, in Tgas.
pub const TGAS: u64 = 100;
/// The gas fees of one call stay far below this, so balance checks use it as their bound.
pub const GAS_FEE_BOUND: u128 = NEAR / 100;

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
        self.deploy_escrow_code(ESCROW_ID, escrow_wasm()).await
    }

    /// Deploys an escrow build (`escrow_wasm` or `faulty_escrow_wasm`) to `id` with 50 NEAR and
    /// initializes it.
    pub async fn deploy_escrow_code(&self, id: &str, wasm: Vec<u8>) -> TestResult<Contract> {
        let account = self.accounts(&[id], 50).await?.remove(0);
        Contract::deploy(account.0.clone())
            .use_code(wasm)
            .with_init_call("new", ())?
            .with_signer(self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        Ok(account.as_contract())
    }

    /// Creates `id` with `near` NEAR and deploys a fixture to it. Fixtures have no init method.
    pub async fn deploy_fixture(&self, id: &str, near: u128, wasm: Vec<u8>) -> TestResult<Account> {
        let account = self.accounts(&[id], near).await?.remove(0);
        Contract::deploy(account.0.clone())
            .use_code(wasm)
            .without_init_call()
            .with_signer(self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        Ok(account)
    }

    /// Signs and sends one function call to any contract; returns its outcome whether it failed
    /// or not.
    pub async fn call(
        &self,
        signer: &Account,
        receiver: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
        tgas: u64,
    ) -> TestResult<ExecutionFinalResult> {
        let result = Contract(receiver.clone())
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(tgas))
            .with_signer(signer.0.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?;
        Ok(result
            .into_full()
            .ok_or("send_to returned before the transaction ran")?)
    }

    /// Whether an account exists in the latest block.
    pub async fn exists(&self, account_id: &AccountId) -> bool {
        Account(account_id.clone())
            .view()
            .fetch_from(&self.network)
            .await
            .is_ok()
    }

    /// Bytes of storage an account uses.
    pub async fn storage_usage(&self, account_id: &AccountId) -> TestResult<u64> {
        let balance = Account(account_id.clone())
            .tokens()
            .near_balance()
            .fetch_from(&self.network)
            .await?;
        Ok(balance.storage_usage)
    }

    /// Sets an account's balance by patching the sandbox state, and waits until views show it.
    /// Tests use it to build a liquidity shortfall the protocol would never produce on its own.
    pub async fn set_balance(&self, account_id: &AccountId, yocto: u128) -> TestResult<()> {
        let view = Account(account_id.clone())
            .view()
            .fetch_from(&self.network)
            .await?
            .data;
        let near_api::types::account::ContractState::LocalHash(code_hash) = view.contract_state
        else {
            return Err("set_balance expects an account with its own contract code".into());
        };
        let record = json!({
            "amount": yocto.to_string(),
            "locked": view.locked.as_yoctonear().to_string(),
            "code_hash": code_hash.to_string(),
            "storage_usage": view.storage_usage,
        });
        self.sandbox
            .patch_state(account_id.as_str().parse()?)
            .account(record)
            .send()
            .await?;
        for _ in 0..200 {
            if self.balance(account_id).await? == yocto {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("the patched balance of {account_id} did not show up within 10 seconds");
    }

    /// The time of the latest block, in Unix milliseconds.
    pub async fn now_ms(&self) -> TestResult<u64> {
        let block = Chain::block().fetch_from(&self.network).await?;
        Ok(block.header.timestamp / 1_000_000)
    }

    /// Produces blocks until the latest block time is at least `target_ms`.
    ///
    /// A fast-forwarded block moves the clock by roughly 0.3 s, so this asks for a few blocks at
    /// a time and reads the clock again instead of assuming a rate.
    pub async fn advance_to(&self, target_ms: u64) -> TestResult<()> {
        loop {
            let now_ms = self.now_ms().await?;
            if now_ms >= target_ms {
                return Ok(());
            }
            let blocks = ((target_ms - now_ms) / 400).clamp(1, 150);
            self.sandbox.fast_forward(blocks).await?;
        }
    }

    /// The block time at which the first receipt of a transaction ran, in Unix milliseconds.
    pub async fn executed_at_ms(&self, result: &ExecutionFinalResult) -> TestResult<u64> {
        let outcome = result
            .receipt_outcomes()
            .first()
            .ok_or("the transaction produced no receipt")?;
        let block = Chain::block()
            .at(Reference::AtBlockHash(outcome.block_hash))
            .fetch_from(&self.network)
            .await?;
        Ok(block.header.timestamp / 1_000_000)
    }

    /// The NEAR balance of an account, in yoctoNEAR.
    pub async fn balance(&self, account_id: &AccountId) -> TestResult<u128> {
        let balance = Account(account_id.clone())
            .tokens()
            .near_balance()
            .fetch_from(&self.network)
            .await?;
        Ok(balance.total.as_yoctonear())
    }

    /// Deploys the escrow at [`ESCROW_ID`] and returns it with its call helpers.
    pub async fn escrow(&self) -> TestResult<Escrow<'_>> {
        self.escrow_with(ESCROW_ID, escrow_wasm()).await
    }

    /// Deploys an escrow build at `id` and returns it with its call helpers.
    pub async fn escrow_with(&self, id: &str, wasm: Vec<u8>) -> TestResult<Escrow<'_>> {
        let contract = self.deploy_escrow_code(id, wasm).await?;
        Ok(Escrow {
            chain: self,
            contract,
        })
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

/// The contract built with the `fault-injection` feature: its settlement callbacks run out of gas
/// after their transfer. Written to its own folder so it never replaces the normal build.
pub fn faulty_escrow_wasm() -> Vec<u8> {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| {
        build_wasm(cargo_near_build::BuildOpts {
            features: Some("fault-injection".to_string()),
            out_dir: Some(out_dir("fault-injection")),
            ..Default::default()
        })
    })
    .clone()
}

/// The wasm of the test fixture in `fixtures/vanishing-holder`.
pub fn vanishing_holder_wasm() -> Vec<u8> {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| fixture_wasm("vanishing-holder"))
        .clone()
}

fn fixture_wasm(name: &str) -> Vec<u8> {
    let manifest = format!(
        "{}/../fixtures/{name}/Cargo.toml",
        env!("CARGO_MANIFEST_DIR")
    );
    build_wasm(cargo_near_build::BuildOpts {
        manifest_path: Some(manifest.into()),
        no_abi: true,
        out_dir: Some(out_dir(name)),
        ..Default::default()
    })
}

fn out_dir(name: &str) -> cargo_near_build::camino::Utf8PathBuf {
    format!("{}/wasm/{name}", env!("CARGO_TARGET_TMPDIR")).into()
}

fn build_wasm(opts: cargo_near_build::BuildOpts) -> Vec<u8> {
    let path = cargo_near_build::build_with_cli(opts).expect("cargo near build failed");
    std::fs::read(path).expect("the built wasm is readable")
}

/// The people of the story, each with 20 NEAR.
pub struct Cast {
    pub organizer: Account,
    pub verifier: Account,
    pub ana: Account,
    pub luis: Account,
    /// Somebody with no role in the event.
    pub mallory: Account,
}

impl TestChain {
    /// Creates the cast's accounts.
    pub async fn cast(&self) -> TestResult<Cast> {
        let ids = [
            "org.sandbox",
            "teatro.sandbox",
            "ana.sandbox",
            "luis.sandbox",
            "mallory.sandbox",
        ];
        let mut accounts = self.accounts(&ids, 20).await?.into_iter();
        let mut next = || accounts.next().ok_or("an account is missing");
        Ok(Cast {
            organizer: next()?,
            verifier: next()?,
            ana: next()?,
            luis: next()?,
            mallory: next()?,
        })
    }

    /// Start, end and deadline at the given offsets from the latest block time, in seconds.
    pub async fn times_from_now(&self, offsets_s: [u64; 3]) -> TestResult<[u64; 3]> {
        let now_ms = self.now_ms().await?;
        Ok(offsets_s.map(|offset| now_ms + offset * 1_000))
    }
}

/// The escrow under test and the chain it runs on.
pub struct Escrow<'a> {
    pub chain: &'a TestChain,
    pub contract: Contract,
}

impl Escrow<'_> {
    /// The escrow's account id.
    pub fn id(&self) -> AccountId {
        self.contract.0.clone()
    }

    /// Signs and sends one function call; returns its outcome whether it failed or not.
    pub async fn call(
        &self,
        signer: &Account,
        method: &str,
        args: Value,
        deposit: NearToken,
        tgas: u64,
    ) -> TestResult<ExecutionFinalResult> {
        let result = self
            .contract
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(tgas))
            .with_signer(signer.0.clone(), self.chain.signer.clone())
            .send_to(&self.chain.network)
            .await?;
        Ok(result
            .into_full()
            .ok_or("send_to returned before the transaction ran")?)
    }

    /// Calls a view method.
    pub async fn view<T: DeserializeOwned + Send + Sync>(
        &self,
        method: &str,
        args: Value,
    ) -> TestResult<T> {
        Ok(self
            .contract
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.chain.network)
            .await?
            .data)
    }

    /// `quote_event_budget(capacity)`, in yoctoNEAR.
    pub async fn quote(&self, capacity: u32) -> TestResult<u128> {
        let quote: String = self
            .view("quote_event_budget", json!({ "capacity": capacity }))
            .await?;
        Ok(quote.parse()?)
    }

    /// Creates an event with exactly the quote as deposit and returns its id.
    pub async fn create_event(&self, organizer: &Account, terms: Value) -> TestResult<u32> {
        let capacity = u32::try_from(terms["capacity"].as_u64().ok_or("terms without capacity")?)?;
        let deposit = NearToken::from_yoctonear(self.quote(capacity).await?);
        let args = json!({ "terms": terms });
        let result = self
            .call(organizer, "create_event", args, deposit, TGAS)
            .await?;
        Ok(result.assert_success().json()?)
    }

    /// The verifier accepts the event's terms hash, as read from `get_event`.
    pub async fn accept(&self, verifier: &Account, event_id: u32) -> TestResult<()> {
        let hash = self.event(event_id).await?["terms_hash"].clone();
        let args = json!({ "event_id": event_id, "terms_hash": hash });
        self.call(verifier, "accept_verification", args, ONE_YOCTO, TGAS)
            .await?
            .assert_success();
        Ok(())
    }

    /// Buys a ticket for exactly `price` and returns its token id.
    pub async fn buy(&self, buyer: &Account, event_id: u32, price: u128) -> TestResult<String> {
        let deposit = NearToken::from_yoctonear(price);
        let args = json!({ "event_id": event_id });
        let result = self.call(buyer, "buy_ticket", args, deposit, TGAS).await?;
        Ok(result.assert_success().json()?)
    }

    /// A plain `nft_transfer`, sent as `from`.
    pub async fn transfer(
        &self,
        from: &Account,
        to: &AccountId,
        token_id: &str,
    ) -> TestResult<ExecutionFinalResult> {
        let args =
            json!({ "receiver_id": to, "token_id": token_id, "approval_id": null, "memo": null });
        self.call(from, "nft_transfer", args, ONE_YOCTO, TGAS).await
    }

    /// `claim_refund` sent by `holder` with 1 yocto and `tgas`.
    pub async fn claim_refund(
        &self,
        holder: &Account,
        token_id: &str,
        tgas: u64,
    ) -> TestResult<ExecutionFinalResult> {
        let args = json!({ "token_id": token_id });
        self.call(holder, "claim_refund", args, ONE_YOCTO, tgas)
            .await
    }

    /// `claim_payout` sent by `organizer` with 1 yocto and 100 Tgas.
    pub async fn claim_payout(
        &self,
        organizer: &Account,
        event_id: u32,
    ) -> TestResult<ExecutionFinalResult> {
        let args = json!({ "event_id": event_id });
        self.call(organizer, "claim_payout", args, ONE_YOCTO, TGAS)
            .await
    }

    /// `cancel_event` by the organizer or the verifier, asserted to succeed.
    pub async fn cancel(&self, by: &Account, event_id: u32) -> TestResult<()> {
        let args = json!({ "event_id": event_id, "reason_ref": null });
        self.call(by, "cancel_event", args, ONE_YOCTO, TGAS)
            .await?
            .assert_success();
        Ok(())
    }

    /// `attest_completed` by the verifier, asserted to succeed.
    pub async fn attest(&self, verifier: &Account, event_id: u32) -> TestResult<()> {
        let args = json!({ "event_id": event_id, "evidence_ref": null });
        self.call(verifier, "attest_completed", args, ONE_YOCTO, TGAS)
            .await?
            .assert_success();
        Ok(())
    }

    pub async fn operation(&self, operation_id: u64) -> TestResult<Value> {
        self.view("get_operation", json!({ "operation_id": operation_id }))
            .await
    }

    pub async fn history(&self, token_id: &str) -> TestResult<Value> {
        self.view("get_ticket_history", json!({ "token_id": token_id }))
            .await
    }

    /// The sum over the given events of `principal_reserved + organizer_available`: what the
    /// contract holds for others.
    pub async fn held(&self, event_ids: &[u32]) -> TestResult<u128> {
        let mut held = 0;
        for event_id in event_ids {
            let view = self.accounting(*event_id).await?;
            held += amount(&view, "principal_reserved") + amount(&view, "organizer_available");
        }
        Ok(held)
    }

    pub async fn event(&self, event_id: u32) -> TestResult<Value> {
        self.view("get_event", json!({ "event_id": event_id }))
            .await
    }

    pub async fn ticket(&self, token_id: &str) -> TestResult<Value> {
        self.view("get_ticket", json!({ "token_id": token_id }))
            .await
    }

    /// The event's ledger, after checking the accounting identity on it.
    pub async fn accounting(&self, event_id: u32) -> TestResult<Value> {
        let view: Value = self
            .view("get_accounting", json!({ "event_id": event_id }))
            .await?;
        assert_identity(&view);
        Ok(view)
    }
}

/// Event terms with the given start, end and deadline. Title, venue and price are the defaults.
pub fn terms(verifier: &Account, times: [u64; 3], capacity: u32) -> Value {
    json!({
        "title": "Jazz night",
        "venue": "Teatro Municipal",
        "starts_at_ms": times[0],
        "ends_at_ms": times[1],
        "resolution_deadline_ms": times[2],
        "price": PRICE.to_string(),
        "capacity": capacity,
        "verifier_id": verifier.0,
    })
}

/// A yoctoNEAR amount field of a view.
#[track_caller]
pub fn amount(view: &Value, field: &str) -> u128 {
    view[field]
        .as_str()
        .and_then(|text| text.parse().ok())
        .unwrap_or_else(|| panic!("{field} is not a decimal amount string: {view}"))
}

/// Asserts the accounting identity on an `AccountingView`.
#[track_caller]
pub fn assert_identity(view: &Value) {
    let parts = [
        "principal_reserved",
        "organizer_available",
        "refund_pending",
        "organizer_pending",
        "refunds_settled",
        "organizer_settled",
    ];
    let sum: u128 = parts.iter().map(|field| amount(view, field)).sum();
    assert_eq!(
        sum,
        amount(view, "principal_received"),
        "accounting identity broken: {view}"
    );
}

/// The failure of a transaction as text, or `None` if it succeeded.
pub fn failure_text(result: &ExecutionFinalResult) -> Option<String> {
    match result.clone().into_result() {
        Ok(_) => None,
        Err(failure) => Some(failure.to_string()),
    }
}

/// Asserts that a transaction failed with a contract panic that starts with `code`.
#[track_caller]
pub fn assert_fails_with(result: &ExecutionFinalResult, code: &str) {
    let text = failure_text(result)
        .unwrap_or_else(|| panic!("expected {code}, but the transaction succeeded"));
    assert!(
        text.contains(&format!("Smart contract panicked: {code}: ")),
        "expected {code}, got: {text}"
    );
}

/// One NEAR transfer found among a transaction's receipts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transfer {
    pub receiver: String,
    pub amount: u128,
    pub succeeded: bool,
}

impl TestChain {
    /// Every NEAR transfer that `sender` sent in a transaction's receipt tree, with whether it
    /// arrived. Gas refunds come from the system, not from `sender`, so they are not counted.
    pub async fn transfers_from(
        &self,
        result: &ExecutionFinalResult,
        sender: &AccountId,
    ) -> TestResult<Vec<Transfer>> {
        let mut transfers = Vec::new();
        for outcome in result.receipt_outcomes() {
            let receipt = near_api::Transaction::receipt(outcome.transaction_hash)
                .fetch_from(&self.network)
                .await?;
            let receipt = near_sdk::serde_json::to_value(&receipt)?;
            if receipt["predecessor_id"] != sender.as_str() {
                continue;
            }
            let actions = receipt["receipt"]["Action"]["actions"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            for action in actions {
                if let Some(deposit) = action["Transfer"]["deposit"].as_str() {
                    transfers.push(Transfer {
                        receiver: receipt["receiver_id"].as_str().unwrap_or("").to_string(),
                        amount: deposit.parse()?,
                        succeeded: outcome.is_success(),
                    });
                }
            }
        }
        Ok(transfers)
    }
}

/// How many receipts ran on `account_id` and failed.
pub fn failed_receipts_on(result: &ExecutionFinalResult, account_id: &AccountId) -> usize {
    result
        .receipt_failures()
        .iter()
        .filter(|outcome| &outcome.executor_id == account_id)
        .count()
}

/// The panic messages (and other failures) of every failed receipt, as text.
pub fn receipt_failure_texts(result: &ExecutionFinalResult) -> Vec<String> {
    result
        .receipt_failures()
        .into_iter()
        .map(|outcome| format!("{:?}", outcome.clone().into_result()))
        .collect()
}

/// The `EVENT_JSON` logs of a transaction whose `event` field is `name`.
pub fn events_named(result: &ExecutionFinalResult, name: &str) -> Vec<Value> {
    result
        .logs()
        .iter()
        .filter_map(|line| line.strip_prefix("EVENT_JSON:"))
        .filter_map(|text| near_sdk::serde_json::from_str::<Value>(text).ok())
        .filter(|event| event["event"] == name)
        .collect()
}
