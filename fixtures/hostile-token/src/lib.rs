//! Test fixture: a NEP-141 token that misbehaves on request. Until told otherwise it is the
//! standard token of `near-contract-standards`: balances, storage registration (NEP-145) and
//! `ft_transfer_call` with its resolver. Used by `contract/tests/tokens.rs`. Never deployed
//! outside the sandbox.
//!
//! | `set_mode(mode)` | `ft_transfer` | `ft_transfer_call` |
//! |---|---|---|
//! | `normal` | the standard behaviour | the standard behaviour |
//! | `fail` | panics: nothing moves | panics: nothing moves |
//! | `garbage` | moves the tokens, then answers `maybe`, which is not JSON | standard |
//! | `long` | moves the tokens, then answers as many zero bytes as its gas can pay for | standard |
//!
//! `call_on_transfer(receiver_id, sender_id, amount, msg)` calls `ft_on_transfer` on any contract
//! as a token would during `ft_transfer_call`, with any sender, amount and message, and moves no
//! token: a forged purchase. Its result is the receiver's answer, or the receiver's failure.
//!
//! `mint(account_id, amount)` credits a registered account. Anybody may call every method.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near, require,
};

/// Gas given to the forged `ft_on_transfer` call.
const GAS_FOR_ON_TRANSFER: Gas = Gas::from_tgas(100);
/// `max_length_returned_data` of the protocol: the longest value a call may return.
const MAX_RETURN_BYTES: usize = 4 * 1024 * 1024;
/// Gas a call pays per byte it returns to another receipt, rounded up from 69.5 Mgas measured in
/// the sandbox (`docs/gas.md`).
const GAS_PER_RETURNED_BYTE: u64 = 70_000_000;
/// Gas kept back from a long answer for the rest of `ft_transfer`.
const GAS_KEPT_BACK: Gas = Gas::from_tgas(2);

/// How `ft_transfer` and `ft_transfer_call` behave.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Normal,
    Fail,
    Garbage,
    Long,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct HostileToken {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
    mode: Mode,
}

#[near]
impl HostileToken {
    /// A token with no supply, in mode `normal`.
    #[init]
    pub fn new(symbol: String, decimals: u8) -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: format!("Hostile {symbol}"),
            symbol,
            icon: None,
            reference: None,
            reference_hash: None,
            decimals,
        };
        Self {
            token: FungibleToken::new(b"a".to_vec()),
            metadata,
            mode: Mode::Normal,
        }
    }

    /// `normal`, `fail`, `garbage` or `long` (see the table at the top of this file).
    pub fn set_mode(&mut self, mode: String) {
        self.mode = match mode.as_str() {
            "normal" => Mode::Normal,
            "fail" => Mode::Fail,
            "garbage" => Mode::Garbage,
            "long" => Mode::Long,
            _ => env::panic_str("unknown mode"),
        };
    }

    /// Credits `amount` to a registered account.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("mint"),
        }
        .emit();
    }

    /// Calls `ft_on_transfer(sender_id, amount, msg)` on `receiver_id` as if `sender_id` had sent
    /// it `amount` of this token with `ft_transfer_call`. No token moves.
    pub fn call_on_transfer(
        &mut self,
        receiver_id: AccountId,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> Promise {
        let args = json!({ "sender_id": sender_id, "amount": amount, "msg": msg });
        Promise::new(receiver_id).function_call(
            "ft_on_transfer",
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FOR_ON_TRANSFER,
        )
    }
}

impl HostileToken {
    fn refuse_if_failing(&self) {
        require!(self.mode != Mode::Fail, "this token fails every transfer");
    }

    /// The longest answer the gas left to this call can pay for.
    fn largest_affordable_answer() -> usize {
        let spare = env::prepaid_gas()
            .as_gas()
            .saturating_sub(env::used_gas().as_gas())
            .saturating_sub(GAS_KEPT_BACK.as_gas());
        usize::try_from(spare / GAS_PER_RETURNED_BYTE)
            .unwrap_or(MAX_RETURN_BYTES)
            .min(MAX_RETURN_BYTES)
    }
}

#[near]
impl FungibleTokenCore for HostileToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.refuse_if_failing();
        self.token.ft_transfer(receiver_id, amount, memo);
        match self.mode {
            Mode::Garbage => env::value_return(b"maybe"),
            Mode::Long => env::value_return(vec![0; Self::largest_affordable_answer()]),
            Mode::Normal | Mode::Fail => {}
        }
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.refuse_if_failing();
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for HostileToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .internal_ft_resolve_transfer(&sender_id, receiver_id, amount)
            .0
            .into()
    }
}

#[near]
impl StorageManagement for HostileToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for HostileToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}
