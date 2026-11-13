# Ticket Escrow on NEAR

**Event tickets whose refund does not depend on the seller.**

The price of each ticket stays reserved in a NEAR contract until a verifier, agreed in advance, confirms that the event took place. Only then can the organizer collect it. If the event is cancelled, or the deadline passes and nobody confirmed it, whoever holds the ticket takes the money back without needing the organizer, the ticketing site or us.

Why NEAR: the verifier is an account name a buyer can read before paying, the contract's keys can be deleted so that nobody can change it afterwards, and fees are low enough for each holder to claim their own refund ([more](#what-near-does-here)).

Built at NEAR HACKATHON 2026. It runs on **testnet**, it is **not audited**, and it must not hold real money. In the web app the product is called TixPact.

| | |
|---|---|
| Contract (testnet) | [`ticket-escrow-v2.testnet`](https://testnet.nearblocks.io/address/ticket-escrow-v2.testnet) |
| Access keys of the contract account | 1. Whoever holds it can replace the code; with zero keys nobody can. The proof page and `scripts/verify-deployment.mjs` count them from the chain. |
| Dollar token it accepts (testnet) | [`tusd.ticket-escrow-v2.testnet`](https://testnet.nearblocks.io/address/tusd.ticket-escrow-v2.testnet): `tUSD`, a test dollar anyone can mint, worth nothing |
| Hosted demo | None. Run it locally: [Try it](#try-it), step 1. |
| Every claim below, with its transaction | [`docs/proof.md`](docs/proof.md) |
| How it works and why | [`docs/design.md`](docs/design.md) |
| Every way to cheat we could think of | [`docs/threat-model.md`](docs/threat-model.md) |

## The problem

When you buy a ticket, the money goes to the seller, and a refund is a promise that depends on the seller still having it.

| What happened | Source |
|---|---|
| A ticketing company "relied on incoming funds from new ticket sales to cover its costs and debts". It was ordered to pay about $9 million to an estimated 45,000 organizers and buyers. | [Washington State Attorney General, 2021-03-08](https://atg.wa.gov/news/news-releases/ag-ferguson-brown-paper-tickets-will-fully-refund-event-organizers-ticket-buyers) |
| A festival's operator "owed more than $7 million to over 900 creditors" with "only $300,664 in the bank". | [ABC News, 2026-06-11](https://www.abc.net.au/news/2026-06-11/byron-bay-bluesfest-report-reveals-debt/106769938) |
| About 620 complaints for one cancelled match remain unresolved, most of them for money not refunded; one of the producers could not be found. | [SERNAC, Chile's consumer agency, 2026-10-01](https://sernac.cl/portal/604/w3-article-89234.html) (in Spanish) |

The law does not fill the gap by itself. When a UK ticketing company went under, the High Court found that "no trust is created in respect of the proceeds of ticket sales" ([[2024] EWHC 1554 (Ch)](https://caselaw.nationalarchives.gov.uk/ewhc/ch/2024/1554), paragraph 58; the claim there was the promoters'): ticket money sitting with an intermediary was the intermediary's money.

## The solution

The ticket money never reaches the organizer before the event is confirmed. It waits in the contract, under terms anyone can read before paying:

1. **The organizer creates an event** and names its terms: the price and its currency, the number of tickets, when the event starts and ends, the account that will verify it, and a deadline for the confirmation.
2. **The verifier accepts those exact terms.** No ticket is sold before that.
3. **A buyer pays the exact price and receives a ticket.** The price stays in the contract, reserved for that event.
4. **If the verifier confirms that the event took place**, between its end and the deadline, the organizer collects the price of the tickets sold.
5. **If the organizer or the verifier cancels, or the deadline passes with no confirmation**, the event switches to refunds and each holder claims the price of their own ticket. After the deadline any account can make that switch, so nobody's permission is needed.

Around that rule:

- **The ticket can be priced in dollars.** An event is priced in NEAR or in a dollar token, and the refund is the same amount of the same currency ([Prices in dollars](#prices-in-dollars)).
- **The ticket shows where its money is.** Its text and picture change with the state of its money ([A ticket that shows its state](#a-ticket-that-shows-its-state)).
- **The ticket opens the door.** Its holder signs a five-minute entry pass with their wallet, and the attendant's page checks it against the chain ([The ticket at the door](#the-ticket-at-the-door)).
- **An AI agent can hold tickets.** It buys within spending caps and claims its own refunds ([An agent that buys and claims for you](#an-agent-that-buys-and-claims-for-you)).

Each problem, what the contract does about it, and the test that proves it:

| Problem | What the contract does | Test |
|---|---|---|
| The seller spends the ticket money before the event. | The price is reserved in the contract, per event. The organizer cannot receive anything until the verifier confirms the event. | `t01_purchase_reserves_exact_price`, `t03_organizer_cannot_withdraw_unresolved` |
| The organizer is insolvent, silent or gone, so nobody approves refunds. | A deadline is part of the terms. Once it passes without a confirmation, any account can switch the event to refunds, and each holder claims their own. | `t05_anyone_expires_after_deadline`, `t09_refund_pays_exact_principal` |
| The refund goes to whoever bought first, not to whoever holds the ticket now. | The ticket is an NFT (NEP-171) and the refund belongs to its current holder. Give the ticket away and the right goes with it. | `t07_refund_follows_the_holder` |
| The refund comes back in a coin whose price moved. | An event can be priced in a dollar token (NEP-141). The contract holds the token itself, and the refund is the same amount of it. | `t25_token_purchase_reserves_exact_price`, `t27_token_refund_follows_the_holder` |
| "Trust us" hides who decides. | The verifier is a named account, shown before you pay, that accepted the exact terms. It can confirm only between the end of the event and the deadline. | `t02_purchase_needs_acceptance_and_capacity`, `t04_attestation_completes_event`, `t15_deadline_boundaries` |
| Someone with admin rights can change the rules later. | There is no owner, no admin method and no upgrade method. Once the account's last key is deleted, nobody can replace the code. | `scripts/verify-deployment.mjs` |

## What NEAR does here

- **Named accounts with removable keys.** The verifier is an account name a buyer can read before paying. An account with no keys cannot be changed by anyone: once the contract account's last key is deleted, nobody, including us, can replace the code or move its balance.
- **An account can be a group.** The verifier is any account, and on NEAR an account can be a Sputnik DAO whose calls are decided by votes. On testnet an event was accepted, and later confirmed, only when two of three members had voted, with no change to this contract ([proof](docs/proof-group-verifier.md)). The event page reads the DAO's rules from the chain and says so next to the verifier: "a group of 3; its rules now: 2 must agree", with the members' names.
- **Messages signed by the wallet (NEP-413).** An entry pass is a message the holder's wallet signs: no transaction and no fee. The door verifies the signature and reads three facts from the chain at that moment: the key is a full-access key of the account, the account holds the ticket, and the ticket was not refunded.
- **Asynchronous payments handled as such.** On NEAR a transfer runs in a later block and can fail on its own. Every payment here first marks the right as used and records a pending payment, then sends the money, and settles the result in a callback only the contract can call: confirmed on success, restored on failure, never retried blindly.
- **The NFT standards (NEP-171, 177, 181).** The ticket's ownership record is the standard one, and it is the only one: the refund cannot follow a stale copy. Its metadata is computed at each read, so the text and the picture a wallet shows always say where the ticket's money stands.
- **The token standards (NEP-141, 145).** Buying in dollars is one `ft_transfer_call` on the token: the token moves the price and calls this contract in the same transaction, and returns the money if the contract refuses. Refunds and payouts are transfers of the token, settled by the same private callbacks as NEAR.
- **Storage staking.** State costs balance, so the organizer prepays a measured budget for the whole event and ticket money is never used for it.
- **Structured events (NEP-297).** Every step logs an event (`ticket_escrow` 2.0.0).
- **Low fees.** Each holder pays the fee of their own claim (measured per method in [`docs/gas.md`](docs/gas.md)), which is what makes "no operator, no batch payout" practical.
- **A sandbox that controls time and state.** The tests move the clock past deadlines, delete accounts in the middle of a payment and force a balance shortfall.

## Try it

Each step says what to do and what you should see.

1. **Open the web app.** With Node 22 and pnpm 10 (install lines in [Setup](#setup)):

   ```bash
   pnpm install --frozen-lockfile
   VITE_CONTRACT_ID=ticket-escrow-v2.testnet VITE_FAUCET_TOKENS=tusd.ticket-escrow-v2.testnet pnpm --filter @ticket-escrow/web dev
   ```

   Open `http://localhost:5173`. You should see the events read from the contract above: at least "Jazz night", "Opening night", "Dollar night" (priced at 10 tUSD), "Direct calls", "Agent night" and "Jury night" (every run of step 5 adds one). Open one: the page shows the verifier's account, the deadline and how much is reserved in the contract. Open `/tickets/4-1`: where the money went, the history with the purchase by Ana, the transfer to Luis and the refund to Luis, and under "As wallets show it" the picture the contract draws for that state. Open `/proof`: the code hash, the access keys, and the balance next to what the contract holds, in NEAR and in tUSD, read from the chain.
2. **Read the proof.** Open [`docs/proof.md`](docs/proof.md). Each row is one step of three stories played on testnet (an organizer who disappears; an event that is confirmed; an event priced in dollars), with the transaction link and the observed result. Open any link in the explorer and compare.
3. **Check the deployment yourself.** With Node 22 and pnpm:

   ```bash
   pnpm install --frozen-lockfile && pnpm --filter @ticket-escrow/client build
   node scripts/verify-deployment.mjs ticket-escrow-v2.testnet --allow-keys --tokens tusd.ticket-escrow-v2.testnet
   ```

   You should see the code hash, `Access keys     1`, the balance next to the principal held, the same for the token (`Registered      yes`, its balance next to the `tUSD` held), and a final line starting with `OK with --allow-keys`. The script signs nothing. Without `--allow-keys` it ends with `NOT VERIFIED` and exits non-zero while the account has any key; it also fails if the contract is a test build or holds less than it owes.
4. **Run every test.** On Linux, macOS or WSL (see [Setup](#setup)):

   ```bash
   bash scripts/gate.sh
   ```

   You should see the web checks, then the contract tests listed by name (`t01_purchase_reserves_exact_price ... ok`, and so on), then `== gate passed: all ==`. The contract tests start a local NEAR node, deploy the contract and move the clock past deadlines. The first run compiles everything and downloads the node: about ten minutes.
5. **Use the contract without our website.** With the NEAR CLI and four testnet accounts ([details](#if-the-website-is-down)):

   ```bash
   CONTRACT_ID=ticket-escrow-v2.testnet ORGANIZER_ID=... VERIFIER_ID=... BUYER_ID=... ANYONE_ID=... \
     bash scripts/direct-calls.sh
   ```

   You should see seven numbered steps, five of them with a transaction link. Step 5 waits for the deadline on the chain's clock, so the whole run takes about three minutes. The last lines are `ok: ticket = Refunded` and `Done: the buyer got 0.5 NEAR back with the organizer and the website out of the picture.`
6. **Let an AI agent read the contract.** With Node 22 and pnpm:

   ```bash
   pnpm install --frozen-lockfile && pnpm build
   CONTRACT_ID=ticket-escrow-v2.testnet pnpm --filter @ticket-escrow/mcp smoke
   ```

   You should see `Tools (11): list_events, get_event, ...`, the events, the contract's code hash and balance next to what it owes, and `Smoke passed.` It runs without a key, so nothing is signed. To connect Claude Code, or to let the agent buy within a cap, see [`docs/mcp.md`](docs/mcp.md).
7. **Show a ticket at the door.** Start the web app on its built-in demo data:

   ```bash
   VITE_FIXTURES=1 pnpm --filter @ticket-escrow/web dev
   ```

   In the banner, pick the demo account `ana.testnet`. Open `/tickets/1-1` and press **Show entry pass**: you should see a QR code and a countdown that starts just under five minutes (`Admits for 4:58`). Follow **Open the door check in a new tab**: you should see `Demo: would admit`, the five checks marked `ok` and the time of the check. Press **Check again**: `Demo: would not admit`, with `Already admitted on this device at ...` under it. The same check on the real contract, from the command line, is in [`docs/proof-entry-pass.md`](docs/proof-entry-pass.md), with a pass you can check again yourself.

## Claims and where each is proven

Tests are sandbox tests in [`contract/tests/`](contract/tests/), one function per name; they run against a real local node, not a mock. "Proof" is the row in [`docs/proof.md`](docs/proof.md) with the testnet transaction.

| Claim | Test | Proof |
|---|---|---|
| A purchase reserves exactly the price; any other amount is rejected. | `t01_purchase_reserves_exact_price`, `t17_mint_keeps_the_deposit` | A3, A4 |
| No ticket is sold before the verifier accepted the exact terms, or beyond capacity. | `t02_purchase_needs_acceptance_and_capacity` | |
| The organizer cannot take the money of an unconfirmed event. | `t03_organizer_cannot_withdraw_unresolved` | A5 |
| Only the verifier confirms, and only between the end of the event and the deadline. A confirmed event gives no refunds. | `t04_attestation_completes_event`, `t15_deadline_boundaries` | B5, B6 |
| After the deadline, anyone can switch the event to refunds. | `t05_anyone_expires_after_deadline` | A7 |
| Only the organizer or the verifier can cancel, and only before the deadline. | `t06_cancel_only_by_roles` | |
| The refund follows the ticket: the first buyer is rejected, the current holder is paid. | `t07_refund_follows_the_holder` | A6, A8, A9 |
| A ticket is refunded once. | `t08_no_double_refund` | A11 |
| The holder receives exactly the price paid. | `t09_refund_pays_exact_principal` | A9, A10 |
| A payment that fails gives the right back, once. | `t10_failed_transfer_restores_claim_once`, `t24_restored_claim_waits_for_liquidity` | |
| A callback that fails never causes a second payment. | `t11_failed_callback_keeps_pending` | |
| A ticket sent to another contract stays locked until that contract answers, whatever it answers. | `t12_transfer_call_receiver_outcomes`, `t13_resolver_ignores_time_window` | |
| Nobody can fake the result of a payment. | `t14_callbacks_are_private` | |
| Storage is paid by the organizer up front and stays within that budget. | `t16_storage_stays_within_budget` | A1 |
| The organizer's payout follows the same safe path. | `t18_payout_failure_paths` | B7, B8 |
| One event can never pay with another event's money. | `t19_events_do_not_share_money` | |
| A verifier who lies is believed. This is a limit, stated and tested. | `t21_false_attestation_is_a_trust_limit` | |
| The verifier can be a group: one member alone neither accepts the terms nor confirms the event. | `scripts/group-verifier.sh` | [`docs/proof-group-verifier.md`](docs/proof-group-verifier.md) |
| The ticket is a standard NFT that wallets and explorers understand. | `t22_standard_token_surface` | |
| The ticket's title, text and picture are computed from its state at every read: a refunded ticket says so wherever it is shown. | `t32_metadata_follows_the_state` | A13, B9, C21 |
| An event priced in a dollar token reserves exactly the price in that token; any other amount, currency or message is returned whole. | `t25_token_purchase_reserves_exact_price`, `t26_only_the_event_currency_buys` | C6 to C10 |
| The token refund follows the ticket and pays exactly what was paid. | `t27_token_refund_follows_the_holder` | C11, C13, C17, C18 |
| A holder the token cannot pay loses nothing: the right comes back once, and is paid after registering. | `t28_unregistered_holder_gets_the_right_back_once` | C14 to C17, C19 |
| A token that fails, or answers nonsense, never causes a second payment or a stuck one. | `t29_token_payout_failure_paths`, `t31_a_failing_token_never_pays_twice`, `a_token_that_pays_but_answers_oddly_never_pays_twice`, `a_token_answer_does_not_stop_the_confirmation` | |
| Money in one currency never pays for another. | `t30_currencies_do_not_share_money` | |
| The currency is part of the terms the verifier accepted, and the list of tokens cannot grow after deployment. | `t33_terms_hash_covers_the_currency`, `scripts/verify-deployment.mjs --tokens` | |
| An entry pass admits only the account that holds the ticket now, for five minutes; a changed, replayed or forged pass, a refunded ticket and a ticket given away after signing are refused. | `packages/client/src/pass.test.ts` | [`docs/proof-entry-pass.md`](docs/proof-entry-pass.md) |
| The whole flow works from the command line alone. | `scripts/direct-calls.sh` | |
| The deployed contract is not a test build, holds at least what it owes, and its access keys are counted from the chain (zero once the last key is deleted). | `scripts/verify-deployment.mjs` | |
| An agent cannot spend above its caps or call anything else. | `mcp/src/policy.test.ts`, `mcp/src/tools.test.ts` | [`docs/mcp.md`](docs/mcp.md#verification) |

## Prices in dollars

The organizer picks the currency when creating the event: NEAR, or a dollar token from the list fixed when the contract was deployed. On testnet the list has one token, `tUSD`: a test dollar we deployed, worth nothing, with a faucet anyone can use.

- **Buying** is one transaction on the token. The token moves the price to the contract and tells it which event. Anything but exactly the price, in that event's currency, is refused, and the token returns it whole.
- **Refunds and payouts** are paid in the token, to whoever holds the ticket or to the organizer, by the same steps as a payment in NEAR: mark the right as used, send the money, settle the result.
- **An account the token does not know cannot be paid until it registers.** A token keeps balances only for accounts registered with it. If the holder is not, the claim pays nothing and loses nothing: the right goes back to the ticket. The web app offers the registration (about 0.00125 NEAR), and the next claim pays.
- **Currencies never mix.** Each event's ledger is in one currency. NEAR held for one event cannot pay a refund in dollars, or the reverse.

The list of tokens cannot change after deployment, and the currency is part of the terms the verifier accepts. On mainnet the list would name a real dollar token; which one is a decision this prototype does not make. What a token could do to the contract is in the [threat model](docs/threat-model.md#a-token-or-an-account-posing-as-one).

## A ticket that shows its state

The ticket's NFT text and picture are not stored: the contract computes them at every read. The text says where the money is ("10 tUSD is reserved in the contract until the event is resolved.", "10 tUSD was refunded to the holder.", "The event was confirmed and the price went to the organizer."), and the picture, an SVG the contract draws, carries the same word. A wallet or a marketplace that shows the NFT shows this, so a refunded ticket offered for sale says it was refunded. The web app's ticket page shows the same picture and sentence under "As wallets show it", and checks the picture against the hash the contract gives.

## The ticket at the door

The ticket that holds the refund right is also what gets its holder in.

- **The holder** opens `/tickets/<id>/pass` and their wallet signs a short message: the contract, the ticket and the time. Nothing is sent to the chain. The page shows it as a QR code that admits for five minutes.
- **The attendant** opens `/door` on their own device and scans the code, or pastes the pass. The page answers **Admit** or **Do not admit** and lists five checks:

| Check | What must be true |
|---|---|
| `signature` | The pass names this contract and the signature is the wallet's. |
| `key` | The signing key is a full-access key of the account, read from the chain now. |
| `holder` | That account holds the ticket now. |
| `ticket` | The ticket is active and was not refunded. |
| `fresh` | It was signed less than five minutes ago. |

A ticket given away after the pass was signed, a refunded ticket and an old screenshot do not admit. The device remembers the tickets it admitted, so the same ticket shown twice is refused the second time on that device.

There is no server: the same check runs from the command line (`node scripts/pass.mjs verify '<pass>'`), and the agent signs a pass for a ticket it holds (`show_entry_pass`). A pass signed with the NEAR CLI was admitted by the door page reading the deployed contract ([output](docs/proof-entry-pass.md)). What a pass does not stop, starting with a link shared with a friend at another door, is in the [threat model](docs/threat-model.md#entry-pass).

## An agent that buys and claims for you

[`mcp/`](mcp/) is a local MCP server: an AI agent with its own testnet account reads events and tickets, buys, gives tickets away, claims refunds, and signs the entry pass of a ticket it holds. It buys only events priced in NEAR. A ticket of an event priced in a token it can still read, give away and claim. Guide and real output: [`docs/mcp.md`](docs/mcp.md).

- **Caps checked before anything is signed.** A price cap per ticket and a cap on the money it has in tickets at one time. It can call one contract and four methods, and nothing else. `mcp/src/policy.test.ts`
- **It cannot do what the contract forbids.** It cannot confirm an event or claim a ticket it does not hold; the contract's rules apply to it as to anyone.
- **A watcher that never forgets a refund.** A loop that, after a deadline nobody met, switches the event to refunds and claims the agent's tickets. On testnet, on the contract above, it did both within a minute of the deadline (transactions in [`docs/mcp.md`](docs/mcp.md#verification)).
- **The key stays on your machine.** The server runs locally over stdio; nothing is hosted.

The caps do not bound what the agent spends over time: fund its account only with what it may spend.

## What is real and what is simulated

| Real | Simulated |
|---|---|
| The contract, deployed on NEAR testnet, with the rules above enforced on chain. | The money: testnet NEAR from the faucet and `tUSD`, a test token we deployed that anyone can mint. Both are worth nothing. |
| Every transaction in `docs/proof.md`; each can be opened in the explorer. | The people: organizer, verifier, Ana and Luis are accounts we created and played ourselves. |
| The tests: a real local node, real deployments, real failed transfers. | The verifiers: accounts we hold. In the three stories the verifier is one account; in the [group proof](docs/proof-group-verifier.md) it is a DAO where two of three must vote, and all three are ours. |
| The agent, reading and writing that contract, and the web app, reading it. Signing from a browser wallet is untested ([Limits](#limits), 10). | The time scale: demo events last minutes so a deadline can be watched. |

Nothing in the product is decided by an AI or by a server of ours. There is no backend: the web reads the chain through public RPC endpoints.

## Limits

1. **A verifier who lies is believed.** If the verifier confirms an event that did not happen, the organizer is paid. The contract fixes who decides and when, not whether they are right. A group as verifier raises how many must lie, not whether they can.
2. **A silent verifier means refunds**, even for an event that took place. The organizer bears that risk when choosing the verifier.
3. **A payment can stay pending for good.** After sending money, the contract settles the result in a second step. If that step itself fails, that one payment stays pending; in the same way, one ticket sent to another contract can stay locked. We chose a stuck payment over a double payment, and there is no admin to unstick either. The gas reserved for both keeps a measured margin ([`docs/gas.md`](docs/gas.md)), which a protocol change could still exceed.
4. **A lost key is a lost ticket.**
5. **The refund is the same amount of the same currency, not the same value.** The price of NEAR can move between purchase and refund. Pricing the event in a dollar token avoids that, and adds the next limit.
6. **A token is trusted.** The contract believes what a listed token answers, and a real dollar token has an issuer who can freeze an account. A listed token that turned hostile could take what the contract holds in that token; it could not touch NEAR or another token. This is why the list is fixed at deployment and shown to buyers.
7. **The whole price is locked**, so an organizer cannot fund the event with ticket sales.
8. **Not audited, testnet only.** A bug cannot be patched: a new version is a new deployment. The build is not reproducible: the deployed code hash is public and equals what our machine builds from this source (`scripts/verify-deployment.mjs --wasm <file>` compares them), but another machine produces different bytes. Our CI runner prints the hash of its own build, and it is a different one.
9. **An entry pass proves a key, not a person.** Whoever holds the unlocked wallet is admitted. A pass shared within its five minutes admits at any device that has not seen the ticket: duplicates are caught per device, because there is no server to share the record. The attendant must open the door page from their own bookmark; a link the holder shows could lead to a copy that admits anyone.
10. **Signing from a browser wallet is untested.** Every transaction in the proofs was signed from scripts, the NEAR CLI or the agent. The web app reads the deployed contract and builds the same calls, but no purchase, claim or entry pass was signed from a browser wallet. The door page's camera scanner appears only in browsers that have `BarcodeDetector` and was not tried on a phone; elsewhere the attendant pastes the pass.
11. **Out of scope:** proof of attendance, paid resale, identity.

The full list is in the [threat model](docs/threat-model.md#limits).

## How it is built

```text
contract/          Rust contract (near-sdk 5.30.1): events, tickets, per-event ledger, settlement
contract/tests/    Sandbox tests t01...t33 against a local node (t20 and t23 are the two scripts: direct-calls.sh, verify-deployment.mjs)
fixtures/          Test contracts: a holder that deletes itself, a ticket receiver that misbehaves in several ways,
                   the test dollar (tUSD) and a token that misbehaves in several ways
packages/client/   TypeScript: typed views and calls, transaction tracking, the words shown to people, the entry pass
web/               React app (Vite): events, tickets, transfers, claims, an organizer and verifier desk, the proof page,
                   the entry pass and the door page
mcp/               MCP server: an agent with its own account and a spending cap
scripts/           gate.sh (all checks), demo-scenario.mjs (writes docs/proof.md), direct-calls.sh, verify-deployment.mjs,
                   demo-event.sh (one event with a deadline minutes away, to play the refund from the web app),
                   group-verifier.sh (an event whose verifier is a DAO: two of three must vote),
                   pass.mjs (make an entry pass with the NEAR CLI and check one, without the website)
docs/              design, threat model, proof, gas, the agent guide, toolchain, one file per decision
```

The contract's methods, JSON shapes and error codes are listed in two parts: [events, tickets and payments in NEAR](docs/plans/2026-11-12-ticket-escrow-mvp-plan.md#frozen-interface-v1), and [currencies, the ticket's computed text and picture, and the entry pass](docs/plans/2026-11-13-pass-group-verifier-dollars.md#frozen-interface-v2). Decisions taken while building are in [`docs/decisions/`](docs/decisions/README.md), one per file.

## Setup

Linux, macOS or WSL. The contract tests do not run on Windows itself: the local NEAR node has no Windows build.

```bash
# Rust: rustup reads the version, components and wasm target from rust-toolchain.toml
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
. "$HOME/.cargo/env" && rustup toolchain install

# cargo-near 0.23.0: the prebuilt binary, checked against its published checksum (Linux x86_64;
# other platforms: https://github.com/near/cargo-near/releases/tag/cargo-near-v0.23.0)
curl -sSfL -o cargo-near.tar.gz \
  https://github.com/near/cargo-near/releases/download/cargo-near-v0.23.0/cargo-near-x86_64-unknown-linux-gnu.tar.gz
echo "94008b827a457750257eced4b571c33736062cc3bd1ffda3e7af70e2bc9a4073  cargo-near.tar.gz" | sha256sum --check --strict
tar -xzf cargo-near.tar.gz -C "$HOME/.cargo/bin" --strip-components=1 cargo-near-x86_64-unknown-linux-gnu/cargo-near

# Node 22 (22.22.2 or later is what near-api-js asks for) and pnpm 10. corepack ships with Node.
# If "corepack enable" answers EACCES because Node is installed system-wide, give it a directory
# of yours that is on PATH: corepack enable --install-directory "$HOME/.local/bin"
corepack enable && pnpm install --frozen-lockfile

bash scripts/gate.sh          # everything
bash scripts/gate.sh web      # TypeScript only: lint, typecheck, tests, build
bash scripts/gate.sh contract # Rust only: fmt, clippy, wasm build, unit and sandbox tests
```

The same script runs in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Exact versions and the commands used on testnet are in [`docs/toolchain.md`](docs/toolchain.md).

To run the web app against the deployed contract:

```bash
VITE_CONTRACT_ID=ticket-escrow-v2.testnet VITE_FAUCET_TOKENS=tusd.ticket-escrow-v2.testnet pnpm --filter @ticket-escrow/web dev
```

Without `VITE_CONTRACT_ID` it shows built-in demo data and says so in a banner.

## If the website is down

The contract does not need it. [`scripts/direct-calls.sh`](scripts/direct-calls.sh) plays the refund path with the NEAR CLI only: create an event, accept it, buy a ticket, let the deadline pass, expire it from an unrelated account and claim the refund.

```bash
# Four testnet accounts from the faucet, keys saved by the CLI
for name in organizer verifier buyer anyone; do
  near account create-account sponsor-by-faucet-service "<your-prefix>-$name.testnet" \
    autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
done

CONTRACT_ID=ticket-escrow-v2.testnet ORGANIZER_ID=<your-prefix>-organizer.testnet VERIFIER_ID=<your-prefix>-verifier.testnet \
  BUYER_ID=<your-prefix>-buyer.testnet ANYONE_ID=<your-prefix>-anyone.testnet bash scripts/direct-calls.sh
```

Reading needs no account at all:

```bash
near contract call-function as-read-only ticket-escrow-v2.testnet list_events json-args '{"from_index":0,"limit":10}' \
  network-config testnet now
```

## AI and third-party disclosure

- **AI.** The code, tests and documents were written with Claude Code (Anthropic) working as a small team of agents under Walter Guzmán's direction: one integrator session, one session per track, and a separate reviewer session before each merge. Every review finding was checked against the code before it was applied. No AI runs inside the product.
- **Contract.** `near-sdk` and `near-contract-standards` 5.30.1. Tests: `near-sandbox`, `near-api`, `cargo-near-build`, `tokio`, `testresult`.
- **Web and client.** React, Vite, `near-api-js`, `@hot-labs/near-connect`, Zod; for the entry pass, `@noble/curves` and `@noble/hashes` (strict Ed25519 and SHA-256) and `uqr` (the QR code). Tests: Vitest, Testing Library, jsdom. Lint and format: Biome.
- **Agent.** `@modelcontextprotocol/sdk`.
- **Services.** Public testnet RPC endpoints (FastNEAR, dRPC), the testnet faucet, the NearBlocks explorer for links.

Exact versions are pinned in `Cargo.lock` and `pnpm-lock.yaml`.

## License

[MIT](LICENSE).
