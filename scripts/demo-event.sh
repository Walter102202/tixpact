#!/usr/bin/env bash
# One event on sale that nobody will confirm, with a deadline a few minutes away, so that a person
# can play the refund from the web app with their own wallet: buy a ticket, give it away, wait for
# the deadline, claim. Only the NEAR CLI is used.
#
#   CONTRACT_ID=<contract>.testnet ORGANIZER_ID=<a>.testnet VERIFIER_ID=<b>.testnet \
#     bash scripts/demo-event.sh
#
# Needs: near-cli-rs (`near`, 0.31 or later) and the keys of the organizer and the verifier in the
# CLI's legacy keychain (see scripts/direct-calls.sh). Testnet only.
#
# Optional: TITLE ("Winter concert"), VENUE ("Teatro Municipal"), PRICE_NEAR (0.5), CAPACITY (50),
# STARTS_IN_SECONDS (480), WINDOW_SECONDS (60). Tickets can be bought and given away until the
# event starts; it ends WINDOW_SECONDS later and its deadline is another WINDOW_SECONDS later:
# ten minutes after this script runs, by default.
#
# To price the event in a token the contract accepts, set CURRENCY to the token's account and
# PRICE to the amount in that token (10): CURRENCY=<token>.testnet PRICE=10.
set -euo pipefail

: "${CONTRACT_ID:?set CONTRACT_ID}" "${ORGANIZER_ID:?set ORGANIZER_ID}" "${VERIFIER_ID:?set VERIFIER_ID}"
TITLE="${TITLE:-Winter concert}"
VENUE="${VENUE:-Teatro Municipal}"
CURRENCY="${CURRENCY:-}"
if [ -n "$CURRENCY" ]; then PRICE="${PRICE:-10}"; else PRICE="${PRICE:-${PRICE_NEAR:-0.5}}"; fi
CAPACITY="${CAPACITY:-50}"
STARTS_IN_SECONDS="${STARTS_IN_SECONDS:-480}"
WINDOW_SECONDS="${WINDOW_SECONDS:-60}"

for account in "$CONTRACT_ID" "$ORGANIZER_ID" "$VERIFIER_ID" ${CURRENCY:+"$CURRENCY"}; do
  case "$account" in
    *.testnet) ;;
    *) echo "Refusing $account: this script only runs on testnet." >&2; exit 2 ;;
  esac
done
for text in "$TITLE" "$VENUE"; do
  case "$text" in
    *[\"\\]*) echo "TITLE and VENUE cannot contain quotes or backslashes." >&2; exit 2 ;;
  esac
done
case "$CAPACITY$STARTS_IN_SECONDS$WINDOW_SECONDS" in
  "" | *[!0-9]*) echo "CAPACITY, STARTS_IN_SECONDS and WINDOW_SECONDS must be whole numbers." >&2; exit 2 ;;
esac
command -v near >/dev/null || { echo "The NEAR CLI (near) is not installed." >&2; exit 2; }

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# The CLI prints the returned value on stdout and everything else on stderr.
view() { # method json-args
  near contract call-function as-read-only "$CONTRACT_ID" "$1" json-args "$2" \
    network-config testnet now 2>"$log" || { cat "$log" >&2; exit 1; }
}

call() { # signer method json-args gas deposit
  near contract call-function as-transaction "$CONTRACT_ID" "$2" json-args "$3" \
    prepaid-gas "$4" attached-deposit "$5" \
    sign-as "$1" network-config testnet sign-with-legacy-keychain send 2>"$log" || {
    grep -E "ERR_[A-Z_]+|Error|error" "$log" | cut -c1-240 >&2
    echo "FAILED: $2 signed by $1" >&2
    exit 1
  }
}

# The unit of the price: NEAR has 24 decimals; a token says its own in its metadata.
symbol="NEAR"
decimals=24
currency_json="null"
if [ -n "$CURRENCY" ]; then
  metadata="$(near contract call-function as-read-only "$CURRENCY" ft_metadata json-args '{}' \
    network-config testnet now 2>"$log")" || { cat "$log" >&2; exit 1; }
  symbol="$(printf '%s' "$metadata" | sed -n 's/.*"symbol": *"\([^"]*\)".*/\1/p' | head -n 1)"
  decimals="$(printf '%s' "$metadata" | sed -n 's/.*"decimals": *\([0-9]*\).*/\1/p' | head -n 1)"
  case "$decimals" in
    "" | *[!0-9]*) echo "$CURRENCY did not answer ft_metadata with its decimals." >&2; exit 1 ;;
  esac
  [ -n "$symbol" ] && [ "$decimals" -le 24 ] || { echo "$CURRENCY is not a token this script can price in." >&2; exit 1; }
  currency_json="\"$CURRENCY\""
fi

# 0.5 NEAR -> 500000000000000000000000 yoctoNEAR, 10 tUSD -> 10000000, with integer arithmetic only.
whole="${PRICE%%.*}"
fraction=""
case "$PRICE" in *.*) fraction="${PRICE#*.}" ;; esac
case "$whole$fraction" in
  "" | *[!0-9]*) echo "The price must be a number such as 0.5" >&2; exit 2 ;;
esac
[ "${#fraction}" -le "$decimals" ] || { echo "The price has more than $decimals decimals." >&2; exit 2; }
zeros="000000000000000000000000"
zeros="${zeros:0:$decimals}"
price="$(printf '%s%s%s' "$whole" "$fraction" "${zeros:${#fraction}}" | sed 's/^0*//')"
[ -n "$price" ] || { echo "The price must be greater than zero." >&2; exit 2; }

budget="$(view quote_event_budget "{\"capacity\":$CAPACITY}" | tr -d '" \n')"
starts_s=$(($(date +%s) + STARTS_IN_SECONDS))
ends_s=$((starts_s + WINDOW_SECONDS))
deadline_s=$((starts_s + 2 * WINDOW_SECONDS))
terms="{\"terms\":{\"title\":\"$TITLE\",\"venue\":\"$VENUE\",\"starts_at_ms\":${starts_s}000,\"ends_at_ms\":${ends_s}000,\"resolution_deadline_ms\":${deadline_s}000,\"price\":\"$price\",\"capacity\":$CAPACITY,\"verifier_id\":\"$VERIFIER_ID\",\"currency\":$currency_json}}"

event_id="$(call "$ORGANIZER_ID" create_event "$terms" '30 Tgas' "$budget yoctoNEAR" | tr -d '\n')"
case "$event_id" in
  "" | *[!0-9]*) echo "create_event answered '$event_id', not an event number" >&2; exit 1 ;;
esac
terms_hash="$(view get_event "{\"event_id\":$event_id}" | sed -n 's/.*"terms_hash": *"\([^"]*\)".*/\1/p' | head -n 1)"
call "$VERIFIER_ID" accept_verification "{\"event_id\":$event_id,\"terms_hash\":\"$terms_hash\"}" \
  '30 Tgas' '1 yoctoNEAR' >/dev/null
phase="$(view get_event "{\"event_id\":$event_id}" | sed -n 's/.*"phase": *"\([^"]*\)".*/\1/p' | head -n 1)"
[ "$phase" = "OnSale" ] || { echo "The event is $phase, expected OnSale." >&2; exit 1; }

clock() { date -d "@$1" +%H:%M:%S 2>/dev/null || date -r "$1" +%H:%M:%S; } # GNU date, then BSD date
echo "Event $event_id, \"$TITLE\", is on sale on $CONTRACT_ID for $PRICE $symbol. Open /events/$event_id in the web app."
if [ -n "$CURRENCY" ]; then
  echo "  The buyer pays in $symbol, the token $CURRENCY, and whoever claims must be registered with it."
fi
echo "  Buy and give the ticket away before  $(clock "$starts_s")  (the event starts)"
echo "  Nobody will confirm it. The deadline is $(clock "$deadline_s")  (local time of this machine)"
echo "  After the deadline, whoever holds the ticket claims the price on the ticket's page."
