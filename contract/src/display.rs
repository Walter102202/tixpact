//! What a ticket shows in a wallet: NEP-177 metadata derived at call time from its event and its
//! own record (plan v2, "The ticket shows its state"). Nothing here is stored, and only views call
//! it, so it costs no change method any gas.

use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_sdk::base64::Engine;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::Serialize;
use near_sdk::{AccountId, env, serde_json};

use crate::currency::Unit;
use crate::events::{EventRecord, Outcome};
use crate::tickets::{Ticket, TicketStatus};
use crate::views::{Claim, claim};

/// Most bytes the drawn ticket may have before it is encoded.
pub const MAX_SVG_BYTES: usize = 2_048;
/// Characters of the title the drawn ticket shows before it cuts it with an ellipsis.
const SVG_TITLE_CHARS: usize = 26;

/// `amount` smallest units written as `0.5 NEAR` or `10 tUSD`: the whole part, then a point and
/// the fraction only when there is one, without trailing zeros, then the symbol.
pub fn format_amount(amount: u128, unit: Unit<'_>) -> String {
    let decimals = usize::from(unit.decimals);
    // At least one digit before the point.
    let digits = format!("{amount:0>width$}", width = decimals + 1);
    let (whole, fraction) = digits.split_at(digits.len() - decimals);
    let fraction = fraction.trim_end_matches('0');
    if fraction.is_empty() {
        format!("{whole} {}", unit.symbol)
    } else {
        format!("{whole}.{fraction} {}", unit.symbol)
    }
}

/// The word for a claim, as the web writes it (`packages/client/src/format.ts`).
fn claim_word(claim: Claim) -> &'static str {
    match claim {
        Claim::Reserved => "Reserved",
        Claim::Refundable => "Claimable",
        Claim::RefundPending => "Sending",
        Claim::Refunded => "Refunded",
        Claim::ReleasedToOrganizer => "Released to the organizer",
    }
}

/// The token description: which ticket it is, then one sentence on where its money stands.
fn description(event: &EventRecord, ticket: &Ticket, claim: Claim, amount: &str) -> String {
    let state = match claim {
        Claim::Reserved => {
            format!("{amount} is reserved in the contract until the event is resolved.")
        }
        Claim::Refundable => {
            format!("The event was not confirmed: whoever holds this ticket can claim {amount}.")
        }
        Claim::RefundPending => format!("A refund of {amount} is on its way to the holder."),
        Claim::Refunded => format!("{amount} was refunded to the holder."),
        Claim::ReleasedToOrganizer => {
            "The event was confirmed and the price went to the organizer.".to_string()
        }
    };
    format!(
        "Ticket {} of {} for {} at {}. {state}",
        ticket.serial, event.capacity, event.title, event.venue
    )
}

/// The facts behind the metadata, for programs: the `extra` field, as a JSON string.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Extra<'a> {
    event_id: u32,
    serial: u32,
    status: TicketStatus,
    claim: Claim,
    outcome: Outcome,
    principal: U128,
    currency: Option<&'a AccountId>,
}

/// `text` made safe inside an SVG text node: markup characters escaped, control characters (which
/// XML forbids) turned into spaces.
fn escape_xml(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            other if other.is_control() => escaped.push(' '),
            other => escaped.push(other),
        }
    }
    escaped
}

/// The title as the drawn ticket shows it: at most `SVG_TITLE_CHARS` characters.
fn short_title(title: &str) -> String {
    if title.chars().count() <= SVG_TITLE_CHARS {
        return title.to_string();
    }
    let mut short: String = title.chars().take(SVG_TITLE_CHARS - 1).collect();
    short.push('…');
    short
}

/// A ticket drawn from the same facts as the description: the title, the serial, the amount and
/// the claim word. At most `MAX_SVG_BYTES` bytes for any event the contract accepts.
fn ticket_svg(title: &str, serial: u32, amount: &str, claim: Claim) -> String {
    let accent = match claim {
        Claim::Reserved => "#3b5bdb",
        Claim::Refundable | Claim::RefundPending => "#b35c00",
        Claim::Refunded => "#2b8a3e",
        Claim::ReleasedToOrganizer => "#5c5f66",
    };
    format!(
        concat!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180" viewBox="0 0 360 180">"##,
            r##"<rect x="2" y="2" width="356" height="176" rx="14" fill="#fbfaff" stroke="{accent}" stroke-width="3"/>"##,
            r##"<line x1="284" y1="16" x2="284" y2="164" stroke="{accent}" stroke-width="2" stroke-dasharray="6 6"/>"##,
            r##"<g font-family="system-ui,sans-serif" fill="#1b1b29">"##,
            r##"<text x="22" y="46" font-size="17" font-weight="700">{title}</text>"##,
            r##"<text x="22" y="74" font-size="13">Ticket {serial}</text>"##,
            r##"<text x="22" y="142" font-size="24" font-weight="700">{amount}</text>"##,
            r##"</g>"##,
            r##"<text x="322" y="90" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="{accent}" text-anchor="middle" transform="rotate(-90 322 90)">{word}</text>"##,
            r##"</svg>"##,
        ),
        accent = accent,
        title = escape_xml(&short_title(title)),
        serial = serial,
        amount = escape_xml(amount),
        word = claim_word(claim),
    )
}

/// The ticket's NEP-177 metadata at this moment: title, a description that ends with where its
/// money stands, the facts as JSON in `extra`, and the drawn ticket in `media` with its hash.
pub fn token_metadata(event: &EventRecord, ticket: &Ticket, unit: Unit<'_>) -> TokenMetadata {
    let claim = claim(event.outcome, ticket.status);
    let amount = format_amount(ticket.principal, unit);
    let extra = Extra {
        event_id: ticket.event_id,
        serial: ticket.serial,
        status: ticket.status,
        claim,
        outcome: event.outcome,
        principal: U128(ticket.principal),
        currency: event.currency.as_ref(),
    };
    let svg = ticket_svg(&event.title, ticket.serial, &amount, claim);
    debug_assert!(svg.len() <= MAX_SVG_BYTES, "the drawn ticket outgrew 2 KB");
    TokenMetadata {
        title: Some(format!("{} - ticket {}", event.title, ticket.serial)),
        description: Some(description(event, ticket, claim, &amount)),
        media: Some(format!(
            "data:image/svg+xml;base64,{}",
            STANDARD.encode(svg.as_bytes())
        )),
        media_hash: Some(Base64VecU8(env::sha256(svg.as_bytes()))),
        // Serializing plain values cannot fail.
        extra: Some(serde_json::to_string(&extra).unwrap_or_else(|_| env::abort())),
        ..TokenMetadata::default()
    }
}
