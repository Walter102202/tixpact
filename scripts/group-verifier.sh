#!/usr/bin/env bash
# A verifier that is a group: the event is confirmed only when more than half of a Sputnik DAO's
# council votes for it. The contract needs no change for this: a verifier is an account, and a DAO
# is an account whose calls are decided by votes.
#
#   CONTRACT_ID=<contract>.testnet ORGANIZER_ID=<a>.testnet DAO_ID=<dao>.sputnikv2.testnet \
#   MEMBER_A=<b>.testnet MEMBER_B=<c>.testnet BUYER_ID=<d>.testnet bash scripts/group-verifier.sh
#
# The organizer creates an event whose verifier is the DAO. One member proposes to accept the terms
# and votes: nothing happens. A second member votes: the event goes on sale. A buyer buys. After
# the event ends the same two steps confirm it, and only then can the organizer collect. The script
# exits non-zero if any step answers something else.
#
# Needs: near-cli-rs (`near`, 0.31 or later), the keys of the four signing accounts in the CLI's
# legacy keychain, and a Sputnik DAO (v2) in which MEMBER_A and MEMBER_B may vote and two votes are
# enough, holding at least 1 NEAR. To create one with three members and the default policy:
#   near contract call-function as-transaction sputnikv2.testnet create json-args \
#     '{"name":"<dao>","args":"<base64 of {"config":{"name":"<dao>","purpose":"…","metadata":""},"policy":["<b>","<c>","<e>"]}>"}' \
#     prepaid-gas '150 Tgas' attached-deposit '6 NEAR' sign-as <payer> network-config testnet \
#     sign-with-legacy-keychain send
# Testnet only: any account that does not end in .testnet is refused.
#
# Optional: PRICE_NEAR (0.5), STARTS_IN_SECONDS (120), LENGTH_SECONDS (30), CONFIRM_SECONDS (240).
# The whole run takes about STARTS_IN_SECONDS + LENGTH_SECONDS + 60 seconds, four minutes by default.
# The two votes that accept the terms must land before the event starts: with a slow connection,
# raise STARTS_IN_SECONDS.
set -euo pipefail

: "${CONTRACT_ID:?set CONTRACT_ID}" "${ORGANIZER_ID:?set ORGANIZER_ID}" "${DAO_ID:?set DAO_ID}"
: "${MEMBER_A:?set MEMBER_A}" "${MEMBER_B:?set MEMBER_B}" "${BUYER_ID:?set BUYER_ID}"
PRICE_NEAR="${PRICE_NEAR:-0.5}"
STARTS_IN_SECONDS="${STARTS_IN_SECONDS:-120}"
LENGTH_SECONDS="${LENGTH_SECONDS:-30}"
CONFIRM_SECONDS="${CONFIRM_SECONDS:-240}"

for account in "$CONTRACT_ID" "$ORGANIZER_ID" "$DAO_ID" "$MEMBER_A" "$MEMBER_B" "$BUYER_ID"; do
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
view() { # contract method json-args
  near contract call-function as-read-only "$1" "$2" json-args "$3" \
    network-config testnet now 2>"$log" || { cat "$log" >&2; exit 1; }
}

call() { # contract signer method json-args gas deposit
  local value
  value="$(near contract call-function as-transaction "$1" "$3" json-args "$4" \
    prepaid-gas "$5" attached-deposit "$6" \
    sign-as "$2" network-config testnet sign-with-legacy-keychain send 2>"$log")" || {
    grep -E "ERR_[A-Z_]+|Error|error" "$log" | cut -c1-240 >&2
    echo "FAILED: $3 on $1 signed by $2" >&2
    exit 1
  }
  sed -n 's/.*Transaction ID: *\([A-Za-z0-9]*\).*/\1/p' "$log" | head -n 1 >"$last_tx"
  printf '%s' "$value" | tr -d '\n'
}

text_field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -n 1; }
number_field() { sed -n "s/.*\"$1\": *\([0-9][0-9]*\).*/\1/p" | head -n 1; }
flag_field() { sed -n "s/.*\"$1\": *\(true\|false\).*/\1/p" | head -n 1; }
event_field() { view "$CONTRACT_ID" get_event "{\"event_id\":$event_id}" | "$1" "$2"; }

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

# One proposal that makes the DAO call the ticket contract, with 1 yoctoNEAR as the contract asks.
propose() { # member description method json-args -> proposal id
  local proposal
  proposal="{\"proposal\":{\"description\":\"$2\",\"kind\":{\"FunctionCall\":{\"receiver_id\":\"$CONTRACT_ID\",\"actions\":[{\"method_name\":\"$3\",\"args\":\"$(printf '%s' "$4" | base64 | tr -d '\n')\",\"deposit\":\"1\",\"gas\":\"30000000000000\"}]}}}}"
  call "$DAO_ID" "$1" add_proposal "$proposal" '50 Tgas' "$bond yoctoNEAR"
}
vote() { # member proposal-id
  call "$DAO_ID" "$1" act_proposal "{\"id\":$2,\"action\":\"VoteApprove\"}" '200 Tgas' '0 NEAR' >/dev/null
}
proposal_status() { view "$DAO_ID" get_proposal "{\"id\":$1}" | text_field status; }
wait_until() { # chain time in ms
  while :; do
    now="$(event_field number_field now_ms)"
    [ "$now" -ge "$1" ] && break
    left=$((($1 - now) / 1000 + 1))
    echo "   $left s left"
    sleep "$((left < 15 ? left : 15))"
  done
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

say "The verifier is a group: $DAO_ID"
policy="$(view "$DAO_ID" get_policy '{}' | tr -d ' \n')"
members="$(printf '%s' "$policy" | sed -n 's/.*"Group":\[\([^]]*\)\].*/\1/p' | tr -d '"' | sed 's/,/, /g')"
ratio="$(printf '%s' "$policy" | sed -n 's/.*"default_vote_policy":{[^}]*"threshold":\[\([0-9]*\),\([0-9]*\)\].*/\1 \2/p')"
bond="$(printf '%s' "$policy" | sed -n 's/.*"proposal_bond":"\([0-9]*\)".*/\1/p')"
[ -n "$members" ] && [ -n "$ratio" ] && [ -n "$bond" ] || {
  echo "$DAO_ID did not answer with a Sputnik DAO policy this script understands." >&2
  exit 1
}
count="$(printf '%s' "$members" | tr ',' '\n' | grep -c .)"
needed=$((count * ${ratio% *} / ${ratio#* } + 1)) # more than the ratio: 3 members at 1/2 need 2
[ "$needed" -le "$count" ] || needed="$count"
echo "   members: $members"
echo "   the group acts when $needed of its $count members vote for the same proposal"

say "$ORGANIZER_ID creates an event whose verifier is the group"
budget="$(view "$CONTRACT_ID" quote_event_budget '{"capacity":1}' | tr -d '" \n')"
starts=$((($(date +%s) + STARTS_IN_SECONDS) * 1000))
ends=$((starts + LENGTH_SECONDS * 1000))
deadline=$((ends + CONFIRM_SECONDS * 1000))
terms="{\"terms\":{\"title\":\"Jury night\",\"venue\":\"Teatro Municipal\",\"starts_at_ms\":$starts,\"ends_at_ms\":$ends,\"resolution_deadline_ms\":$deadline,\"price\":\"$price\",\"capacity\":1,\"verifier_id\":\"$DAO_ID\"}}"
event_id="$(call "$CONTRACT_ID" "$ORGANIZER_ID" create_event "$terms" '30 Tgas' "$budget yoctoNEAR")"
tx
case "$event_id" in
  "" | *[!0-9]*) echo "   WRONG: create_event answered '$event_id', not an event number" >&2; exit 1 ;;
esac
echo "   ok: event $event_id"
terms_hash="$(event_field text_field terms_hash)"

say "$MEMBER_A proposes that the group accept the exact terms, and votes for it"
accept_id="$(propose "$MEMBER_A" "Accept verifying event $event_id" accept_verification \
  "{\"event_id\":$event_id,\"terms_hash\":\"$terms_hash\"}")"
tx
vote "$MEMBER_A" "$accept_id"
tx
expect "proposal $accept_id" "InProgress" "$(proposal_status "$accept_id")"
expect "accepted by the verifier, after one vote" "false" "$(event_field flag_field verifier_accepted)"

say "$MEMBER_B votes for it too: the group accepts, and the event goes on sale"
vote "$MEMBER_B" "$accept_id"
tx
expect "proposal $accept_id" "Approved" "$(proposal_status "$accept_id")"
expect "accepted by the verifier, after two votes" "true" "$(event_field flag_field verifier_accepted)"
expect "phase" "OnSale" "$(event_field text_field phase)"

say "$BUYER_ID buys a ticket for $PRICE_NEAR NEAR"
token_id="$(call "$CONTRACT_ID" "$BUYER_ID" buy_ticket "{\"event_id\":$event_id}" '50 Tgas' "$price yoctoNEAR" | tr -d '"')"
tx
expect "ticket" "$event_id-1" "$token_id"
expect "price reserved in the contract" "$price" \
  "$(view "$CONTRACT_ID" get_accounting "{\"event_id\":$event_id}" | text_field principal_reserved)"

say "The event takes place; waiting for its end on the chain's clock"
wait_until "$ends"

say "$MEMBER_A proposes that the group confirm the event, and votes for it"
attest_id="$(propose "$MEMBER_A" "Confirm that event $event_id took place" attest_completed \
  "{\"event_id\":$event_id,\"evidence_ref\":\"group vote, proposal on $DAO_ID\"}")"
tx
vote "$MEMBER_A" "$attest_id"
tx
expect "outcome, after one vote" "Unresolved" "$(event_field text_field outcome)"

say "$MEMBER_B votes for it too: the event is confirmed"
vote "$MEMBER_B" "$attest_id"
tx
expect "proposal $attest_id" "Approved" "$(proposal_status "$attest_id")"
expect "outcome, after two votes" "Completed" "$(event_field text_field outcome)"
expect "confirmed by" "$DAO_ID" "$(event_field text_field resolved_by)"

say "$ORGANIZER_ID collects, now that the group confirmed"
paid="$(call "$CONTRACT_ID" "$ORGANIZER_ID" claim_payout "{\"event_id\":$event_id}" '100 Tgas' '1 yoctoNEAR')"
tx
expect "claim_payout" "true" "$paid"
expect "paid to the organizer" "$price" \
  "$(view "$CONTRACT_ID" get_accounting "{\"event_id\":$event_id}" | text_field organizer_settled)"

printf '\nDone: no single account confirmed the event. Two of the group had to agree, twice.\n'
