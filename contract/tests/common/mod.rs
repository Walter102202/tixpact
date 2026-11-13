//! Shared sandbox helpers. Every integration test file starts with `mod common;`.
//!
//! Each test file is its own binary and uses a different subset of these helpers, so unused ones
//! are expected.
#![allow(dead_code)]

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use near_api::types::transaction::actions::FunctionCallAction;
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::types::{Action, PublicKey, Reference};
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
        self.deploy_escrow_code(ESCROW_ID, false).await
    }

    /// Deploys the normal build, or the `fault-injection` one, to `id` with 50 NEAR, initializes
    /// it with [`listed_tokens`], and checks that `get_config` reports the build that was asked
    /// for. A swapped build fails here, before any test relies on it.
    pub async fn deploy_escrow_code(
        &self,
        id: &str,
        fault_injection: bool,
    ) -> TestResult<Contract> {
        self.deploy_escrow_listing(id, fault_injection, listed_tokens())
            .await
    }

    /// [`TestChain::deploy_escrow_code`] with `new(tokens)` given these tokens.
    pub async fn deploy_escrow_listing(
        &self,
        id: &str,
        fault_injection: bool,
        tokens: Value,
    ) -> TestResult<Contract> {
        let wasm = if fault_injection {
            faulty_escrow_wasm()
        } else {
            escrow_wasm()
        };
        let account = self.accounts(&[id], 50).await?.remove(0);
        Contract::deploy(account.0.clone())
            .use_code(wasm)
            .with_init_call("new", json!({ "tokens": tokens }))?
            .with_signer(self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        let contract = account.as_contract();
        let config: Value = contract
            .call_function("get_config", ())
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data;
        assert_eq!(
            config["fault_injection"], fault_injection,
            "{id} runs the wrong build"
        );
        Ok(contract)
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
        let contract = self.deploy_escrow_code(ESCROW_ID, false).await?;
        Ok(Escrow {
            chain: self,
            contract,
        })
    }

    /// Deploys the `fault-injection` build at `id` and returns it with its call helpers.
    pub async fn faulty_escrow(&self, id: &str) -> TestResult<Escrow<'_>> {
        let contract = self.deploy_escrow_code(id, true).await?;
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
/// after their transfer.
///
/// It has a cargo target directory and an output folder of its own. With a shared target
/// directory, `cargo near build` copies `target/wasm32-unknown-unknown/release/ticket_escrow.wasm`
/// after cargo has released its lock, so a normal build running in another test thread could
/// replace that file in between and each build would ship the other's wasm.
pub fn faulty_escrow_wasm() -> Vec<u8> {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| {
        build_wasm(cargo_near_build::BuildOpts {
            features: Some("fault-injection".to_string()),
            out_dir: Some(out_dir("fault-injection")),
            override_cargo_target_dir: Some(format!(
                "{}/fault-injection-target",
                env!("CARGO_TARGET_TMPDIR")
            )),
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

/// The wasm of the test fixture in `fixtures/ticket-receiver`.
pub fn ticket_receiver_wasm() -> Vec<u8> {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| fixture_wasm("ticket-receiver")).clone()
}

/// The wasm of the plain NEP-141 token in `fixtures/test-token`.
pub fn test_token_wasm() -> Vec<u8> {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| fixture_wasm("test-token")).clone()
}

/// The wasm of the misbehaving NEP-141 token in `fixtures/hostile-token`.
pub fn hostile_token_wasm() -> Vec<u8> {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| fixture_wasm("hostile-token")).clone()
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

/// yoctoNEAR per byte of storage on this protocol version.
pub const STORAGE_BYTE_COST: u128 = 10_000_000_000_000_000_000;
/// Gas of each function call inside an [`Escrow::batch`], in Tgas.
pub const TGAS_PER_CALL: u64 = 25;

/// A 64-character sandbox account id, the longest NEAR allows.
pub fn long_id(name: &str) -> String {
    let id = format!("{name:x<56}.sandbox");
    assert_eq!(id.len(), 64);
    id
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

    /// One transaction from `signer` to the escrow, with one function call of
    /// [`TGAS_PER_CALL`] per `(method, args, deposit in yoctoNEAR)`. If any call fails, none of
    /// them changes anything.
    pub async fn batch(
        &self,
        signer: &Account,
        calls: Vec<(&str, Value, u128)>,
    ) -> TestResult<ExecutionFinalResult> {
        let actions = calls
            .into_iter()
            .map(|(method, args, deposit)| {
                Action::FunctionCall(Box::new(FunctionCallAction {
                    method_name: method.to_string(),
                    args: args.to_string().into_bytes(),
                    gas: NearGas::from_tgas(TGAS_PER_CALL),
                    deposit: NearToken::from_yoctonear(deposit),
                }))
            })
            .collect();
        let result = near_api::Transaction::construct(signer.0.clone(), self.id())
            .add_actions(actions)
            .with_signer(self.chain.signer.clone())
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

    /// An `nft_transfer_call` to `to` with `msg`, sent as `from` with 1 yocto and `tgas`.
    pub async fn transfer_call(
        &self,
        from: &Account,
        to: &AccountId,
        token_id: &str,
        msg: &str,
        tgas: u64,
    ) -> TestResult<ExecutionFinalResult> {
        let args = json!({
            "receiver_id": to,
            "token_id": token_id,
            "approval_id": null,
            "memo": null,
            "msg": msg,
        });
        self.call(from, "nft_transfer_call", args, ONE_YOCTO, tgas)
            .await
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

/// The `data` objects of a transaction's NEP-171 events named `name` (`nft_mint`,
/// `nft_transfer`), in log order, after checking each event's envelope.
pub fn nep171_events(result: &ExecutionFinalResult, name: &str) -> Vec<Value> {
    events_named(result, name)
        .into_iter()
        .filter(|event| event["standard"] == "nep171")
        .flat_map(|event| {
            assert_eq!(event["version"], "1.0.0", "NEP-171 event version: {event}");
            event["data"].as_array().cloned().unwrap_or_default()
        })
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

// Tokens (plan v2, "Currencies"; fixtures `test-token` and `hostile-token`).

/// `fixtures/test-token` as a dollar: symbol `tUSD`, 6 decimals.
pub const TUSD_ID: &str = "tusd.sandbox";
/// `fixtures/test-token` with 24 decimals, so that its amounts are as large as NEAR's and a mix-up
/// between the two currencies shows in every number.
pub const TEUR_ID: &str = "teur.sandbox";
/// `fixtures/hostile-token`, symbol `HOST`, 18 decimals.
pub const HOSTILE_ID: &str = "hostile.sandbox";
/// A `fixtures/hostile-token` that no escrow lists.
pub const UNLISTED_ID: &str = "unlisted.sandbox";
/// One whole tUSD, in its smallest unit.
pub const USD: u128 = 1_000_000;
/// One whole HOST, in its smallest unit.
pub const HOST: u128 = 1_000_000_000_000_000_000;

/// The tokens every escrow under test accepts (`new(tokens)`): tUSD, tEUR and HOST. Their
/// contracts are deployed only by the tests that use them.
pub fn listed_tokens() -> Value {
    json!([
        { "account_id": TUSD_ID, "symbol": "tUSD", "decimals": 6 },
        { "account_id": TEUR_ID, "symbol": "tEUR", "decimals": 24 },
        { "account_id": HOSTILE_ID, "symbol": "HOST", "decimals": 18 },
    ])
}

/// Event terms priced in `currency` (`None` is NEAR) at `price` of its smallest unit.
pub fn priced_terms(
    verifier: &Account,
    times: [u64; 3],
    capacity: u32,
    currency: Option<&str>,
    price: u128,
) -> Value {
    let mut terms = terms(verifier, times, capacity);
    terms["price"] = json!(price.to_string());
    terms["currency"] = json!(currency);
    terms
}

/// The `msg` of a purchase through `ft_transfer_call`.
pub fn purchase_msg(event_id: u32) -> String {
    json!({ "event_id": event_id }).to_string()
}

/// Asserts that a purchase through `ft_transfer_call` was rejected with `code`: the escrow's
/// `ft_on_transfer` failed with it, the token's resolver reports that nothing was used (`"0"`),
/// and no ticket was minted. Whether every token came back is checked on the balances.
#[track_caller]
pub fn assert_purchase_rejected(result: &ExecutionFinalResult, escrow: &AccountId, code: &str) {
    let failures: Vec<String> = result
        .receipt_failures()
        .into_iter()
        .filter(|outcome| &outcome.executor_id == escrow)
        .map(|outcome| format!("{:?}", outcome.clone().into_result()))
        .collect();
    assert_eq!(failures.len(), 1, "one failed escrow receipt: {failures:?}");
    assert!(
        failures[0].contains(&format!("Smart contract panicked: {code}: ")),
        "expected {code}, got: {failures:?}"
    );
    let used: String = result
        .clone()
        .assert_success()
        .json()
        .expect("ft_transfer_call returns the amount used");
    assert_eq!(used, "0", "the token used nothing");
    assert!(nep171_events(result, "nft_mint").is_empty(), "no ticket minted");
    assert!(events_named(result, "ticket_purchased").is_empty());
}

/// Asserts that a purchase through `ft_transfer_call` bought a ticket for exactly `price`: the
/// token's resolver reports the whole amount used, and one `ticket_purchased` event was logged.
/// Returns the ticket's id.
#[track_caller]
pub fn assert_purchase_accepted(result: &ExecutionFinalResult, price: u128) -> String {
    let used: String = result
        .clone()
        .assert_success()
        .json()
        .expect("ft_transfer_call returns the amount used");
    assert_eq!(used, price.to_string(), "the token used the whole price");
    let purchased = events_named(result, "ticket_purchased");
    assert_eq!(purchased.len(), 1, "one purchase: {purchased:?}");
    purchased[0]["data"][0]["token_id"]
        .as_str()
        .unwrap_or_else(|| panic!("ticket_purchased without a token id: {purchased:?}"))
        .to_string()
}

/// Gas of the buyer's `ft_transfer_call`, as the client attaches it (`buyTicketWithToken`), in
/// Tgas.
pub const FT_TRANSFER_CALL_TGAS: u64 = 100;
/// Gas of a plain call to a token (`ft_transfer`, `storage_deposit`, `faucet`), in Tgas.
pub const TOKEN_CALL_TGAS: u64 = 30;
/// NEAR attached to `storage_deposit`: more than any token's minimum; the token sends the rest
/// back to the payer.
pub const REGISTRATION_DEPOSIT: u128 = NEAR / 100;

/// A NEP-141 token contract deployed in the sandbox.
pub struct Token<'a> {
    pub chain: &'a TestChain,
    pub id: AccountId,
}

impl TestChain {
    /// Deploys `fixtures/test-token` to `id` as `new(name, symbol, decimals)`.
    pub async fn test_token(&self, id: &str, symbol: &str, decimals: u8) -> TestResult<Token<'_>> {
        let args =
            json!({ "name": format!("Test {symbol}"), "symbol": symbol, "decimals": decimals });
        let account = self
            .deploy_with_init(id, 10, test_token_wasm(), "new", args)
            .await?;
        Ok(Token {
            chain: self,
            id: account.0,
        })
    }

    /// Deploys `fixtures/hostile-token` to `id` as `new(symbol, decimals)`, in mode `normal`.
    pub async fn hostile_token(
        &self,
        id: &str,
        symbol: &str,
        decimals: u8,
    ) -> TestResult<Token<'_>> {
        let args = json!({ "symbol": symbol, "decimals": decimals });
        let account = self
            .deploy_with_init(id, 10, hostile_token_wasm(), "new", args)
            .await?;
        Ok(Token {
            chain: self,
            id: account.0,
        })
    }

    /// Creates `id` with `near` NEAR, deploys `wasm` to it and calls its init method.
    pub async fn deploy_with_init(
        &self,
        id: &str,
        near: u128,
        wasm: Vec<u8>,
        method: &str,
        args: Value,
    ) -> TestResult<Account> {
        let account = self.accounts(&[id], near).await?.remove(0);
        Contract::deploy(account.0.clone())
            .use_code(wasm)
            .with_init_call(method, args)?
            .with_signer(self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        Ok(account)
    }
}

impl Token<'_> {
    /// A view of the token.
    pub async fn view<T: DeserializeOwned + Send + Sync>(
        &self,
        method: &str,
        args: Value,
    ) -> TestResult<T> {
        Ok(Contract(self.id.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.chain.network)
            .await?
            .data)
    }

    /// `ft_balance_of`, in the token's smallest unit.
    pub async fn balance_of(&self, account_id: &AccountId) -> TestResult<u128> {
        let balance: String = self
            .view("ft_balance_of", json!({ "account_id": account_id }))
            .await?;
        Ok(balance.parse()?)
    }

    /// Whether `account_id` is registered with the token (`storage_balance_of` is not null).
    pub async fn is_registered(&self, account_id: &AccountId) -> TestResult<bool> {
        let balance: Value = self
            .view("storage_balance_of", json!({ "account_id": account_id }))
            .await?;
        Ok(!balance.is_null())
    }

    /// `payer` registers `account_id` with the token (`storage_deposit`, registration only).
    pub async fn register(&self, payer: &Account, account_id: &AccountId) -> TestResult<()> {
        let args = json!({ "account_id": account_id, "registration_only": true });
        let deposit = NearToken::from_yoctonear(REGISTRATION_DEPOSIT);
        self.call(payer, "storage_deposit", args, deposit, TOKEN_CALL_TGAS)
            .await?
            .assert_success();
        Ok(())
    }

    /// `account` calls the test token's faucet; returns the amount minted.
    pub async fn faucet(&self, account: &Account) -> TestResult<u128> {
        let minted: String = self
            .call(account, "faucet", json!({}), NO_DEPOSIT, TOKEN_CALL_TGAS)
            .await?
            .assert_success()
            .json()?;
        Ok(minted.parse()?)
    }

    /// The hostile token credits `amount` to a registered account (the call is open to anyone).
    pub async fn mint(
        &self,
        signer: &Account,
        account_id: &AccountId,
        amount: u128,
    ) -> TestResult<()> {
        let args = json!({ "account_id": account_id, "amount": amount.to_string() });
        self.call(signer, "mint", args, NO_DEPOSIT, TOKEN_CALL_TGAS)
            .await?
            .assert_success();
        Ok(())
    }

    /// Switches the hostile token to `normal`, `fail`, `garbage` or `long`.
    pub async fn set_mode(&self, signer: &Account, mode: &str) -> TestResult<()> {
        let args = json!({ "mode": mode });
        self.call(signer, "set_mode", args, NO_DEPOSIT, TOKEN_CALL_TGAS)
            .await?
            .assert_success();
        Ok(())
    }

    /// A plain `ft_transfer` of `amount` from `from` to `to`, with 1 yoctoNEAR.
    pub async fn transfer(
        &self,
        from: &Account,
        to: &AccountId,
        amount: u128,
    ) -> TestResult<ExecutionFinalResult> {
        let args = json!({ "receiver_id": to, "amount": amount.to_string(), "memo": null });
        self.call(from, "ft_transfer", args, ONE_YOCTO, TOKEN_CALL_TGAS)
            .await
    }

    /// `ft_transfer_call` of `amount` from `from` to `receiver` with `msg`, 1 yoctoNEAR and the
    /// client's gas. The transaction succeeds even when the receiver rejects the tokens: the
    /// token's resolver then sends them back, and returns `"0"` as the amount used.
    pub async fn transfer_call(
        &self,
        from: &Account,
        receiver: &AccountId,
        amount: u128,
        msg: &str,
    ) -> TestResult<ExecutionFinalResult> {
        let args = json!({
            "receiver_id": receiver,
            "amount": amount.to_string(),
            "memo": null,
            "msg": msg,
        });
        self.call(
            from,
            "ft_transfer_call",
            args,
            ONE_YOCTO,
            FT_TRANSFER_CALL_TGAS,
        )
        .await
    }

    /// The hostile token calls `ft_on_transfer(sender_id, amount, msg)` on `receiver` without
    /// moving any token. The transaction fails with the receiver's failure.
    pub async fn forge_on_transfer(
        &self,
        signer: &Account,
        receiver: &AccountId,
        sender_id: &AccountId,
        amount: u128,
        msg: &str,
    ) -> TestResult<ExecutionFinalResult> {
        let args = json!({
            "receiver_id": receiver,
            "sender_id": sender_id,
            "amount": amount.to_string(),
            "msg": msg,
        });
        self.call(signer, "call_on_transfer", args, NO_DEPOSIT, 300)
            .await
    }

    /// Signs and sends one function call to the token; returns its outcome whether it failed or
    /// not.
    pub async fn call(
        &self,
        signer: &Account,
        method: &str,
        args: Value,
        deposit: NearToken,
        tgas: u64,
    ) -> TestResult<ExecutionFinalResult> {
        self.chain
            .call(signer, &self.id, method, args, deposit, tgas)
            .await
    }
}

/// One token movement: a NEP-141 `ft_transfer` event logged by a receipt of the token that
/// succeeded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenMove {
    pub from: String,
    pub to: String,
    pub amount: u128,
}

/// Every token movement `token` logged in a transaction, in log order. A receipt that failed
/// moved nothing, so its logs are skipped.
pub fn token_moves(result: &ExecutionFinalResult, token: &AccountId) -> Vec<TokenMove> {
    result
        .receipt_outcomes()
        .iter()
        .filter(|outcome| &outcome.executor_id == token && outcome.is_success())
        .flat_map(|outcome| outcome.logs.clone())
        .filter_map(|line| {
            let text = line.strip_prefix("EVENT_JSON:")?;
            near_sdk::serde_json::from_str::<Value>(text).ok()
        })
        .filter(|event| event["standard"] == "nep141" && event["event"] == "ft_transfer")
        .flat_map(|event| event["data"].as_array().cloned().unwrap_or_default())
        .map(|data| TokenMove {
            from: data["old_owner_id"].as_str().unwrap_or("").to_string(),
            to: data["new_owner_id"].as_str().unwrap_or("").to_string(),
            amount: data["amount"]
                .as_str()
                .and_then(|text| text.parse().ok())
                .unwrap_or_else(|| panic!("ft_transfer event without an amount: {data}")),
        })
        .collect()
}

/// One function call found among a transaction's receipts.
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub receiver: String,
    pub method: String,
    pub args: Value,
    pub deposit: u128,
    pub succeeded: bool,
}

impl TestChain {
    /// Every function call that `sender` made in a transaction's receipt tree, with whether its
    /// receipt succeeded. The arguments are parsed as JSON (`null` when they are not JSON).
    pub async fn calls_from(
        &self,
        result: &ExecutionFinalResult,
        sender: &AccountId,
    ) -> TestResult<Vec<Call>> {
        use near_sdk::base64::Engine;
        let mut calls = Vec::new();
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
                let call = &action["FunctionCall"];
                let Some(method) = call["method_name"].as_str() else {
                    continue;
                };
                let args = call["args"]
                    .as_str()
                    .and_then(|text| {
                        near_sdk::base64::engine::general_purpose::STANDARD
                            .decode(text)
                            .ok()
                    })
                    .and_then(|bytes| near_sdk::serde_json::from_slice(&bytes).ok())
                    .unwrap_or(Value::Null);
                calls.push(Call {
                    receiver: receipt["receiver_id"].as_str().unwrap_or("").to_string(),
                    method: method.to_string(),
                    args,
                    deposit: call["deposit"]
                        .as_str()
                        .and_then(|text| text.parse().ok())
                        .unwrap_or_else(|| panic!("a function call without a deposit: {call}")),
                    succeeded: outcome.is_success(),
                });
            }
        }
        Ok(calls)
    }
}

/// The value a transaction's last receipt on `executor` returned, as raw bytes.
pub fn value_returned_by(result: &ExecutionFinalResult, executor: &AccountId) -> Option<Vec<u8>> {
    use near_api::types::transaction::result::ValueOrReceiptId;
    result
        .receipt_outcomes()
        .iter()
        .filter(|outcome| &outcome.executor_id == executor)
        .filter_map(|outcome| match outcome.clone().into_result() {
            Ok(ValueOrReceiptId::Value(value)) => value.raw_bytes().ok(),
            _ => None,
        })
        .next_back()
}
