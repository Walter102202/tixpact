//! Settlement: refunds to holders and payouts to organizers (R3, R7, R8, R9).
//!
//! Every claim reserves first and confirms later. Inside one call: the checks, then the ledger is
//! debited, an operation is recorded and the ticket is locked, then the liquidity check, then the
//! `*_requested` event, then the transfer with a private callback. The callback settles the
//! operation if the transfer arrived and restores the right if it failed; either way it removes
//! the operation. Nothing is retried on a timer.

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, Gas, NearToken, Promise, PromiseError, env, near};

use crate::accounting::{add, sub};
use crate::errors::{Code, ensure, ensure_one_yocto, fail};
use crate::events::Outcome;
use crate::log;
use crate::tickets::{HistoryKind, TicketStatus};
use crate::{Contract, ContractExt};

/// Static gas of `on_refund_result` and `on_payout_result`. Measured worst case 2.43 Tgas
/// (`docs/gas.md`); the contract cannot be upgraded, so this keeps five times that or more,
/// rounded up to 5 Tgas. The `fault-injection` test build lowers it so far that the callback runs
/// out of gas after its transfer (`t11`, `t18`).
pub const GAS_FOR_CALLBACK: Gas = if cfg!(feature = "fault-injection") {
    Gas::from_ggas(100)
} else {
    Gas::from_tgas(15)
};

/// Least prepaid gas `claim_refund` and `claim_payout` accept: the callback's static gas plus five
/// times the most the claim itself burns (3.17 Tgas measured, `docs/gas.md`), rounded up to
/// 10 Tgas. Below it the call fails as a whole (Review Focus 3).
pub const GAS_CLAIM_MIN: Gas = Gas::from_tgas(40);

/// What an operation in flight pays.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationKind {
    Refund,
    Payout,
}

/// A transfer sent and not yet confirmed. It exists only while pending.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Operation {
    pub kind: OperationKind,
    pub event_id: u32,
    /// The ticket refunded; `None` for a payout.
    pub token_id: Option<TokenId>,
    pub recipient_id: AccountId,
    pub amount: u128,
    pub started_at_ms: u64,
}

/// An operation in flight, as `get_operation` returns it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationView {
    pub operation_id: u64,
    pub kind: OperationKind,
    pub event_id: u32,
    pub token_id: Option<TokenId>,
    pub recipient_id: AccountId,
    pub amount: U128,
    pub started_at_ms: u64,
}

fn ensure_claim_gas() {
    ensure(
        env::prepaid_gas() >= GAS_CLAIM_MIN,
        Code::InsufficientGas,
        "attach at least 40 Tgas so the payment can be confirmed",
    );
}

impl Contract {
    /// Records an operation in flight and returns its id (ids start at 1).
    fn open_operation(&mut self, operation: Operation) -> u64 {
        self.last_operation_id = self
            .last_operation_id
            .checked_add(1)
            .unwrap_or_else(|| fail(Code::Limit, "no more operation ids"));
        self.operations.insert(self.last_operation_id, operation);
        self.last_operation_id
    }

    /// The liquidity check: after sending `amount`, the balance must still cover the storage in
    /// use and everything held for others (`total_held`, already net of this reservation).
    /// It runs after the reservation is written, so the storage the reservation adds is counted.
    fn ensure_liquidity(&mut self, amount: u128) {
        // `store` collections write on flush or drop; storage usage is read after both.
        self.events.flush();
        self.tickets.flush();
        self.operations.flush();
        let storage_cost = u128::from(env::storage_usage())
            .saturating_mul(env::storage_byte_cost().as_yoctonear());
        let required = add(storage_cost, self.total_held);
        let balance = env::account_balance().as_yoctonear();
        ensure(
            balance
                .checked_sub(amount)
                .is_some_and(|rest| rest >= required),
            Code::InsufficientLiquidity,
            "paying now would touch money held for others; retry once pending transfers return",
        );
    }

    /// A transfer of `amount` to `recipient_id`, then `callback` on this contract.
    fn transfer_then(recipient_id: AccountId, amount: u128, callback: Promise) -> Promise {
        Promise::new(recipient_id)
            .transfer(NearToken::from_yoctonear(amount))
            .then(callback)
    }
}

#[near]
impl Contract {
    /// The holder claims the refund of a ticket of a refundable event: exactly its principal, to
    /// the account that holds it now. If the deadline passed without an outcome, the event is
    /// expired first. 1 yoctoNEAR and at least 40 Tgas. Resolves to `true` once the transfer is
    /// confirmed, `false` if it failed and the right was restored.
    #[payable]
    pub fn claim_refund(&mut self, token_id: TokenId) -> Promise {
        ensure_one_yocto();
        ensure_claim_gas();
        let caller = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let mut ticket = self.load_ticket(&token_id);
        let holder = self
            .holder_of(&token_id)
            .unwrap_or_else(|| fail(Code::NotFound, "no ticket with this id"));
        ensure(
            caller == holder,
            Code::Unauthorized,
            "only the current holder can claim this ticket's refund",
        );
        match ticket.status {
            TicketStatus::Active => {}
            TicketStatus::TransferPending | TicketStatus::RefundPending => {
                fail(Code::TicketLocked, "the ticket has an operation in flight")
            }
            TicketStatus::Refunded => fail(Code::AlreadyRefunded, "this ticket was refunded"),
        }
        let event_id = ticket.event_id;
        let mut event = self.load_event(event_id);
        Self::expire_if_due(event_id, &mut event, &caller, now_ms);
        ensure(
            event.outcome == Outcome::Refundable,
            Code::NotRefundable,
            "refunds open only when the event is cancelled or its deadline passes unconfirmed",
        );

        let amount = ticket.principal;
        event.ledger.reserve_refund(amount);
        self.total_held = sub(self.total_held, amount);
        let operation = Operation {
            kind: OperationKind::Refund,
            event_id,
            token_id: Some(token_id.clone()),
            recipient_id: holder.clone(),
            amount,
            started_at_ms: now_ms,
        };
        let operation_id = self.open_operation(operation.clone());
        ticket.status = TicketStatus::RefundPending;
        ticket.pending_operation_id = Some(operation_id);
        ticket.record(HistoryKind::RefundRequested, &holder, now_ms);
        self.save_ticket(&token_id, ticket);
        self.save_event(event_id, event);
        self.ensure_liquidity(amount);
        log::settlement("refund_requested", operation_id, &operation);

        let callback = Self::ext(env::current_account_id())
            .with_static_gas(GAS_FOR_CALLBACK)
            .with_unused_gas_weight(0)
            .on_refund_result(operation_id);
        Self::transfer_then(holder, amount, callback)
    }

    /// The organizer claims everything the attestation made available, in one transfer.
    /// 1 yoctoNEAR and at least 40 Tgas. Resolves to `true` once the transfer is confirmed,
    /// `false` if it failed and the amount is available again.
    #[payable]
    pub fn claim_payout(&mut self, event_id: u32) -> Promise {
        ensure_one_yocto();
        ensure_claim_gas();
        let caller = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let mut event = self.load_event(event_id);
        ensure(
            caller == event.organizer_id,
            Code::Unauthorized,
            "only the organizer can claim the payout",
        );
        ensure(
            event.outcome == Outcome::Completed,
            Code::NotCompleted,
            "the organizer is paid only after the verifier confirms the event",
        );
        ensure(
            event.payout_operation_id.is_none(),
            Code::PayoutPending,
            "a payout of this event is already in flight",
        );
        ensure(
            event.ledger.organizer_available > 0,
            Code::NothingToPay,
            "nothing is available to pay",
        );

        let amount = event.ledger.reserve_payout();
        self.total_held = sub(self.total_held, amount);
        let operation = Operation {
            kind: OperationKind::Payout,
            event_id,
            token_id: None,
            recipient_id: caller.clone(),
            amount,
            started_at_ms: now_ms,
        };
        let operation_id = self.open_operation(operation.clone());
        event.payout_operation_id = Some(operation_id);
        self.save_event(event_id, event);
        self.ensure_liquidity(amount);
        log::settlement("payout_requested", operation_id, &operation);

        let callback = Self::ext(env::current_account_id())
            .with_static_gas(GAS_FOR_CALLBACK)
            .with_unused_gas_weight(0)
            .on_payout_result(operation_id);
        Self::transfer_then(caller, amount, callback)
    }

    /// Callback of `claim_refund`. Settles the refund if the transfer arrived; restores the
    /// holder's right if it failed. Removes the operation and returns whether money moved.
    #[private]
    pub fn on_refund_result(
        &mut self,
        operation_id: u64,
        #[callback_result] transfer: Result<(), PromiseError>,
    ) -> bool {
        let Some(operation) = self.operations.remove(&operation_id) else {
            return false;
        };
        let (OperationKind::Refund, Some(token_id)) = (operation.kind, operation.token_id.clone())
        else {
            // Not a refund: leave it to its own callback.
            self.operations.insert(operation_id, operation);
            return false;
        };
        let now_ms = env::block_timestamp_ms();
        let mut event = self.load_event(operation.event_id);
        let mut ticket = self.load_ticket(&token_id);
        let delivered = transfer.is_ok();
        if delivered {
            event.ledger.settle_refund(operation.amount);
            ticket.status = TicketStatus::Refunded;
            ticket.record(HistoryKind::RefundSettled, &operation.recipient_id, now_ms);
            log::settlement("refund_settled", operation_id, &operation);
        } else {
            event.ledger.restore_refund(operation.amount);
            self.total_held = add(self.total_held, operation.amount);
            ticket.status = TicketStatus::Active;
            ticket.record(HistoryKind::RefundFailed, &operation.recipient_id, now_ms);
            log::settlement("refund_failed", operation_id, &operation);
        }
        ticket.pending_operation_id = None;
        self.save_ticket(&token_id, ticket);
        self.save_event(operation.event_id, event);
        delivered
    }

    /// Callback of `claim_payout`. Settles the payout if the transfer arrived; makes the amount
    /// available again if it failed. Removes the operation and returns whether money moved.
    #[private]
    pub fn on_payout_result(
        &mut self,
        operation_id: u64,
        #[callback_result] transfer: Result<(), PromiseError>,
    ) -> bool {
        let Some(operation) = self.operations.remove(&operation_id) else {
            return false;
        };
        if operation.kind != OperationKind::Payout {
            self.operations.insert(operation_id, operation);
            return false;
        }
        let mut event = self.load_event(operation.event_id);
        let delivered = transfer.is_ok();
        if delivered {
            event.ledger.settle_payout(operation.amount);
            log::settlement("payout_settled", operation_id, &operation);
        } else {
            event.ledger.restore_payout(operation.amount);
            self.total_held = add(self.total_held, operation.amount);
            log::settlement("payout_failed", operation_id, &operation);
        }
        event.payout_operation_id = None;
        self.save_event(operation.event_id, event);
        delivered
    }

    /// An operation in flight, or `null` once it is settled or restored.
    pub fn get_operation(&self, operation_id: u64) -> Option<OperationView> {
        let operation = self.operations.get(&operation_id)?;
        Some(OperationView {
            operation_id,
            kind: operation.kind,
            event_id: operation.event_id,
            token_id: operation.token_id.clone(),
            recipient_id: operation.recipient_id.clone(),
            amount: U128(operation.amount),
            started_at_ms: operation.started_at_ms,
        })
    }
}
