//! Currencies: NEAR, and the NEP-141 tokens fixed at `new` (plan, "Frozen interface (v2)",
//! "Currencies"). Nobody can add a token later.
//!
//! An event is priced in one currency for its whole life. Its ledger counts in the smallest unit of
//! that currency; its operating budget is always in NEAR.

use near_sdk::{AccountId, env, near};

use crate::Contract;
use crate::errors::{Code, ensure};

/// Most tokens one deployment accepts.
pub const MAX_TOKENS: usize = 4;
/// Longest token symbol, in bytes.
pub const MAX_SYMBOL_BYTES: usize = 12;
/// Most decimals a token may have (NEAR's own).
pub const MAX_DECIMALS: u8 = 24;

/// A NEP-141 token events may be priced in.
#[near(serializers = [borsh, json])]
#[serde(deny_unknown_fields)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenSpec {
    /// The token contract.
    pub account_id: AccountId,
    /// How amounts are written: `10 tUSD`. 1 to 12 printable ASCII bytes, never `NEAR`.
    pub symbol: String,
    /// Digits of the smallest unit: 6 means 1 tUSD is 1,000,000 units.
    pub decimals: u8,
}

/// Checks the token list given to `new`. Changes nothing.
pub fn validate_tokens(tokens: &[TokenSpec]) {
    ensure(
        tokens.len() <= MAX_TOKENS,
        Code::Limit,
        "a deployment accepts at most 4 tokens",
    );
    for (index, token) in tokens.iter().enumerate() {
        ensure(
            (1..=MAX_SYMBOL_BYTES).contains(&token.symbol.len())
                && token.symbol.bytes().all(|byte| byte.is_ascii_graphic()),
            Code::InvalidTerms,
            "a token symbol is 1 to 12 printable ASCII bytes",
        );
        ensure(
            !token.symbol.eq_ignore_ascii_case("NEAR"),
            Code::InvalidTerms,
            "a token cannot use the symbol NEAR",
        );
        ensure(
            token.decimals <= MAX_DECIMALS,
            Code::InvalidTerms,
            "a token has at most 24 decimals",
        );
        ensure(
            token.account_id != env::current_account_id(),
            Code::InvalidTerms,
            "this contract is not a token",
        );
        ensure(
            tokens[..index].iter().all(|earlier| {
                earlier.account_id != token.account_id
                    && !earlier.symbol.eq_ignore_ascii_case(&token.symbol)
            }),
            Code::InvalidTerms,
            "each token and each symbol appears once",
        );
    }
}

impl Contract {
    /// The listed token at `account_id`, if any.
    pub(crate) fn token_spec(&self, account_id: &AccountId) -> Option<&TokenSpec> {
        self.currencies
            .iter()
            .find(|token| &token.account_id == account_id)
    }
}
