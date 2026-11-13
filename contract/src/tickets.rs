//! Tickets: NEP-171 tokens with a fixed principal, the transfer guards and locks (R1, R4, R6, R8),
//! and each ticket's bounded history.
//!
//! The token storage (`NonFungibleToken`) is the only record of who holds a ticket. A `Ticket`
//! stores what the standard does not: its event, its principal, its lock and its history.

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::{NftMint, NftTransfer};
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, PromiseOrValue, env, near};

use crate::accounting::add;
use crate::errors::{Code, ensure, ensure_one_yocto, ensure_text_fits, fail};
use crate::events::{EventRecord, Outcome};
use crate::log;
use crate::{Contract, ContractExt, HISTORY_CAP, MAX_MEMO_BYTES, MAX_PAGE};

/// Where a ticket stands, as stored. `TransferPending` and `RefundPending` are locks (R8).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TicketStatus {
    Active,
    TransferPending,
    RefundPending,
    Refunded,
}

/// What happened to a ticket.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HistoryKind {
    Purchased,
    Transferred,
    TransferReturned,
    RefundRequested,
    RefundSettled,
    RefundFailed,
}

/// One line of a ticket's history: what happened, to whom, when.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryEntry {
    pub kind: HistoryKind,
    pub account_id: AccountId,
    pub at_ms: u64,
}

/// One ticket as stored. Its holder is in the token storage, not here.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Ticket {
    pub event_id: u32,
    pub serial: u32,
    /// The price paid: the holder's right to a refund of exactly this amount (R1).
    pub principal: u128,
    pub status: TicketStatus,
    pub pending_operation_id: Option<u64>,
    /// The first entry and the latest ones, at most `HISTORY_CAP` in all.
    pub history: Vec<HistoryEntry>,
    /// Entries dropped from the middle of the history.
    pub history_dropped: u32,
}

impl Ticket {
    /// Appends an entry, keeping the first one and the latest `HISTORY_CAP - 1`.
    pub fn record(&mut self, kind: HistoryKind, account_id: &AccountId, at_ms: u64) {
        if self.history.len() >= HISTORY_CAP as usize {
            self.history.remove(1);
            self.history_dropped = self.history_dropped.saturating_add(1);
        }
        self.history.push(HistoryEntry {
            kind,
            account_id: account_id.clone(),
            at_ms,
        });
    }
}

/// `"<event_id>-<serial>"`.
pub fn token_id_for(event_id: u32, serial: u32) -> TokenId {
    format!("{event_id}-{serial}")
}

/// The token metadata shown by wallets, derived from the event so that nothing is stored twice.
pub fn token_metadata(event: &EventRecord, ticket: &Ticket) -> TokenMetadata {
    TokenMetadata {
        title: Some(format!("{} - ticket {}", event.title, ticket.serial)),
        description: Some(format!(
            "Ticket {} of {} for {} at {}. Its price stays reserved in the contract until the event \
             is resolved; if it is cancelled or expires, whoever holds this ticket can claim it.",
            ticket.serial, event.capacity, event.title, event.venue
        )),
        ..TokenMetadata::default()
    }
}

impl Contract {
    /// The stored ticket, or `ERR_NOT_FOUND`. Returns a copy; write it back with `save_ticket`.
    pub(crate) fn load_ticket(&self, token_id: &TokenId) -> Ticket {
        self.tickets
            .get(token_id)
            .cloned()
            .unwrap_or_else(|| fail(Code::NotFound, "no ticket with this id"))
    }

    pub(crate) fn save_ticket(&mut self, token_id: &TokenId, ticket: Ticket) {
        self.tickets.insert(token_id.clone(), ticket);
    }

    /// The current holder of a ticket, from the token storage.
    pub(crate) fn holder_of(&self, token_id: &TokenId) -> Option<AccountId> {
        self.tokens.owner_by_id.get(token_id)
    }

    /// The checks every transfer shares (R6, R8). Returns the holder, the ticket and its event.
    fn check_transfer(
        &self,
        sender_id: &AccountId,
        receiver_id: &AccountId,
        token_id: &TokenId,
        approval_id: Option<u64>,
        memo: Option<&str>,
    ) -> (AccountId, Ticket) {
        ensure_one_yocto();
        ensure(
            approval_id.is_none(),
            Code::ApprovalsDisabled,
            "approvals are disabled: approval_id must be null",
        );
        ensure_text_fits(memo, MAX_MEMO_BYTES, "the memo");
        let ticket = self.load_ticket(token_id);
        let holder = self
            .holder_of(token_id)
            .unwrap_or_else(|| fail(Code::NotFound, "no ticket with this id"));
        ensure(
            sender_id == &holder,
            Code::Unauthorized,
            "only the holder can transfer this ticket",
        );
        ensure(
            receiver_id != &holder && receiver_id != &env::current_account_id(),
            Code::Unauthorized,
            "a ticket cannot be sent to its own holder or to this contract",
        );
        ensure(
            !matches!(
                ticket.status,
                TicketStatus::TransferPending | TicketStatus::RefundPending
            ),
            Code::TicketLocked,
            "the ticket has an operation in flight",
        );
        let event = self.load_event(ticket.event_id);
        ensure(
            event.outcome == Outcome::Unresolved,
            Code::AlreadyResolved,
            "the event already has an outcome",
        );
        ensure(
            env::block_timestamp_ms() < event.starts_at_ms,
            Code::TooLate,
            "tickets cannot change hands once the event has started",
        );
        (holder, ticket)
    }

    /// Moves the token and records it, without checks. The caller has checked everything.
    pub(crate) fn move_ticket(
        &mut self,
        token_id: &TokenId,
        ticket: &mut Ticket,
        from: &AccountId,
        to: &AccountId,
        kind: HistoryKind,
        memo: Option<&str>,
    ) {
        self.tokens.internal_transfer_unguarded(token_id, from, to);
        NftTransfer {
            old_owner_id: from,
            new_owner_id: to,
            token_ids: &[token_id],
            authorized_id: None,
            memo,
        }
        .emit();
        ticket.record(kind, to, env::block_timestamp_ms());
    }

    /// A standard `Token` with metadata derived from the event.
    fn token_view(&self, token_id: TokenId, owner_id: AccountId) -> Option<Token> {
        let ticket = self.tickets.get(&token_id)?;
        let event = self.events.get(ticket.event_id.checked_sub(1)?)?;
        let metadata = token_metadata(event, ticket);
        Some(Token {
            token_id,
            owner_id,
            metadata: Some(metadata),
            approved_account_ids: None,
        })
    }

    /// The token ids of one holder, in the standard enumeration order, at most `max_page`.
    pub(crate) fn token_ids_for_owner(
        &self,
        account_id: &AccountId,
        from_index: u64,
        limit: u64,
    ) -> Vec<TokenId> {
        let Some(tokens_per_owner) = self.tokens.tokens_per_owner.as_ref() else {
            return Vec::new();
        };
        let Some(set) = tokens_per_owner.get(account_id) else {
            return Vec::new();
        };
        let ids = set.as_vector();
        let end = from_index
            .saturating_add(limit.min(u64::from(MAX_PAGE)))
            .min(ids.len());
        (from_index..end)
            .filter_map(|index| ids.get(index))
            .collect()
    }
}

#[near]
impl Contract {
    /// Buys the next ticket of an event for exactly its price. The buyer is its first holder; the
    /// whole deposit is the ticket's principal and nothing is refunded by the mint (`t17`).
    #[payable]
    pub fn buy_ticket(&mut self, event_id: u32) -> TokenId {
        let buyer = env::predecessor_account_id();
        let now_ms = env::block_timestamp_ms();
        let deposit = env::attached_deposit().as_yoctonear();
        let mut event = self.load_event(event_id);
        ensure(
            event.outcome == Outcome::Unresolved,
            Code::AlreadyResolved,
            "the event already has an outcome",
        );
        ensure(
            now_ms < event.starts_at_ms,
            Code::TooLate,
            "sales close when the event starts",
        );
        ensure(
            event.verifier_accepted,
            Code::NotAccepted,
            "the verifier has not accepted this event yet",
        );
        ensure(
            event.sold < event.capacity,
            Code::SoldOut,
            "every ticket of this event is sold",
        );
        ensure(
            deposit == event.price,
            Code::WrongDeposit,
            "attach exactly the ticket price",
        );

        event.sold += 1;
        let serial = event.sold;
        let token_id = token_id_for(event_id, serial);
        event.ledger.record_purchase(deposit);
        self.total_held = add(self.total_held, deposit);

        // `None` as refund account: the standard helper would otherwise send back everything
        // above the storage cost, which here is the ticket's principal.
        self.tokens
            .internal_mint_with_refund(token_id.clone(), buyer.clone(), None, None);
        NftMint {
            owner_id: &buyer,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();

        let mut ticket = Ticket {
            event_id,
            serial,
            principal: deposit,
            status: TicketStatus::Active,
            pending_operation_id: None,
            history: Vec::new(),
            history_dropped: 0,
        };
        ticket.record(HistoryKind::Purchased, &buyer, now_ms);
        self.save_ticket(&token_id, ticket);
        log::ticket_purchased(event_id, &token_id, &buyer, deposit);
        self.save_event(event_id, event);
        token_id
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    /// Transfers a ticket while its event is unresolved and has not started, and the ticket has
    /// no operation in flight (R6, R8). 1 yoctoNEAR. Approvals are disabled.
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        let sender_id = env::predecessor_account_id();
        let (holder, mut ticket) = self.check_transfer(
            &sender_id,
            &receiver_id,
            &token_id,
            approval_id,
            memo.as_deref(),
        );
        self.move_ticket(
            &token_id,
            &mut ticket,
            &holder,
            &receiver_id,
            HistoryKind::Transferred,
            memo.as_deref(),
        );
        self.save_ticket(&token_id, ticket);
    }

    /// Not available until Task C3.
    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let _ = (receiver_id, token_id, approval_id, memo, msg);
        fail(Code::Limit, "not available yet")
    }

    /// The standard view of one ticket, or `null`.
    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        let owner_id = self.holder_of(&token_id)?;
        self.token_view(token_id, owner_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    /// How many tickets exist, across all events.
    fn nft_total_supply(&self) -> U128 {
        U128(u128::from(self.tokens.owner_by_id.len()))
    }

    /// Tickets in token id order, at most `max_page`. Never panics past the end.
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let start = usize::try_from(from_index.map_or(0, |index| index.0)).unwrap_or(usize::MAX);
        let limit = limit
            .unwrap_or(u64::from(MAX_PAGE))
            .min(u64::from(MAX_PAGE)) as usize;
        self.tokens
            .owner_by_id
            .iter()
            .skip(start)
            .take(limit)
            .filter_map(|(token_id, owner_id)| self.token_view(token_id, owner_id))
            .collect()
    }

    /// How many tickets one account holds.
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        let count = self
            .tokens
            .tokens_per_owner
            .as_ref()
            .and_then(|by_owner| by_owner.get(&account_id))
            .map_or(0, |set| set.len());
        U128(u128::from(count))
    }

    /// One account's tickets in enumeration order, at most `max_page`. Never panics past the end.
    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        let start = u64::try_from(from_index.map_or(0, |index| index.0)).unwrap_or(u64::MAX);
        let limit = limit.unwrap_or(u64::from(MAX_PAGE));
        self.token_ids_for_owner(&account_id, start, limit)
            .into_iter()
            .filter_map(|token_id| self.token_view(token_id, account_id.clone()))
            .collect()
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    /// NEP-177 contract metadata.
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Ticket escrow".to_string(),
            symbol: "TICKET".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}
