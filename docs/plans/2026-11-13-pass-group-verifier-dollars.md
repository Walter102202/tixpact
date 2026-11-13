# Entry pass, group verifier and prices in dollars: implementation plan

Written 2026-11-13 13:40 (America/Santiago) by the integrator. Submission closes 2026-11-14 23:59 UTC.

**Goal:** close the three gaps between the product and what its tracks ask for: a page only the holder can open (an entry pass checked at the door), a verifier that is a group instead of one account, and tickets priced in a dollar token, with the ticket in the wallet showing its live state.

**Architecture:** five lanes run in parallel against the interface frozen below. Lanes P and D do not touch the contract and merge to `main` as they finish. Lanes C2, T2, K2 and W2 build contract v2 and its clients on their own branches; `main` stays the shippable v1 until the gate.

**How to work:** everything under "How to work on this plan" in [`2026-11-12-ticket-escrow-mvp-plan.md`](2026-11-12-ticket-escrow-mvp-plan.md) applies unchanged: preflight, the decision rule (decide as a top 1% engineer would, record it in `docs/decisions/`, never ask Walter), working conventions, quality bar, definition of done, reporting format, and "Never". Reports go to `C:\dev\near-project-reports\track-<lane>.md`. One commit per task, pushed to the lane's branch at once. Nobody but the integrator touches `main`, the frozen interface, testnet accounts or the README.

## Lanes

| Lane | Branch, worktree | Owner | Tasks | Touches |
|---|---|---|---|---|
| P | `track/p`, `.claude/worktrees/p` | teammate | P1, P2, P3 | `packages/client/src/pass*`, `web/`, `mcp/`, `scripts/pass.mjs` |
| D | `main` | integrator | D1 | `scripts/group-verifier.sh`, `docs/proof-group-verifier.md` |
| C2 | `track/c2`, `.claude/worktrees/c2` | teammate | C5, C6, C7 | `contract/src/` |
| T2 | `track/t2`, `.claude/worktrees/t2` | teammate | T1, T2, T3 | `fixtures/`, `contract/tests/` |
| K2 | `track/k2`, `.claude/worktrees/k2` | teammate | K1, K2 | `packages/client/`, `mcp/` |
| W2 | `track/w2`, `.claude/worktrees/w2` | teammate | W6, W7 | `web/` |
| I | `track/i2` | integrator | I4, I5, I6 | `scripts/`, `docs/`, deployment |

Pairs that share an interface: C2 pushes a compiling skeleton of interface v2 (signatures, shapes, `new(tokens)`, bodies that panic) as its **first commit, within 40 minutes**, and T2 merges `origin/track/c2` to run its tests. K2 pushes types, builders and fixtures (bodies may be stubs) as its **first commit, within 40 minutes**, and W2 merges `origin/track/k2`. Each of T2 and W2 merges its pair again before its last commit. W2 also merges `origin/main` before its last commit (lane P lands there first).

## Gates (America/Santiago)

- Fri 17:30: P1 and P2 merged, D1 proven on testnet.
- Fri 20:00: C5 and C6 pushed, T2's tests green against them; K1 pushed, W6 working on fixtures.
- **Fri 22:00, go or no-go for v2:** contract reviewed by a fresh reviewer ("merge"), `bash scripts/gate.sh` green on the merged tree, v2 deployed to a fresh testnet account, story C of `scripts/demo-scenario.mjs` replayed, web reading it. If any of these is missing, v2 stays on its branches and `main` ships as it is.
- Sat 08:00: the build Walter rehearses and records.

Cut order inside v2, first cut first: the drawn ticket image (C5 `media`), the faucet button, the organizer's currency picker (events in dollars are then created by script), the agent's view of token events.

## Frozen interface (v2)

Additive to v1 (same plan file as above, "Frozen interface (v1)"). Everything not named here is unchanged.

### Currencies

A deployment accepts NEAR and a fixed list of NEP-141 tokens given at `new`. Nobody can add one later.

```rust
pub struct TokenSpec { pub account_id: AccountId, pub symbol: String, pub decimals: u8 }   // symbol 1..=12 ASCII bytes, decimals <= 24
#[init] pub fn new(tokens: Vec<TokenSpec>) -> Self;                                         // at most 4, no duplicates

// EventTerms gains: currency: Option<AccountId>   (null = NEAR; otherwise one of Config.tokens, else ERR_INVALID_TERMS)

// Purchase in a token. Called by the token contract while it runs the buyer's ft_transfer_call.
pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128;  // returns "0": the whole amount is kept
```

- The buyer calls `ft_transfer_call({ receiver_id: <escrow>, amount: <price>, msg: "{\"event_id\":7}" })` on the token with 1 yocto. `sender_id` becomes the first holder.
- `ft_on_transfer` applies rule R4 and three more checks: the caller (`predecessor`) is the event's `currency`; `amount == price`; `msg` parses. On any failure it **panics** with the code, so the token returns the whole amount to the buyer. New codes: `ERR_WRONG_CURRENCY`, `ERR_BAD_MESSAGE`. A wrong amount is `ERR_WRONG_DEPOSIT`.
- `buy_ticket` on a token-priced event fails with `ERR_WRONG_CURRENCY`. `price` and `principal` are in the smallest unit of the event's currency.
- Refunds and payouts of a token-priced event call `ft_transfer({ receiver_id, amount, memo: null })` on the token, forwarding the caller's 1 yocto, with static gas `GAS_FT_TRANSFER` (start at 20 Tgas, measure in C7), followed by the same private callback as v1. Rule R7 is unchanged: a recipient who is not registered with the token, or a token that fails, gives the right back, once. The callback reads only the status of the token's receipt (integrator's ruling, 2026-11-13): a receipt that succeeded settles the payment whatever it answered, and is never read as a failure.
- The liquidity check of v1 covers NEAR events only (`total_held` sums NEAR events). For a token the contract cannot read its balance in the same call; a shortfall fails the transfer and R7 restores.
- The operating budget stays in NEAR for every event. One event's ledger is in one currency; the accounting identity holds per event.
- `terms_hash` covers `currency`: the Borsh tuple gains it as its last element.
- The contract account must be registered with each token (`storage_deposit`) before sales; without it the token rejects the purchase and the buyer keeps the money. That is a deployment step (I5), checked by `scripts/verify-deployment.mjs`.

JSON: `EventView`, `TicketView`, `AccountingView` and `OperationView` gain `"currency": null | "<token account>"`. `Config` gains `"tokens": [{ "account_id": "…", "symbol": "tUSD", "decimals": 6 }]` and reports `"version": "2.0.0"`. NEP-297: standard `ticket_escrow` version `2.0.0`; `event_created`, `ticket_purchased` and the settlement events carry `currency`.

### The ticket shows its state

`nft_token` and the enumeration methods return metadata derived at call time from the event and the ticket. Nothing new is stored.

- `title`: as in v1.
- `description`: `Ticket {serial} of {capacity} for {title} at {venue}.` followed by one sentence chosen by `claim`: `Reserved` → `{amount} is reserved in the contract until the event is resolved.`; `Refundable` → `The event was not confirmed: whoever holds this ticket can claim {amount}.`; `RefundPending` → `A refund of {amount} is on its way to the holder.`; `Refunded` → `{amount} was refunded to the holder.`; `ReleasedToOrganizer` → `The event was confirmed and the price went to the organizer.`
- `extra`: a JSON string `{"event_id":1,"serial":1,"status":"Active","claim":"Reserved","outcome":"Unresolved","principal":"…","currency":null}`.
- `media`: `data:image/svg+xml;base64,…`, a ticket drawn from the same facts (title, serial, amount, the claim word), at most 2 KB before encoding; `media_hash`: base64 SHA-256 of the SVG bytes.
- `{amount}` is written on chain as `0.5 NEAR` or `10 tUSD`: whole part, a point and the fraction only when there is one, no trailing zeros, then the symbol.

### Client package (K2 writes, W2 and the scripts use)

```ts
// schemas.ts
type TokenSpec = { account_id: string; symbol: string; decimals: number };
// Config.tokens: TokenSpec[];  EventView | TicketView | AccountingView | OperationView .currency: string | null

// format.ts
type Unit = { symbol: string; decimals: number };
function unitOf(config: Config, currency: string | null): Unit;            // null -> { symbol: 'NEAR', decimals: 24 }
function formatAmount(amount: string, unit: Unit): string;                 // "0.5 NEAR", "10 tUSD"
function parseAmount(text: string, unit: Unit): string | null;             // smallest units, null when not a valid amount

// actions.ts (new builders; existing ones keep their signatures)
actions.buyTicketWithToken(contractId, event): ContractCall                // ft_transfer_call on event.currency, 1 yocto, 100 Tgas
actions.registerWithToken(token, accountId, deposit): ContractCall         // storage_deposit, registration_only: true
actions.faucet(token): ContractCall                                        // test token only, 30 Tgas

// reader.ts
tokenBalance(token, accountId): Promise<string>
tokenRegistration(token, accountId): Promise<{ registered: boolean; minDeposit: string }>

// tx.ts
purchaseResult(outcome, contractId): { bought: true; tokenId: string } | { bought: false; code: string | null }
```

`ft_transfer_call` **succeeds as a transaction even when the purchase was rejected** (the token refunds in its resolver). `purchaseResult` decides from the receipts: bought when a receipt executed by the escrow (`contractId`) succeeded and logged a `ticket_purchased` event of standard `ticket_escrow` (its `token_id` is the ticket); otherwise not bought, with the `ERR_` code of the escrow's failed receipt. It also covers the `buy_ticket` outcome. The contract id is required (changed on 2026-11-13 after review): without it a look-alike log written by another contract would read as a purchase.

### Entry pass (lane P; no contract change)

A pass is a NEP-413 message signed by the holder's wallet. Nothing is sent to the chain or to a server.

```ts
// packages/client/src/pass.ts
const PASS_TTL_MS = 300_000;          // a pass admits for five minutes
const PASS_SKEW_MS = 60_000;          // a pass dated up to a minute ahead is accepted
type EntryPass = { v: 1; contract: string; ticket: string; account: string;
                   publicKey: string; signature: string; nonce: string; issuedAtMs: number };
function passMessage(p: { contract: string; ticket: string; issuedAtMs: number }): string;
function passNonce(issuedAtMs: number, random: Uint8Array): Uint8Array;    // 32 bytes: 8 bytes big-endian ms, then 24 random
function nep413Hash(p: { message: string; nonce: Uint8Array; recipient: string }): Uint8Array;
function encodePass(pass: EntryPass): string;                              // base64url of the JSON
function decodePass(text: string): EntryPass | null;                       // a bare pass, or any URL carrying #p=<pass>
type PassCheck = { id: 'signature' | 'key' | 'holder' | 'ticket' | 'fresh'; ok: boolean; detail: string };
type PassChain = { accessKey(accountId: string, publicKey: string): Promise<'full' | 'function-call' | 'missing'>;
                   ticket(tokenId: string): Promise<TicketView | null> };
function checkPass(pass: EntryPass, contractId: string, chain: PassChain, nowMs: number):
  Promise<{ admitted: boolean; checks: PassCheck[] }>;                     // always the five checks, in this order
```

- `passMessage` is exactly four lines joined by `\n`: `Entry pass`, `Contract: <contract>`, `Ticket: <ticket>`, `Issued: <ISO 8601 UTC with milliseconds>`. The NEP-413 `recipient` is the contract id; there is no callback URL.
- `nep413Hash` is SHA-256 of: the tag `2147484061` (2^31 + 413) as u32 little-endian, then the Borsh encoding of `{ message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> = None }`.
- `publicKey` is `ed25519:<base58>`. `signature` is accepted as base64 (what wallets return) and as `ed25519:<base58>` (what the NEAR CLI prints). `nonce` is base64.
- Checks: `signature` (the pass names this contract, the nonce starts with `issuedAtMs`, and the signature verifies over the rebuilt message); `key` (the key is a **full-access** key of `account` now: a deleted key or a function-call key fails); `holder` (`ticket.owner_id === account`); `ticket` (status `Active` and claim other than `Refunded`); `fresh` (`-PASS_SKEW_MS <= now - issuedAtMs <= PASS_TTL_MS`). `admitted` is all five. A failed check's `detail` is a sentence a door attendant can act on, for example `ana.testnet signed this pass but no longer holds ticket 5-1. The holder is luis.testnet.`
- Known-answer test, signed by near-cli-rs 0.31.1 (not our code), which `checkPass`'s signature step must accept:

```text
message    Entry pass\nContract: ticket-escrow.testnet\nTicket: 1-1\nIssued: 2026-11-13T16:30:00.000Z
nonce      AAABodW+l0AICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=
recipient  ticket-escrow.testnet
accountId  te-d1-luis.testnet
publicKey  ed25519:DYoE7CvF7PtSBrCdmu96Y8yZPsWhnYYt3vP2ygTXH79S
signature  ed25519:ZQFWWD6ZAFSE1TJ5oSKoHpSWMihvSRaXVrK71ctXj99uQwv4VFFrWw9o4RSab9pKXNULvnDEgLTAi9fJdQHXfmi
```

  Anyone can produce another with `near message sign-nep413 utf8 '<message>' nonce '<base64>' recipient <contract> sign-as <account> sign-with-legacy-keychain network-config testnet`.

## Lane P: entry pass and the group verifier's label

### Task P1: the pass, checked without a browser

Files: `packages/client/src/pass.ts`, `pass.test.ts`, export from `index.ts`; `scripts/pass.mjs`; `mcp/src/tools.ts` and its tests; `docs/threat-model.md` (section "Entry pass").

- [x] Tests first: the known-answer vector verifies; changing any of message, nonce, recipient or signature fails `signature`; changing the account fails `key`, not `signature` (NEP-413 does not sign the account: the signing key must be a full-access key of the account named); each of the other four checks fails alone with its sentence (transferred ticket, function-call key, deleted key, refunded ticket, pass six minutes old, pass two minutes ahead); `decodePass` reads a bare pass and a URL and returns `null` on garbage.
- [x] Implement `pass.ts` with the crypto already in the workspace (near-api-js and its dependencies); add no dependency for it.
- [x] `node scripts/pass.mjs verify <pass or URL>` (env `CONTRACT_ID`, RPC as the other scripts): prints the five checks, one per line, `ok` or `NO` with the sentence, then `ADMIT` or `DO NOT ADMIT`; exit 0 or 1. `node scripts/pass.mjs encode` reads the JSON the NEAR CLI prints on stdin plus `--ticket`, `--issued`, `--nonce` and prints the pass, so a pass can be made with the CLI alone.
- [x] MCP tool `show_entry_pass { token_id }`: refuses when the agent does not hold the ticket; otherwise signs with the agent's key and returns the pass and, when `SITE_URL` is set, the door link. It signs no transaction. Tool count and every place that prints it change from 10 to 11 (the integrator updates the README).
- [x] Threat model: what a pass proves, a screenshot shared inside five minutes, a key deleted after signing, a function-call key, the attendant's clock, no record of admissions shared between devices.

### Task P2: the holder's pass page and the door page

Files: `web/src/features/pass/`, `web/src/lib/router.tsx`, `web/src/lib/near/` (message signing), the ticket page, tests.

- [x] The ticket page offers "Show entry pass" to the signed-in holder of an `Active` ticket that is not refunded. Anyone else reads: `Only the holder can show the entry pass for this ticket.`
- [x] The wallet signs the message through near-connect's `signMessage` (read its types in `node_modules` and in `C:\dev\near-project-reports\sources\`; Meteor and Intear are the two wallets). The account in the answer must be the connected one. A wallet that cannot sign messages gets a sentence, not an error.
- [x] The pass view: a QR code of `<origin>/door#p=<pass>`, the ticket and holder, a countdown to expiry, "Sign a new pass" once expired, and a link that opens the door check in a new tab. The pass travels in the URL fragment so it reaches no server. One small QR dependency without dependencies of its own is allowed (list it for the README).
- [x] `/door`: with a pass in the URL it runs `checkPass` against the chain and shows one verdict, large: `Admit` with the ticket and holder, or `Do not admit` with the failing sentences, and the five checks below. Without a pass it explains itself and takes a pasted link. A valid pass can be marked as admitted; the same ticket shown again on this device reads `Already admitted on this device at 21:03`. Kept in `localStorage`, wrapped in try/catch.
- [x] Demo mode (no `VITE_CONTRACT_ID`): demo accounts sign with built-in demo keys that the fixture chain lists as their full-access keys, so both pages work end to end and are marked as demo data like the rest.
- [x] Tests: holder and non-holder, expiry and re-sign, a pass that turns invalid after the ticket is transferred, the door's verdicts, the second scan.

### Task P3: an event page that says its verifier is a group

Files: `packages/client/src/reader.ts` (+ tests, fixtures), `web/src/features/events/`.

- [x] `readGroupVerifier(accountId): Promise<{ members: string[]; needed: number } | null>`: calls `get_policy` on the account. It answers only for a Sputnik DAO policy with exactly one role of kind `Group` whose permissions let it approve function calls (`*:*`, `call:*`, `*:VoteApprove` or `call:VoteApprove`) under `RoleWeight`; `needed` is `min(n, floor(n * num / den) + 1)` for a ratio threshold `[num, den]` (the role's `vote_policy.call` if present, else `default_vote_policy`). Anything else, or a failed view, is `null`.
- [x] The event page and the verifier line then read: `<account> · a group of 3: 2 must agree (a, b, c)`. A plain account reads as today.

## Lane D: a verifier that is a group (integrator)

### Task D1

- [ ] Create a Sputnik DAO on testnet through `sputnikv2.testnet` with three council members from the development accounts and the default policy (more than half must agree).
- [ ] `scripts/group-verifier.sh` (the style and helpers of `direct-calls.sh`; env `CONTRACT_ID`, `ORGANIZER_ID`, `DAO_ID`, `MEMBER_A`, `MEMBER_B`, `BUYER_ID`): the organizer creates an event whose verifier is the DAO; member A proposes `accept_verification` and votes, and the event is still not accepted; member B votes and it is; the buyer buys; after the end A proposes `attest_completed`, A and B vote, the event is `Completed`; the organizer claims the payout. Every step prints `ok:` and a transaction link.
- [ ] Run it on the release contract and record it in `docs/proof-group-verifier.md`.

## Lanes C2 and T2: contract v2

### Task C5 (C2): the ticket shows its state

First commit after the skeleton, with **no change to stored state**, so that it can ship without C6 if the gate says so. Unit tests for the amount formatter and for each of the five sentences.

### Task C6 (C2): events priced in a token

`new(tokens)`, `currency` in the terms and the hash, `ft_on_transfer`, token settlement through the existing reserve-first path, the views. Every v1 rule and test still holds for NEAR events.

### Task C7 (C2, with T2's numbers): storage and gas

Re-measure the per-event and per-ticket constants with a 64-character currency id; set `GAS_FT_TRANSFER` and the token claim minimum from T2's measurements with the same margin rule as `docs/gas.md`; update `docs/gas.md`.

### Task T1 (T2): the tokens

`fixtures/test-token`: a standard NEP-141 with storage management (near-contract-standards), `new(name, symbol, decimals)`, and `faucet()` that mints 100 whole units to a registered caller. This one is also deployed on testnet. `fixtures/hostile-token`: answers the NEP-141 interface and can be switched to fail every transfer, and can call `ft_on_transfer` on a target with any sender, amount and message.

### Task T2 (T2): sandbox tests, one function per name

`t25_token_purchase_reserves_exact_price` (and a wrong amount comes back whole, with no ticket) · `t26_only_the_event_currency_buys` (another listed token, an unlisted token contract, a plain account calling `ft_on_transfer`, NEAR sent to a token event, a token sent to a NEAR event) · `t27_token_refund_follows_the_holder` · `t28_unregistered_holder_gets_the_right_back_once` (the transfer fails, the right returns, the holder registers, the second claim pays) · `t29_token_payout_failure_paths` · `t30_currencies_do_not_share_money` · `t31_a_failing_token_never_pays_twice` · `t32_metadata_follows_the_state` · `t33_terms_hash_covers_the_currency`. All of `t01`…`t24` pass against `new(tokens)`.

### Task T3 (T2): measurements for C7

Storage per event and per ticket with the longest currency id; gas of a token purchase, refund and payout, in the format of `contract/tests/gas.rs`.

## Lanes K2 and W2: clients for v2

### Task K1 (K2): the client package

The types, builders, readers and `purchaseResult` listed above, with tests; fixtures gain one event priced in `tUSD` (6 decimals) with tickets in each claim state, token balances and one unregistered account.

### Task K2 (K2): the agent

`buy_ticket` refuses a token-priced event with a sentence (`its caps are in NEAR`); lists and tickets show the currency; claiming a refund of a token ticket it holds works as for NEAR. Policy tests.

### Task W6 (W2): buying and holding in dollars

Every amount on every page goes through `formatAmount`. The buy panel for a token event shows the buyer's balance, offers the faucet when the balance is short and the token has one, registers when needed, buys with `ft_transfer_call` and reads the result with `purchaseResult` (a rejected purchase says the money came back). The transfer panel warns when the recipient is not registered with the token (they can receive the ticket but must register before a refund reaches them). The claim panel checks registration first and offers the one-step registration.

### Task W7 (W2): organizer, payout and proof

The organizer form picks the currency and takes the price in its units; the payout checks the organizer's registration. The proof page shows, per currency, what the contract holds next to what it owes.

## Lane I: integration (integrator)

- **I4:** `scripts/demo-scenario.mjs` gains story C (an event in dollars: buy, give to an unregistered account, deadline, a claim that fails and returns the right, registration, a claim that pays); `verify-deployment.mjs` checks each token's registration and balance against what is owed; `demo-event.sh` takes `CURRENCY`.
- **I5:** review (a fresh reviewer per lane), merge, deploy the test token and contract v2 to fresh testnet accounts, register the contract with the token, replay every proof.
- **I6:** README, design, threat model, limits, the video script.
