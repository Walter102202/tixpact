//! Test fixture: a contract that receives a ticket through `nft_transfer_call` and answers as the
//! transfer's `msg` says. Used by `contract/tests/transfers.rs`. Never deployed outside the
//! sandbox.
//!
//! | `msg` | Answer of `nft_on_transfer` |
//! |---|---|
//! | `keep` | `false`: keep the ticket |
//! | `return` | `true`: send it back |
//! | `panic` | the call fails |
//! | `garbage` | `maybe`, which is not JSON |
//! | `oversized` | `false` padded to 11 bytes: a valid "keep" longer than any boolean |
//! | `reenter` | tries `claim_refund` and `nft_transfer` on the ticket and reads `get_ticket`, then logs what it saw and keeps the ticket |
//! | `hold` | answers `true` only after someone calls `release`, re-calling itself every block until then, so the transfer stays unresolved across blocks (`t13`) |

use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, Gas, NearToken, Promise, PromiseError, env, near};

/// Static gas of each step this fixture schedules.
const GAS_FOR_CLAIM: Gas = Gas::from_tgas(70);
const GAS_FOR_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_FOR_VIEW: Gas = Gas::from_tgas(10);
const GAS_FOR_STEP: Gas = Gas::from_tgas(5);

#[near(contract_state)]
#[derive(Default)]
pub struct TicketReceiver {
    /// Set by `release`: a held transfer may now be answered.
    released: bool,
}

#[near]
impl TicketReceiver {
    /// NEP-171 receiver. Writes its answer with `value_return` so that each mode can return
    /// exactly the bytes it needs, including ones that are not a boolean.
    pub fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
        msg: String,
    ) {
        let _ = sender_id;
        let ticket_contract = env::predecessor_account_id();
        match msg.as_str() {
            "keep" => env::value_return(b"false"),
            "return" => env::value_return(b"true"),
            "panic" => env::panic_str("the receiver refuses this ticket"),
            "garbage" => env::value_return(b"maybe"),
            "oversized" => env::value_return(b"false      "),
            "reenter" => {
                Self::reenter(ticket_contract, previous_owner_id, token_id)
                    .as_return()
                    .detach();
            }
            "hold" => self.hold(),
            _ => env::panic_str("unknown msg"),
        }
    }

    /// Answers `true` once `release` has been called; until then calls itself again, one block
    /// later each time.
    pub fn hold(&self) {
        if self.released {
            env::value_return(b"true");
        } else {
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_STEP)
                .hold()
                .as_return()
                .detach();
        }
    }

    /// Lets a held transfer be answered.
    pub fn release(&mut self) {
        self.released = true;
    }

    /// Logs what the re-entering calls got and keeps the ticket.
    #[private]
    pub fn after_reenter(
        &mut self,
        #[callback_result] claim: Result<(), PromiseError>,
        #[callback_result] transfer: Result<(), PromiseError>,
        #[callback_result] ticket: Result<Value, PromiseError>,
    ) -> bool {
        let outcome = |result: bool| if result { "ok" } else { "failed" };
        let status = ticket
            .ok()
            .and_then(|view| view["status"].as_str().map(str::to_string))
            .unwrap_or_default();
        env::log_str(&format!(
            "reenter: claim={} transfer={} status={status}",
            outcome(claim.is_ok()),
            outcome(transfer.is_ok()),
        ));
        false
    }
}

impl TicketReceiver {
    fn reenter(
        ticket_contract: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
    ) -> Promise {
        let one_yocto = NearToken::from_yoctonear(1);
        let claim = Promise::new(ticket_contract.clone()).function_call(
            "claim_refund",
            json!({ "token_id": token_id }).to_string().into_bytes(),
            one_yocto,
            GAS_FOR_CLAIM,
        );
        let transfer = Promise::new(ticket_contract.clone()).function_call(
            "nft_transfer",
            json!({
                "receiver_id": previous_owner_id,
                "token_id": token_id,
                "approval_id": null,
                "memo": null,
            })
            .to_string()
            .into_bytes(),
            one_yocto,
            GAS_FOR_TRANSFER,
        );
        let view = Promise::new(ticket_contract).function_call(
            "get_ticket",
            json!({ "token_id": token_id }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FOR_VIEW,
        );
        claim.and(transfer).and(view).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_STEP)
                .after_reenter(),
        )
    }
}
