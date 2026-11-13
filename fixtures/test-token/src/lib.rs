//! A plain NEP-141 token: the standard implementation of `near-contract-standards` with storage
//! management (NEP-145) and metadata (NEP-148), plus a `faucet` that gives 100 whole units to any
//! registered caller.
//!
//! Events of the ticket escrow can be priced in it. The sandbox tests deploy it
//! (`contract/tests/tokens.rs`), and it is also deployed on testnet as the dollar token of the
//! demo. It has no owner, no admin method and no upgrade method: anybody can mint with the faucet,
//! so it is worth nothing.

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
use near_sdk::{AccountId, NearToken, PanicOnDefault, PromiseOrValue, env, log, near, require};

/// Whole units the faucet gives per call.
pub const FAUCET_WHOLE_UNITS: u128 = 100;
/// The most decimals a token may have: the escrow accepts no more (`TokenSpec`).
pub const MAX_DECIMALS: u8 = 24;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
}

#[near]
impl TestToken {
    /// A token with no supply. `symbol` is what wallets show (for example `tUSD`), `decimals` how
    /// many digits of the smallest unit make one whole unit.
    #[init]
    pub fn new(name: String, symbol: String, decimals: u8) -> Self {
        require!(decimals <= MAX_DECIMALS, "decimals must be at most 24");
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol,
            icon: None,
            reference: None,
            reference_hash: None,
            decimals,
        };
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(b"a".to_vec()),
            metadata,
        }
    }

    /// Mints 100 whole units to the caller, who must be registered with `storage_deposit` first.
    /// Returns the amount minted, in the smallest unit.
    pub fn faucet(&mut self) -> U128 {
        let account_id = env::predecessor_account_id();
        require!(
            self.token.accounts.contains_key(&account_id),
            "register with storage_deposit before using the faucet"
        );
        let amount = 10u128
            .checked_pow(u32::from(self.metadata.decimals))
            .and_then(|unit| unit.checked_mul(FAUCET_WHOLE_UNITS))
            .unwrap_or_else(|| env::panic_str("the faucet amount overflows"));
        self.token.internal_deposit(&account_id, amount);
        FtMint {
            owner_id: &account_id,
            amount: U128(amount),
            memo: Some("faucet"),
        }
        .emit();
        U128(amount)
    }
}

#[near]
impl FungibleTokenCore for TestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
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
impl FungibleTokenResolver for TestToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for TestToken {
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
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}
