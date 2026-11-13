//! Settlement: refunds to holders and payouts to organizers (R3, R7, R8, R9).
//!
//! Every claim reserves first and confirms later. Inside one call: the checks, then the ledger is
//! debited, an operation is recorded and the ticket is locked, then the liquidity check, then the
//! `*_requested` event, then the transfer with a private callback. The callback settles the
//! operation if the transfer arrived and restores the right if it failed; either way it removes
//! the operation. Nothing is retried on a timer.
//!
//! The transfer is the only step that depends on the currency (interface v2): a native transfer
//! for NEAR, `ft_transfer` on the token for an event priced in a token. Everything else, the
//! callbacks included, is the same code for both.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, Gas, NearToken, Promise, PromiseError, env, near};

use crate::accounting::{add, sub};
use crate::errors::{Code, ensure, ensure_one_yocto, fail};
use crate::events::Outcome;
use crate::log;
use crate::tickets::{HistoryKind, TicketStatus};
use crate::{Contract, ContractExt};

/// Static gas of `on_refund_result` and `on_payout_result`. Measured worst case 2.52 Tgas, a
/// token refund (2.47 for NEAR, `docs/gas.md`); the contract cannot be upgraded, so this keeps five times that or more,
/// rounded up to the next multiple of 5 Tgas. The `fault-injection` test build lowers it so far
/// that the callback runs out of gas after its transfer (`t11`, `t18`).
pub const GAS_FOR_CALLBACK: Gas = if cfg!(feature = "fault-injection") {
    Gas::from_ggas(100)
} else {
    Gas::from_tgas(15)
};

/// Share of unused gas the settlement callbacks take: the default, the same as a token's
/// `ft_transfer`. So a callback always has `GAS_FOR_CALLBACK` plus half of what the claimant adds
/// to a token claim (all of it on a NEAR payment; what it does not burn is refunded). A token buys
/// a longer answer only with its own gas, about 14 KB per Tgas, and copying it costs the callback
/// about 0.054 Tgas per Tgas the token had at the published register fee: 15 + U/2 >= 2.52 +
/// 0.054 x (20 + U/2) for any unused gas U, so no answer can run the callback out of gas
/// (`docs/gas.md`). The `fault-injection` build keeps 0, so its callback still runs out of gas
/// after its transfer.
pub(crate) const CALLBACK_GAS_WEIGHT: u64 = if cfg!(feature = "fault-injection") {
    0
} else {
    1
};

/// Least prepaid gas `claim_refund` and `claim_payout` accept: the callback's static gas plus five
/// times the most the claim itself burns (3.28 Tgas measured, for a claim that expires its event
/// first, `docs/gas.md`), rounded up to the next multiple of 10 Tgas. Below it the call fails as a
/// whole (Review Focus 3).
pub const GAS_CLAIM_MIN: Gas = Gas::from_tgas(40);

/// The least gas the `ft_transfer` that pays a refund or a payout of an event priced in a token
/// gets. It also gets the default share of the claimant's unused gas (half, beside the callback's
/// half, `CALLBACK_GAS_WEIGHT`), on purpose: the contract
/// cannot be upgraded, so if a token's `ft_transfer` ever needs more, attaching more gas to the
/// claim is the only remedy. The test token's worst `ft_transfer` burns 1.73 Tgas; five times that,
/// rounded up to 5 Tgas, is 10 Tgas, and 20 Tgas leaves room for a real token doing more work
/// (`docs/gas.md`, `docs/decisions/2026-11-13-the-token-gets-at-least-its-static-gas.md`).
pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);

/// Least prepaid gas a claim on an event priced in a token accepts: `GAS_FT_TRANSFER` plus the
/// callback's static gas plus five times the most the claim itself burns (3.44 Tgas measured, for
/// a claim that expires its event first, `docs/gas.md`): 52.2 Tgas, rounded up to the next
/// multiple of 10 Tgas. Below it the call fails as a whole.
pub const GAS_TOKEN_CLAIM_MIN: Gas = Gas::from_tgas(60);

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
    /// In the smallest unit of `currency`.
    pub amount: U128,
    /// The event's currency: `null` for NEAR, otherwise the token account.
    pub currency: Option<AccountId>,
    pub started_at_ms: u64,
}

/// Whether a payment arrived: anything but a confirmed failure (R7). A native transfer answers
/// nothing and so does a standard `ft_transfer`; a token that answers a value still ran its
/// transfer, because only a failed receipt is reverted. The callbacks read the answer bounded at
/// 0 bytes, so a value arrives as `TooLong`, never as something to deserialize, and counts as
/// delivered: giving the right back after a payment that went through would let it be paid twice.
fn delivered(payment: &Result<(), PromiseError>) -> bool {
    !matches!(payment, Err(PromiseError::Failed))
}

/// The least gas a claim on an event priced in `currency` needs. Checked before anything is
/// written.
fn ensure_claim_gas(currency: Option<&AccountId>) {
    let (minimum, sentence) = match currency {
        None => (
            GAS_CLAIM_MIN,
            "attach at least 40 Tgas so the payment can be confirmed",
        ),
        Some(_) => (
            GAS_TOKEN_CLAIM_MIN,
            "attach at least 60 Tgas so the token payment can be sent and confirmed",
        ),
    };
    ensure(
        env::prepaid_gas() >= minimum,
        Code::InsufficientGas,
        sentence,
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

    /// A transfer of `amount` of `currency` to `recipient_id`, then `callback` on this
    /// contract. NEAR goes by native transfer. A token goes by `ft_transfer` on the token, with the
    /// 1 yoctoNEAR the claimant attached (the standard requires it), at least `GAS_FT_TRANSFER` and
    /// the default share of unused gas; a recipient the token does not know makes it fail, and the
    /// callback restores the right.
    fn transfer_then(
        currency: Option<AccountId>,
        recipient_id: AccountId,
        amount: u128,
        callback: Promise,
    ) -> Promise {
        let transfer = match currency {
            None => Promise::new(recipient_id).transfer(NearToken::from_yoctonear(amount)),
            Some(token) => ext_ft_core::ext(token)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(recipient_id, U128(amount), None),
        };
        transfer.then(callback)
    }
}

#[near]
impl Contract {
    /// The holder claims the refund of a ticket of a refundable event: exactly its principal, to
    /// the account that holds it now, in the event's currency. If the deadline passed without an
    /// outcome, the event is expired first. 1 yoctoNEAR and at least 40 Tgas, 60 Tgas for an event
    /// priced in a token (the 1 yoctoNEAR goes on to its `ft_transfer`). Resolves to `true` once
    /// the transfer is confirmed, `false` if it failed and the right was restored.
    #[payable]
    pub fn claim_refund(&mut self, token_id: TokenId) -> Promise {
        ensure_one_yocto();
        ensure_claim_gas(None);
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
        // A token payment reserves more gas: checked again once the currency is known.
        ensure_claim_gas(event.currency.as_ref());
        Self::expire_if_due(event_id, &mut event, &caller, now_ms);
        ensure(
            event.outcome == Outcome::Refundable,
            Code::NotRefundable,
            "refunds open only when the event is cancelled or its deadline passes unconfirmed",
        );

        let amount = ticket.principal;
        event.ledger.reserve_refund(amount);
        if event.currency.is_none() {
            self.total_held = sub(self.total_held, amount);
        }
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
        let currency = event.currency.clone();
        self.save_ticket(&token_id, ticket);
        self.save_event(event_id, event);
        // A token claim moves no NEAR held for others: the 1 yoctoNEAR it forwards came with it.
        if currency.is_none() {
            self.ensure_liquidity(amount);
        }
        log::settlement(
            "refund_requested",
            operation_id,
            &operation,
            currency.as_ref(),
        );

        let callback = Self::ext(env::current_account_id())
            .with_static_gas(GAS_FOR_CALLBACK)
            .with_unused_gas_weight(CALLBACK_GAS_WEIGHT)
            .on_refund_result(operation_id);
        Self::transfer_then(currency, holder, amount, callback)
    }

    /// The organizer claims everything the attestation made available, in one transfer in the
    /// event's currency. 1 yoctoNEAR and at least 40 Tgas, 60 Tgas for an event priced in a token.
    /// Resolves to `true` once the transfer is confirmed, `false` if it failed and the amount is
    /// available again.
    #[payable]
    pub fn claim_payout(&mut self, event_id: u32) -> Promise {
        ensure_one_yocto();
        ensure_claim_gas(None);
        let caller = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let mut event = self.load_event(event_id);
        // A token payment reserves more gas: checked again once the currency is known.
        ensure_claim_gas(event.currency.as_ref());
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
        if event.currency.is_none() {
            self.total_held = sub(self.total_held, amount);
        }
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
        let currency = event.currency.clone();
        self.save_event(event_id, event);
        if currency.is_none() {
            self.ensure_liquidity(amount);
        }
        log::settlement(
            "payout_requested",
            operation_id,
            &operation,
            currency.as_ref(),
        );

        let callback = Self::ext(env::current_account_id())
            .with_static_gas(GAS_FOR_CALLBACK)
            .with_unused_gas_weight(CALLBACK_GAS_WEIGHT)
            .on_payout_result(operation_id);
        Self::transfer_then(currency, caller, amount, callback)
    }

    /// Callback of `claim_refund`. Settles the refund unless the transfer is confirmed failed,
    /// in which case it restores the holder's right (`delivered`). Removes the operation and
    /// returns whether money moved.
    #[private]
    pub fn on_refund_result(
        &mut self,
        operation_id: u64,
        #[callback_result(max_bytes = 0)] transfer: Result<(), PromiseError>,
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
        let delivered = delivered(&transfer);
        if delivered {
            event.ledger.settle_refund(operation.amount);
            ticket.status = TicketStatus::Refunded;
            ticket.record(HistoryKind::RefundSettled, &operation.recipient_id, now_ms);
            log::settlement(
                "refund_settled",
                operation_id,
                &operation,
                event.currency.as_ref(),
            );
        } else {
            event.ledger.restore_refund(operation.amount);
            if event.currency.is_none() {
                self.total_held = add(self.total_held, operation.amount);
            }
            ticket.status = TicketStatus::Active;
            ticket.record(HistoryKind::RefundFailed, &operation.recipient_id, now_ms);
            log::settlement(
                "refund_failed",
                operation_id,
                &operation,
                event.currency.as_ref(),
            );
        }
        ticket.pending_operation_id = None;
        self.save_ticket(&token_id, ticket);
        self.save_event(operation.event_id, event);
        delivered
    }

    /// Callback of `claim_payout`. Settles the payout unless the transfer is confirmed failed,
    /// in which case it makes the amount available again (`delivered`). Removes the operation
    /// and returns whether money moved.
    #[private]
    pub fn on_payout_result(
        &mut self,
        operation_id: u64,
        #[callback_result(max_bytes = 0)] transfer: Result<(), PromiseError>,
    ) -> bool {
        let Some(operation) = self.operations.remove(&operation_id) else {
            return false;
        };
        if operation.kind != OperationKind::Payout {
            self.operations.insert(operation_id, operation);
            return false;
        }
        let mut event = self.load_event(operation.event_id);
        let delivered = delivered(&transfer);
        if delivered {
            event.ledger.settle_payout(operation.amount);
            log::settlement(
                "payout_settled",
                operation_id,
                &operation,
                event.currency.as_ref(),
            );
        } else {
            event.ledger.restore_payout(operation.amount);
            if event.currency.is_none() {
                self.total_held = add(self.total_held, operation.amount);
            }
            log::settlement(
                "payout_failed",
                operation_id,
                &operation,
                event.currency.as_ref(),
            );
        }
        event.payout_operation_id = None;
        self.save_event(operation.event_id, event);
        delivered
    }

    /// An operation in flight, or `null` once it is settled or restored.
    pub fn get_operation(&self, operation_id: u64) -> Option<OperationView> {
        let operation = self.operations.get(&operation_id)?;
        let currency = operation
            .event_id
            .checked_sub(1)
            .and_then(|index| self.events.get(index))?
            .currency
            .clone();
        Some(OperationView {
            operation_id,
            kind: operation.kind,
            event_id: operation.event_id,
            token_id: operation.token_id.clone(),
            recipient_id: operation.recipient_id.clone(),
            amount: U128(operation.amount),
            currency,
            started_at_ms: operation.started_at_ms,
        })
    }
}
