//! Stable error codes (plan, "Frozen interface", "Error codes").
//!
//! Every panic this contract raises on purpose starts with one of these codes, followed by `: ` and
//! one sentence. Clients match on the code, never on the sentence.

use near_sdk::{NearToken, env};

/// The error codes of the frozen interface, in plan order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Code {
    NotFound,
    Unauthorized,
    OneYocto,
    WrongDeposit,
    InvalidTerms,
    Limit,
    TermsMismatch,
    NotAccepted,
    SoldOut,
    TooEarly,
    TooLate,
    AlreadyResolved,
    NotRefundable,
    NotCompleted,
    TicketLocked,
    AlreadyRefunded,
    NothingToPay,
    PayoutPending,
    InsufficientLiquidity,
    InsufficientGas,
    ApprovalsDisabled,
}

impl Code {
    /// The code as it appears at the start of a panic message.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NotFound => "ERR_NOT_FOUND",
            Self::Unauthorized => "ERR_UNAUTHORIZED",
            Self::OneYocto => "ERR_ONE_YOCTO",
            Self::WrongDeposit => "ERR_WRONG_DEPOSIT",
            Self::InvalidTerms => "ERR_INVALID_TERMS",
            Self::Limit => "ERR_LIMIT",
            Self::TermsMismatch => "ERR_TERMS_MISMATCH",
            Self::NotAccepted => "ERR_NOT_ACCEPTED",
            Self::SoldOut => "ERR_SOLD_OUT",
            Self::TooEarly => "ERR_TOO_EARLY",
            Self::TooLate => "ERR_TOO_LATE",
            Self::AlreadyResolved => "ERR_ALREADY_RESOLVED",
            Self::NotRefundable => "ERR_NOT_REFUNDABLE",
            Self::NotCompleted => "ERR_NOT_COMPLETED",
            Self::TicketLocked => "ERR_TICKET_LOCKED",
            Self::AlreadyRefunded => "ERR_ALREADY_REFUNDED",
            Self::NothingToPay => "ERR_NOTHING_TO_PAY",
            Self::PayoutPending => "ERR_PAYOUT_PENDING",
            Self::InsufficientLiquidity => "ERR_INSUFFICIENT_LIQUIDITY",
            Self::InsufficientGas => "ERR_INSUFFICIENT_GAS",
            Self::ApprovalsDisabled => "ERR_APPROVALS_DISABLED",
        }
    }
}

/// Aborts the call with `<CODE>: <sentence>`. Every state change of the call is reverted.
pub fn fail(code: Code, sentence: &str) -> ! {
    env::panic_str(&format!("{}: {sentence}", code.as_str()))
}

/// Aborts the call with `code` unless `condition` holds.
pub fn ensure(condition: bool, code: Code, sentence: &str) {
    if !condition {
        fail(code, sentence);
    }
}

/// Requires exactly one yoctoNEAR attached: proof that a full-access key or a wallet signed.
pub fn ensure_one_yocto() {
    ensure(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        Code::OneYocto,
        "attach exactly 1 yoctoNEAR",
    );
}

/// Requires that an optional text is at most `max_bytes` long.
pub fn ensure_text_fits(text: Option<&str>, max_bytes: u32, what: &str) {
    if let Some(text) = text {
        ensure(
            text.len() <= max_bytes as usize,
            Code::Limit,
            &format!("{what} is longer than {max_bytes} bytes"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_code_has_the_err_prefix_and_a_unique_name() {
        let all = [
            Code::NotFound,
            Code::Unauthorized,
            Code::OneYocto,
            Code::WrongDeposit,
            Code::InvalidTerms,
            Code::Limit,
            Code::TermsMismatch,
            Code::NotAccepted,
            Code::SoldOut,
            Code::TooEarly,
            Code::TooLate,
            Code::AlreadyResolved,
            Code::NotRefundable,
            Code::NotCompleted,
            Code::TicketLocked,
            Code::AlreadyRefunded,
            Code::NothingToPay,
            Code::PayoutPending,
            Code::InsufficientLiquidity,
            Code::InsufficientGas,
            Code::ApprovalsDisabled,
        ];
        let mut names: Vec<&str> = all.iter().map(|code| code.as_str()).collect();
        assert!(names.iter().all(|name| name.starts_with("ERR_")));
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 21);
    }
}
