#!/usr/bin/env bash
# The refund path with nothing but the NEAR CLI: no website, no Node, no code from this repository.
# The contract is the product; this script is what "the site is down" looks like.
#
#   CONTRACT_ID=<contract>.testnet ORGANIZER_ID=<a>.testnet VERIFIER_ID=<b>.testnet \
#   BUYER_ID=<c>.testnet ANYONE_ID=<d>.testnet bash scripts/direct-calls.sh
#
# It creates an event that nobody will confirm, buys one ticket, waits for the deadline, lets an
# unrelated account switch the event to refunds, and claims the price back for the buyer. It exits
# non-zero if any step answers something else.
#
# Needs: near-cli-rs (`near`, 0.31 or later) and, for each of the four accounts, its key in the CLI's
# legacy keychain (~/.near-credentials/testnet/<account>.json). That is where
#   near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair \
#     save-to-legacy-keychain network-config testnet create
# puts it. Testnet only: any account that does not end in .testnet is refused.
#
# Optional: PRICE_NEAR (0.5), STARTS_IN_SECONDS (90), WINDOW_SECONDS (45).
# The whole run takes STARTS_IN_SECONDS + 2 * WINDOW_SECONDS, three minutes by default.
set -euo pipefail

: "${CONTRACT_ID:?set CONTRACT_ID}" "${ORGANIZER_ID:?set ORGANIZER_ID}" "${VERIFIER_ID:?set VERIFIER_ID}"
: "${BUYER_ID:?set BUYER_ID}" "${ANYONE_ID:?set ANYONE_ID}"
PRICE_NEAR="${PRICE_NEAR:-0.5}"
STARTS_IN_SECONDS="${STARTS_IN_SECONDS:-90}"
WINDOW_SECONDS="${WINDOW_SECONDS:-45}"

for account in "$CONTRACT_ID" "$ORGANIZER_ID" "$VERIFIER_ID" "$BUYER_ID" "$ANYONE_ID"; do
  case "$account" in
    *.testnet) ;;
    *) echo "Refusing $account: this script only runs on testnet." >&2; exit 2 ;;
  esac
done
command -v near >/dev/null || { echo "The NEAR CLI (near) is not installed." >&2; exit 2; }

log="$(mktemp)"
last_tx="$(mktemp)" # a file, because `call` runs inside $( ) and a variable would not survive it
trap 'rm -f "$log" "$last_tx"' EXIT

# The CLI prints the returned value on stdout and everything else on stderr.
view() { # method json-args
  near contract call-function as-read-only "$CONTRACT_ID" "$1" json-args "$2" \
    network-config testnet now 2>"$log" || { cat "$log" >&2; exit 1; }
}

call() { # signer method json-args gas deposit
  local value
  value="$(near contract call-function as-transaction "$CONTRACT_ID" "$2" json-args "$3" \
    prepaid-gas "$4" attached-deposit "$5" \
    sign-as "$1" network-config testnet sign-with-legacy-keychain send 2>"$log")" || {
    grep -E "ERR_[A-Z_]+|Error|error" "$log" | cut -c1-240 >&2
    echo "FAILED: $2 signed by $1" >&2
    exit 1
  }
  sed -n 's/.*Transaction ID: *\([A-Za-z0-9]*\).*/\1/p' "$log" | head -n 1 >"$last_tx"
  printf '%s' "$value" | tr -d '\n'
}

text_field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -n 1; }
number_field() { sed -n "s/.*\"$1\": *\([0-9][0-9]*\).*/\1/p" | head -n 1; }

step=0
say() { step=$((step + 1)); printf '\n%d. %s\n' "$step" "$1"; }
tx() { echo "   https://testnet.nearblocks.io/txns/$(cat "$last_tx")"; }
expect() { # what expected observed
  if [ "$2" = "$3" ]; then
    echo "   ok: $1 = $3"
  else
    echo "   WRONG: $1 is $3, expected $2" >&2
    exit 1
  fi
}

# 0.5 NEAR -> 500000000000000000000000 yoctoNEAR, with integer arithmetic only.
whole="${PRICE_NEAR%%.*}"
fraction=""
case "$PRICE_NEAR" in *.*) fraction="${PRICE_NEAR#*.}" ;; esac
case "$whole$fraction" in
  "" | *[!0-9]*) echo "PRICE_NEAR must be a number such as 0.5" >&2; exit 2 ;;
esac
[ "${#fraction}" -le 24 ] || { echo "PRICE_NEAR has more than 24 decimals." >&2; exit 2; }
zeros="000000000000000000000000"
price="$(printf '%s%s%s' "$whole" "$fraction" "${zeros:${#fraction}}" | sed 's/^0*//')"
[ -n "$price" ] || { echo "PRICE_NEAR must be greater than zero." >&2; exit 2; }

say "The contract answers"
view get_config '{}' | grep -E '"version"|"fault_injection"' | sed 's/^ */   /'

say "$ORGANIZER_ID creates an event and prepays its storage"
budget="$(view quote_event_budget '{"capacity":1}' | tr -d '" \n')"
starts=$((($(date +%s) + STARTS_IN_SECONDS) * 1000))
ends=$((starts + WINDOW_SECONDS * 1000))
deadline=$((starts + 2 * WINDOW_SECONDS * 1000))
terms="{\"terms\":{\"title\":\"Direct calls\",\"venue\":\"Command line\",\"starts_at_ms\":$starts,\"ends_at_ms\":$ends,\"resolution_deadline_ms\":$deadline,\"price\":\"$price\",\"capacity\":1,\"verifier_id\":\"$VERIFIER_ID\",\"currency\":null}}"
event_id="$(call "$ORGANIZER_ID" create_event "$terms" '30 Tgas' "$budget yoctoNEAR")"
tx
case "$event_id" in
  "" | *[!0-9]*) echo "   WRONG: create_event answered '$event_id', not an event number" >&2; exit 1 ;;
esac
echo "   ok: event $event_id, storage prepaid: $budget yoctoNEAR"

say "$VERIFIER_ID accepts the exact terms"
terms_hash="$(view get_event "{\"event_id\":$event_id}" | text_field terms_hash)"
call "$VERIFIER_ID" accept_verification "{\"event_id\":$event_id,\"terms_hash\":\"$terms_hash\"}" \
  '30 Tgas' '1 yoctoNEAR' >/dev/null
tx
expect "phase" "OnSale" "$(view get_event "{\"event_id\":$event_id}" | text_field phase)"

say "$BUYER_ID buys a ticket for $PRICE_NEAR NEAR"
token_id="$(call "$BUYER_ID" buy_ticket "{\"event_id\":$event_id}" '50 Tgas' "$price yoctoNEAR" | tr -d '"')"
tx
expect "ticket" "$event_id-1" "$token_id"
expect "price reserved in the contract" "$price" \
  "$(view get_accounting "{\"event_id\":$event_id}" | text_field principal_reserved)"

say "Nobody confirms the event; waiting for the deadline on the chain's clock"
while :; do
  now="$(view get_event "{\"event_id\":$event_id}" | number_field now_ms)"
  [ "$now" -ge "$deadline" ] && break
  left=$(((deadline - now) / 1000 + 1))
  echo "   $left s left"
  sleep "$((left < 15 ? left : 15))"
done

say "$ANYONE_ID, who has no role in the event, switches it to refunds"
outcome="$(call "$ANYONE_ID" expire_event "{\"event_id\":$event_id}" '30 Tgas' '0 NEAR' | tr -d '"')"
tx
expect "outcome" "Refundable" "$outcome"

say "$BUYER_ID claims the price back"
paid="$(call "$BUYER_ID" claim_refund "{\"token_id\":\"$token_id\"}" '100 Tgas' '1 yoctoNEAR')"
tx
expect "claim_refund" "true" "$paid"
accounting="$(view get_accounting "{\"event_id\":$event_id}")"
expect "refunds paid out" "$price" "$(printf '%s' "$accounting" | text_field refunds_settled)"
expect "still reserved" "0" "$(printf '%s' "$accounting" | text_field principal_reserved)"
expect "ticket" "Refunded" "$(view get_ticket "{\"token_id\":\"$token_id\"}" | text_field status)"

printf '\nDone: the buyer got %s NEAR back with the organizer and the website out of the picture.\n' "$PRICE_NEAR"
