//! Test fixture: an account that holds tickets (or organizes an event) through its code, and can
//! make the escrow's transfer to it fail by deleting itself in the same receipt as its claim.
//!
//! Used by `contract/tests/settlement.rs` (`t08`, `t10`, `t18`, `t24`). Never deployed outside the
//! sandbox.

use near_sdk::serde_json::json;
use near_sdk::{AccountId, Gas, NearToken, Promise, env, near};

/// Gas given to each call into the escrow.
const GAS_FOR_ESCROW: Gas = Gas::from_tgas(100);

#[near(contract_state)]
#[derive(Default)]
pub struct VanishingHolder {}

#[near]
impl VanishingHolder {
    /// Calls `method_name` on `receiver_id` with `args` (JSON text), forwarding the attached
    /// deposit, so this account can create events, buy tickets or claim like a person would.
    #[payable]
    pub fn forward(
        &mut self,
        receiver_id: AccountId,
        method_name: String,
        args: String,
    ) -> Promise {
        Promise::new(receiver_id).function_call(
            method_name,
            args.into_bytes(),
            env::attached_deposit(),
            GAS_FOR_ESCROW,
        )
    }

    /// Claims the refund of `token_id` and deletes this account in the same receipt, sending what
    /// is left to `beneficiary`. The escrow's refund transfer then reaches an account that no
    /// longer exists and fails.
    pub fn claim_and_vanish(
        &mut self,
        ticket_contract: AccountId,
        token_id: String,
        beneficiary: AccountId,
    ) {
        let args = json!({ "token_id": token_id }).to_string();
        Self::call_escrow(ticket_contract, "claim_refund", args).detach();
        Self::vanish(beneficiary);
    }

    /// Claims the payout of `event_id` as its organizer and deletes this account in the same
    /// receipt, sending what is left to `beneficiary`.
    pub fn collect_and_vanish(
        &mut self,
        ticket_contract: AccountId,
        event_id: u32,
        beneficiary: AccountId,
    ) {
        let args = json!({ "event_id": event_id }).to_string();
        Self::call_escrow(ticket_contract, "claim_payout", args).detach();
        Self::vanish(beneficiary);
    }

    /// Sends two `claim_refund` calls for the same ticket from one receipt. Both reach the escrow
    /// in the next block, the second while the first one's transfer is still in flight.
    pub fn claim_twice(&mut self, ticket_contract: AccountId, token_id: String) {
        let args = json!({ "token_id": token_id }).to_string();
        Self::call_escrow(ticket_contract.clone(), "claim_refund", args.clone()).detach();
        Self::call_escrow(ticket_contract, "claim_refund", args).detach();
    }
}

impl VanishingHolder {
    fn call_escrow(ticket_contract: AccountId, method: &str, args: String) -> Promise {
        Promise::new(ticket_contract).function_call(
            method.to_string(),
            args.into_bytes(),
            NearToken::from_yoctonear(1),
            GAS_FOR_ESCROW,
        )
    }

    fn vanish(beneficiary: AccountId) {
        Promise::new(env::current_account_id())
            .delete_account(beneficiary)
            .detach();
    }
}
