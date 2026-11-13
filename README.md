# Ticket Escrow on NEAR

Event tickets whose price stays reserved in a NEAR contract until a verifier agreed in advance confirms the event took place. If the event is cancelled, or the deadline passes and nobody confirmed it, whoever holds the ticket takes the money back without needing the organizer, the ticketing site or us.

Built at NEAR HACKATHON 2026. It runs on **testnet**, it is **not audited**, and it must not hold real money.

**Status on 2026-11-13.** The contract named below is the development deployment. It still has one access key, and the proof page and `scripts/verify-deployment.mjs` say so. The final deployment, with zero keys, replaces it before the submission. Every contract call here was signed from scripts and the command line; the web app reads this contract, and signing from a browser wallet has not been walked through yet.

| | |
|---|---|
| Contract (testnet) | [`te-d4-escrow.testnet`](https://testnet.nearblocks.io/address/te-d4-escrow.testnet) |
| Hosted demo | Not published yet. Run it locally: [Try it](#try-it), step 1. |
| Every claim below, with its transaction | [`docs/proof.md`](docs/proof.md) |
| How it works and why | [`docs/design.md`](docs/design.md) |
| Every way to cheat we could think of | [`docs/threat-model.md`](docs/threat-model.md) |

## The problem

When you buy a ticket, the money goes to the seller, and a refund is a promise that depends on the seller still having it.

| What happened | Source |
|---|---|
| A ticketing company "relied on incoming funds from new ticket sales to cover its costs and debts". It was ordered to pay about $9 million to an estimated 45,000 organizers and buyers. | [Washington State Attorney General, 2021-03-08](https://atg.wa.gov/news/news-releases/ag-ferguson-brown-paper-tickets-will-fully-refund-event-organizers-ticket-buyers) |
| A festival's operator "owed more than $7 million to over 900 creditors" with "only $300,664 in the bank". | [ABC News, 2026-06-11](https://www.abc.net.au/news/2026-06-11/byron-bay-bluesfest-report-reveals-debt/106769938) |
| "Alrededor de 620 reclamos" (about 620 complaints) for one cancelled match remain unresolved, most of them for money not refunded; one of the producers "no fue encontrada" (could not be found). | [SERNAC, Chile's consumer agency, 2026-10-01](https://sernac.cl/portal/604/w3-article-89234.html) |

The law does not fill the gap by itself. When a UK ticketing company went under, the High Court found that "no trust is created in respect of the proceeds of ticket sales" ([[2024] EWHC 1554 (Ch)](https://caselaw.nationalarchives.gov.uk/ewhc/ch/2024/1554), paragraph 58; the claim there was the promoters'): ticket money sitting with an intermediary was the intermediary's money.

## How this solves it

| Problem | What the contract does | Test |
|---|---|---|
| The seller spends the ticket money before the event. | The price is reserved in the contract, per event. The organizer cannot receive anything until the verifier confirms the event. | `t01_purchase_reserves_exact_price`, `t03_organizer_cannot_withdraw_unresolved` |
| The organizer is insolvent, silent or gone, so nobody approves refunds. | A deadline is part of the terms. Once it passes without a confirmation, any account can switch the event to refunds, and each holder claims their own. | `t05_anyone_expires_after_deadline`, `t09_refund_pays_exact_principal` |
| The refund goes to whoever bought first, not to whoever holds the ticket now. | The ticket is an NFT (NEP-171) and the refund belongs to its current holder. Give the ticket away and the right goes with it. | `t07_refund_follows_the_holder` |
| "Trust us" hides who decides. | The verifier is a named account, shown before you pay, that accepted the exact terms. It can confirm only between the end of the event and the deadline. | `t02_purchase_needs_acceptance_and_capacity`, `t04_attestation_completes_event`, `t15_deadline_boundaries` |
| Someone with admin rights can change the rules later. | There is no owner, no admin method and no upgrade method. The final deployment has zero access keys. | `scripts/verify-deployment.mjs` |

## Try it

Each step says what to do and what you should see.

1. **Open the web app.** With Node 22 and pnpm:

   ```bash
   pnpm install --frozen-lockfile
   VITE_CONTRACT_ID=te-d4-escrow.testnet pnpm --filter @ticket-escrow/web dev
   ```

   Open `http://localhost:5173`. You should see the events read from the contract above ("Jazz night", "Opening night", "Direct calls"). Open one: the page shows the verifier's account, the deadline and where the money is. Open `/tickets/1-1`: the history shows the purchase by Ana, the transfer to Luis and the refund to Luis. Open `/proof`: the code hash, the access keys and the balance, read from the chain.
2. **Read the proof.** Open [`docs/proof.md`](docs/proof.md). Each row is one step of two stories played on testnet (an organizer who disappears; an event that is confirmed), with the transaction link and the observed result. Open any link in the explorer and compare.
3. **Check the deployment yourself.** With Node 22 and pnpm:

   ```bash
   pnpm install --frozen-lockfile && pnpm --filter @ticket-escrow/client build
   node scripts/verify-deployment.mjs te-d4-escrow.testnet --allow-keys
   ```

   You should see the code hash, `Access keys     1`, the balance next to the principal held, and a final line starting with `OK with --allow-keys`. The script signs nothing. Without `--allow-keys` it ends with `NOT VERIFIED` and exits non-zero while the account has any key; it also fails if the contract is a test build or holds less than it owes.
4. **Run every test.** On Linux, macOS or WSL (see [Setup](#setup)):

   ```bash
   bash scripts/gate.sh
   ```

   You should see the web checks, then the contract tests listed by name (`t01_purchase_reserves_exact_price ... ok`, and so on), then `== gate passed: all ==`. The contract tests start a local NEAR node, deploy the contract and move the clock past deadlines; the first run downloads the node and takes a few minutes.
5. **Use the contract without our website.** With the NEAR CLI and four testnet accounts ([details](#if-the-website-is-down)):

   ```bash
   CONTRACT_ID=te-d4-escrow.testnet ORGANIZER_ID=... VERIFIER_ID=... BUYER_ID=... ANYONE_ID=... \
     bash scripts/direct-calls.sh
   ```

   You should see seven numbered steps, each with a transaction link, ending in `claim_refund = true` and `Done`.
6. **Let an AI agent read the contract.** With Node 22 and pnpm:

   ```bash
   pnpm install --frozen-lockfile && pnpm build
   CONTRACT_ID=te-d4-escrow.testnet pnpm --filter @ticket-escrow/mcp smoke
   ```

   You should see `Tools (10): list_events, get_event, ...`, the events, the contract's code hash and balance next to what it owes, and `Smoke passed.` It runs without a key, so nothing is signed. To connect Claude Code, or to let the agent buy within a cap, see [`docs/mcp.md`](docs/mcp.md).

## Claims and where each is proven

Tests are sandbox tests in [`contract/tests/`](contract/tests/), one function per name; they run against a real local node, not a mock. "Proof" is the row in [`docs/proof.md`](docs/proof.md) with the testnet transaction.

| Claim | Test | Proof |
|---|---|---|
| A purchase reserves exactly the price; any other amount is rejected. | `t01_purchase_reserves_exact_price`, `t17_mint_keeps_the_deposit` | A3, A4 |
| No ticket is sold before the verifier accepted the exact terms, or beyond capacity. | `t02_purchase_needs_acceptance_and_capacity` | |
| The organizer cannot take the money of an unconfirmed event. | `t03_organizer_cannot_withdraw_unresolved` | A5 |
| Only the verifier confirms, and only between the end and the deadline. After that there are no refunds. | `t04_attestation_completes_event`, `t15_deadline_boundaries` | B5, B6 |
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
| The ticket is a standard NFT that wallets and explorers understand. | `t22_standard_token_surface` | |
| The whole flow works from the command line alone. | `scripts/direct-calls.sh` | |
| The deployed contract is not a test build, holds at least what it owes, and its access keys are counted from the chain (zero in the final deployment). | `scripts/verify-deployment.mjs` | |
| An agent cannot spend above its caps or call anything else. | `mcp/src/policy.test.ts`, `mcp/src/tools.test.ts` | [`docs/mcp.md`](docs/mcp.md#verification) |

## What NEAR does here

- **Named accounts with removable keys.** The verifier is an account name a buyer can read before paying. The contract account's keys are deleted at the end, after which nobody, including us, can change the code or move its balance.
- **Asynchronous payments handled as such.** On NEAR a transfer runs in a later block and can fail on its own. Every payment here debits the right first, records a pending operation, and settles it in a private callback: confirmed on success, restored on failure, never retried blindly.
- **The NFT standards (NEP-171, 177, 181).** The ticket's ownership record is the standard one, and it is the only one: the refund cannot follow a stale copy.
- **Storage staking.** State costs balance, so the organizer prepays a measured budget for the whole event and ticket money is never used for it.
- **Structured events (NEP-297).** Every step logs an event (`ticket_escrow` 1.0.0).
- **Low fees.** Each holder pays the fee of their own claim (measured per method in [`docs/gas.md`](docs/gas.md)), which is what makes "no operator, no batch payout" practical.
- **A sandbox that controls time and state.** The tests move the clock past deadlines, delete accounts in the middle of a payment and force a balance shortfall.

## An agent that buys and claims for you

[`mcp/`](mcp/) is a local MCP server: an AI agent with its own testnet account reads events and tickets, buys, gives tickets away, and claims refunds. Guide and real output: [`docs/mcp.md`](docs/mcp.md).

- **Caps checked before anything is signed.** A price cap per ticket and a cap on the money it has in tickets at one time. It can call one contract and four methods, and nothing else. `mcp/src/policy.test.ts`
- **It cannot do what the contract forbids.** It cannot confirm an event or claim a ticket it does not hold; the contract's rules apply to it as to anyone.
- **A watcher that never forgets a refund.** A loop that, after a deadline nobody met, switches the event to refunds and claims the agent's tickets. On testnet it did both in its first round after the deadline (transactions in [`docs/mcp.md`](docs/mcp.md#verification)).
- **The key stays on your machine.** The server runs locally over stdio; nothing is hosted.

The caps do not bound what the agent spends over time: fund its account only with what it may spend.

## What is real and what is simulated

| Real | Simulated |
|---|---|
| The contract, deployed on NEAR testnet, with the rules above enforced on chain. | The money: testnet NEAR from the faucet, worth nothing. |
| Every transaction in `docs/proof.md`; each can be opened in the explorer. | The people: organizer, verifier, Ana and Luis are accounts we created and played ourselves. |
| The tests: a real local node, real deployments, real failed transfers. | The verifier: a single account. A real one would be a venue, an auditor or a group with its own voting rules. |
| The web app and the agent, reading and writing that contract. | The time scale: demo events last minutes so a deadline can be watched. |

Nothing in the product is decided by an AI or by a server of ours. There is no backend: the web reads the chain through public RPC endpoints.

## Limits

1. **A verifier who lies is believed.** If the verifier confirms an event that did not happen, the organizer is paid. The contract fixes who decides and when, not whether they are right.
2. **A silent verifier means refunds**, even for an event that took place. The organizer bears that risk when choosing the verifier.
3. **A failed callback can leave one payment pending for good**, and a failed transfer resolver can leave one ticket locked for good. We chose a stuck payment over a double payment, and there is no admin to unstick either. The gas reserved for both keeps a measured margin ([`docs/gas.md`](docs/gas.md)), which a protocol change could still exceed.
4. **A lost key is a lost ticket.**
5. **The refund is the same amount of NEAR, not the same value** in any currency.
6. **The whole price is locked**, so an organizer cannot fund the event with ticket sales.
7. **Not audited, testnet only.** A bug cannot be patched: a new version is a new deployment. The build is not reproducible-verified: the deployed code hash is public, but another machine may not produce the same bytes from this source.
8. **Out of scope:** entry at the door, proof of attendance, paid resale, identity.

The full list is in the [threat model](docs/threat-model.md#limits).

## How it is built

```text
contract/          Rust contract (near-sdk 5.30.1): events, tickets, per-event ledger, settlement
contract/tests/    Sandbox tests t01...t24 against a local node
fixtures/          Hostile test contracts: a holder that deletes itself, a ticket receiver that misbehaves in several ways
packages/client/   TypeScript: typed views and calls, transaction tracking, the words shown to people
web/               React app (Vite): events, tickets, transfers, claims, an organizer and verifier desk, the proof page
mcp/               MCP server: an agent with its own account and a spending cap
scripts/           gate.sh (all checks), demo-scenario.mjs (writes docs/proof.md), direct-calls.sh, verify-deployment.mjs
docs/              design, threat model, proof, gas, the agent guide, toolchain, one file per decision
```

The contract's methods, JSON shapes and error codes are listed in the [frozen interface](docs/plans/2026-11-12-ticket-escrow-mvp-plan.md#frozen-interface-v1). Decisions taken while building are in [`docs/decisions/`](docs/decisions/README.md), one per file.

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

# Node 22 and pnpm 10
corepack enable && pnpm install --frozen-lockfile

bash scripts/gate.sh          # everything
bash scripts/gate.sh web      # TypeScript only: lint, typecheck, tests, build
bash scripts/gate.sh contract # Rust only: fmt, clippy, wasm build, unit and sandbox tests
```

The same script runs in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Exact versions and the commands used on testnet are in [`docs/toolchain.md`](docs/toolchain.md).

To run the web app against the deployed contract:

```bash
VITE_CONTRACT_ID=te-d4-escrow.testnet pnpm --filter @ticket-escrow/web dev
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

CONTRACT_ID=te-d4-escrow.testnet ORGANIZER_ID=<your-prefix>-organizer.testnet VERIFIER_ID=<your-prefix>-verifier.testnet \
  BUYER_ID=<your-prefix>-buyer.testnet ANYONE_ID=<your-prefix>-anyone.testnet bash scripts/direct-calls.sh
```

Reading needs no account at all:

```bash
near contract call-function as-read-only te-d4-escrow.testnet list_events json-args '{"from_index":0,"limit":10}' \
  network-config testnet now
```

## AI and third-party disclosure

- **AI.** The code, tests and documents were written with Claude Code (Anthropic) working as a small team of agents under Walter Guzmán's direction: one integrator session, one session per track, and a separate reviewer session before each merge. Every review finding was checked against the code before it was applied. No AI runs inside the product.
- **Contract.** `near-sdk` and `near-contract-standards` 5.30.1. Tests: `near-sandbox`, `near-api`, `cargo-near-build`, `tokio`, `testresult`.
- **Web and client.** React, Vite, `near-api-js`, `@hot-labs/near-connect`, Zod. Tests: Vitest, Testing Library, jsdom. Lint and format: Biome.
- **Agent.** `@modelcontextprotocol/sdk`.
- **Services.** Public testnet RPC endpoints (FastNEAR, dRPC), the testnet faucet, the NearBlocks explorer for links.

Exact versions are pinned in `Cargo.lock` and `pnpm-lock.yaml`.

## License

[MIT](LICENSE).
