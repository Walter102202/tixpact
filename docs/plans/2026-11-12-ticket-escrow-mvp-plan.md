# Ticket Escrow on NEAR — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. A session that owns one track uses superpowers:executing-plans for its tasks and follows "How to work on this plan" below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit to NEAR HACKATHON by Saturday 2026-11-14 17:00 America/Santiago (four hours before the 23:59 UTC deadline) a working testnet product: event tickets whose price stays reserved in a contract, with the refund owed to whoever holds the ticket, an organizer who is paid only after a pre-agreed verifier confirms the event, and a deadline after which anyone can switch the event to refunds.

**Architecture:** One Rust contract on NEAR testnet holds every rule and every yoctoNEAR (events, tickets as NEP-171 tokens, accounting, asynchronous settlement with a pending-operation record and private callbacks). A React web app and a local MCP server talk to it directly through a shared TypeScript client package; no backend, no indexer, no custody outside the contract. The final deployment has no access keys.

**Tech Stack:** Rust 1.95, `near-sdk` 5.30.1, `near-contract-standards` 5.30.1, `cargo-near` 0.23.0, `near-cli-rs` 0.31.1, sandbox integration tests (harness chosen by spike S1), WSL2 Ubuntu 24.04 for everything Rust. Node 22, pnpm 10, TypeScript 6.0.3, Vite 8.3.8, React 19.3.1, `@hot-labs/near-connect` 0.12.0, `near-api-js` 7.5.3, Zod 4, `@modelcontextprotocol/sdk` 1.32.2, Vitest 5, Biome 2, GitHub Actions.

**Spec:** `proyecto_entradas_near_diseno_y_fuentes.md` at the repository root (Spanish, v1.0, local only, never committed). Its decisions D01–D15 and tests T01–T24 are restated in English in this plan ("Frozen interface" and "Acceptance tests"), which is what the tracks build from. Deviations from the spec are listed in "Self-review notes".

## Global Constraints

- Deadline: submissions close 2026-11-14T23:59:00Z = 20:59 America/Santiago. Internal cutoff 17:00 Santiago. One submission, not editable afterwards.
- First judges are Claude Code and Codex: they check that the repository runs and does what the README says, then humans decide. Every claim in the README maps to a named test or a testnet transaction. Nothing is claimed that cannot be reproduced.
- Testnet only. Never mainnet, never real funds. Amounts are `u128` yoctoNEAR in the contract and decimal strings in JSON; no floating point touches money anywhere (TypeScript uses `bigint`).
- Wording: the product talks about a "ticket" and leads with the problem it solves. It also says plainly that each ticket is an NFT (NEP-171) wherever that helps the reader: the README, the ticket and proof pages, the X post and the video (the `nfts` track rewards exactly this). Never lead with the word or use it as the pitch.
- No AI and no off-chain service can confirm an event, change a holder or move reserved funds. The MCP agent only spends its own account, within its own caps.
- All committed text in English (code, comments, README, UI copy, docs). Walter's chat language is Spanish.
- Repository: GitHub `Walter102202/<name>` private until Saturday morning, then public with an MIT `LICENSE`. Every commit is pushed to its branch immediately. No force-push, nothing deleted (branches, worktrees, files, accounts, keys) without Walter's written OK in the chat.
- `.gitignore` from the first commit: `proyecto_entradas_near_diseno_y_fuentes.md`, `docs/hackathon/`, `.claude/settings.local.json`, `.claude/worktrees/`, `.env`, `.env.*` (except `.env.example`), `.playwright-mcp/`, `node_modules/`, `dist/`, `target/`, `coverage/`, `.data/`, `neardev/`. Keys live in the WSL legacy keychain (`~/.near-credentials`) or in `.env`, never in the repository or in a report.
- Names: the product name is not decided. Code is name-agnostic (crate `ticket-escrow`, packages `@ticket-escrow/*`, NEP-297 standard `ticket_escrow`). The display name comes from one constant, `APP_NAME` in `packages/client/src/brand.ts`, working value `TixPact`.
- Libraries, templates and AI assistance are listed in the README (hackathon rule Q-005).
- Limits (spec 11.5): capacity 1–100 per event, pages of at most 50, title and venue at most 120 bytes each, references at most 256 bytes, `memo` 256 and `msg` 1024 bytes, 16 history entries per ticket.

## Review Focus

Inputs the spec implies but no acceptance test names. Each line is pinned by a test in the owning task.

1. A transaction whose first receipt succeeds and a later one fails (a refund whose transfer or callback fails). Expected: the web never shows success; it reads every receipt outcome and shows the failed step. Test in Task W2.
2. Calls landing exactly on a boundary: buy or transfer at `now == starts_at_ms`, attest at `now == resolution_deadline_ms`. Expected: buy and transfer rejected with `ERR_TOO_LATE`, attest rejected, expire allowed. Tests in Task C1 (`t15_deadline_boundaries`).
3. `claim_refund` with too little gas for the callback. Expected: the call fails as a whole with `ERR_INSUFFICIENT_GAS`, no pending operation is left, a later claim with enough gas works. Test in Task C2.
4. Bad terms at creation: verifier equal to organizer, price `0`, capacity `0` or `101`, a start in the past, deposit below the quote. Expected: `ERR_INVALID_TERMS` (or `ERR_WRONG_DEPOSIT`), no event created, deposit returned by the protocol. Test in Task C1.
5. The agent is asked to buy a ticket above its cap. Expected: the MCP tool returns `denied` with the cap and the price in the message, and no transaction is signed. Test in Task M1.

---

## How to work on this plan

Written for a session (Claude Code, Codex or a human) that opens this repository with no other context.

### Before you start a track (preflight)

Run these in order. Every step has an expected result; if yours differs, stop and write what you saw in your report instead of improvising.

1. Read `docs/toolchain.md` (written at the end of Phase 0). It has the exact, verified commands for this machine: how Rust runs through WSL, where the cargo target directory lives, ports, how worktrees are created.
2. Create or enter your worktree and branch exactly as `docs/toolchain.md` says (`track/c`, `track/w`, `track/m`). Expected: `git status --short` prints nothing.
3. Run your track's check command (Track C: the contract gate; Tracks W and M: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test`). Expected: green, with at least the test counts your track's revision note gives. Fewer tests means a wrong checkout.
4. `git config user.name` prints `Walter102202`.
5. Your report lives at `C:\dev\near-project-reports\track-<letter>.md`, outside the repository. Create the folder if it does not exist.
6. Resume rule: the first unticked checkbox in your track is where you continue, at the start and after any restart.

### Read first, in this order

1. This plan: Global Constraints, Review Focus, this section, "Frozen interface", "Acceptance tests", then only your track.
2. `docs/toolchain.md` and `docs/threat-model.md`.
3. `docs/decisions/` — decisions already taken; do not reopen them without a new decision file.
4. The NEAR agent skills installed in the repository in Phase 0 (`near-smart-contracts` for Track C; `near-api-js` and `near-dapp` for W and M). They describe current idioms; this plan wins where they differ.

### The decision rule (applies to every session)

When something is unclear, do not stop to ask Walter. Ask yourself what a top 1% software engineer would do here, decide, and write the decision down in `docs/decisions/` (one short file: context, decision, alternatives considered, consequences). Ask Walter only when the answer needs his credentials, his money, or changes what the product is. A question that only needs judgment is yours to answer.

### Working conventions

- One task at a time, in the plan's order inside your track. Each task ends with its tests green, a commit, a push and its checkboxes ticked in this file (same commit).
- Tests first: write the failing test named in the task, see it fail, implement, see it pass. Keep the test names this plan gives: the README maps claims to them.
- Each track works in its own worktree on `track/<letter>`, pushed on every commit. Tracks never merge into `main`. The integrator merges with a merge commit after an independent review.
- Only the integrator edits the frozen interface in this plan, `packages/client` (after Task W0 is merged; Track W may still add exports, fixtures and tests there, never rename or remove one, and lists each addition in its report), root configuration files (`package.json`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`, `vitest.config.ts`, `.github/`, `rust-toolchain.toml`) and `README.md`. If you need a change there, write it under "Needs the integrator" in your report, work around it locally when you safely can, and continue.
- Library APIs are verified against the installed sources or type declarations, never recalled from memory. When you verify one, write the exact import and signature in your report under "Notes for the next task".
- Commits: Conventional Commits, present tense, one task per commit, ending with the line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` (or the model that wrote it). Never amend a pushed commit.
- Lint, typecheck and tests all run before every commit, not tests alone. A commit with green tests and a red typecheck is a broken commit.
- One port per session (`docs/toolchain.md` lists them). Stop every server or sandbox you started before you report.
- Shared strings and types have one copy, in `packages/client`. Never retype a contract name, error code or user-facing sentence that already lives there.
- Before you say a task is done, run its test command and paste the last lines in your report. Evidence before assertions.
- A step only a human can do (a wallet approval, an account, a credential): write the exact clicks or command in your report, set the status `WAITING FOR WALTER`, and continue with whatever does not depend on it.

### Bugs you find along the way

Fix them without asking.

- A bug in your track's code is fixed on your branch: failing test first, then the fix, then the affected suite. One commit per bug (`fix(scope): ...`). Report it with `file:line`, symptom, root cause and the test that pins it.
- A class of bug gets one sweep, not just the instance you saw.
- If the fix needs a file you may not touch, describe it under "Needs the integrator" and continue.
- Speed rule: fix what breaks a test, a wrong amount, a wrong holder or a scenario. Cosmetic or theoretical issues go to "Found, not fixed".
- Never delete, skip or weaken a test to make it pass. A test that protects the principal is never removed to ship a demo; if scope must shrink, the integrator shrinks it in this plan first.

### Integration checks (integrator only)

- Every track task is reviewed by a session that did not write it. Every finding is verified against the code (`file:line`) before it is applied.
- Before merging, the integrator re-runs the full gate on the branch, then on the merged tree.
- When an important problem persists after one fix, find the root cause instead of another round.
- A separate seam review runs at G3: one fresh session reads only the boundaries between tracks (contract JSON against the client schemas, client actions against contract methods and gas, error codes on both sides, the MCP tools against the client) and reports mismatches with `file:line`.
- When two tracks read a rule differently, the integrator rules once, writes the ruling with its cost if wrong in `docs/decisions/`, and corrects every plan line it touches.
- The integrator keeps `docs/hackathon/estado.md` (local only) current after every merge and before any long wait: where everything lives, what is done, a pending table (what, who, by when), how to resume from zero. A session restart must cost minutes, not the work.

### Known traps of this stack

Verified on 2026-11-12 against tagged sources or official docs unless marked UNTESTED. Phase 0 retests the UNTESTED ones and updates `docs/toolchain.md`.

- A plain `cargo build` of a `near-sdk` 5.27+ contract hits a `compile_error!`. Build with `cargo near build`. The sandbox does not run on Windows: every cargo and near command runs in WSL.
- Stale tutorials are everywhere. Dead: `#[near_bindgen]`, the `impl_non_fungible_token_*!` macros, `env::promise_result`, `UnorderedMap`, Wallet Selector, `near-api-js` `connect`/`keyStores`/`utils`, `rpc.testnet.near.org`. Current: `#[near(contract_state)]`, hand-written trait impls, `#[callback_result]`, `near_sdk::store::IterableMap`, NEAR Connect, `JsonRpcProvider`, `https://test.rpc.fastnear.com`.
- `Promise` is `#[must_use]`: return it or call `.detach()`.
- `near_sdk::store` collections write on drop: call `flush()` before reading `env::storage_usage()`.
- A native transfer fails only when the receiver is a named account that does not exist; implicit accounts are created on the fly and never fail. A failed transfer returns the funds in a later receipt, so the contract's balance is not yet whole when the callback runs.
- A failed callback is not retried and only its own state changes revert. Give callbacks static gas with `.with_unused_gas_weight(0)` and no work that can panic.
- The standard `nft_transfer_call` gives its resolver a fixed 5 Tgas and reverts with an unguarded internal transfer. Our resolver also clears a lock, so Track C copies that method and sets its own gas.
- `internal_mint` refunds everything above the storage cost to the caller. A ticket purchase must use `internal_mint_with_refund(id, owner, Some(metadata), None)` and emit `NftMint` itself.
- Contract accounts may receive a share of burnt gas as a reward, so the contract balance drifts upward between calls (UNTESTED on this protocol version). Assert balances with bounds; assert exact amounts through `get_accounting`.
- Sandbox `fast_forward(n)` moves the block timestamp about 0.31 s per block, not 1 s, and crossing an epoch costs real seconds (UNTESTED here). Tests read the block timestamp, use deadlines tens of seconds apart and never sleep on the wall clock.
- `near-api-js` 7 defaults to optimistic finality: pass `final` on every read. The wallet's returned outcome is not final proof: re-query the transaction by hash and scan every receipt.
- Wallets that work on testnet through NEAR Connect: Meteor and Intear. MyNearWallet is being shut down and HOT is not listed on testnet. Function-call access keys cannot attach a deposit, so every payable call needs the wallet.
- Local Windows Node is 22.18.0 and `near-api-js` asks for 22.22.2 or later; npm only warns. CI and WSL use current Node 22.
- Long shell heredocs break on Windows shells; write files with the editor tool. A stray `.playwright-mcp/` folder breaks lint if it is not ignored.
- Sandbox accounts created by patching state are not visible in final blocks at once, and `near-api` reads the signer's nonce from a final block: a transaction signed right after `sandbox.create_account` fails about one time in ten. Create test accounts only through `TestChain::accounts` (`contract/tests/common/mod.rs`), which waits. `near-sandbox` and `near-api` also use different versions of the account id type: parse the text once for each.
- Commands reach WSL through `scripts/wsl.sh` as plain words. A `$`, a quote or a pipe is lost on the way, and an absolute Linux path is rewritten by Git Bash unless the command starts with `MSYS_NO_PATHCONV=1` (`docs/toolchain.md`).

### Quality bar (checkable)

- Rust: `overflow-checks = true`, checked arithmetic on every amount, no `unwrap()` on user input, every panic message starts with a stable `ERR_` code, public methods documented, `cargo clippy -- -D warnings` clean.
- TypeScript `strict`, no `any` outside tests, every RPC response parsed with the Zod schema from `@ticket-escrow/client` before use.
- Idempotency and interleavings are tested, not assumed (double claim, transfer during a pending refund, callback failure).
- UI: every state exists (loading, empty, error, pending, success), keyboard reachable, labelled inputs, visible focus, 4.5:1 contrast, works at 375 px, no console errors. A pending or failed payment is never shown as money received.
- No dead code, no TODO without a decision file, dependencies pinned to exact versions.

### Definition of done for a task

1. The tests named in the task exist and pass; the track's check command is green.
2. Committed, pushed, checkboxes ticked.
3. Any decision taken has a file in `docs/decisions/` and a line in its `README.md`.
4. The report block below is appended to your report file and pasted in your final message.

### Reporting format (end of each task or session)

```text
Task: C2 - settlement
Status: done | WAITING FOR WALTER (exact step) | blocked (why) | partial (what is missing)
Tests: <command> -> <last lines of output>
Decisions: docs/decisions/<file>.md or none
Bugs fixed: <file:line, symptom, root cause, pinning test> or none
Found, not fixed: <evidence> or none
Needs the integrator: <changes outside your files> or none
Notes for the next task: <interfaces added or changed, exact imports and signatures you verified>
Friction: <anything you did by hand that the plan should have covered> or none
```

When the track's last task is done, end the file with the line `STATUS: DONE`.

### Never

- Commit keys, `.env`, the Spanish spec or `docs/hackathon/`.
- Touch mainnet, or sign anything that spends more than testnet NEAR.
- Delete an account, a key, a branch, a worktree or a file you did not create in this task.
- Post on X, submit to the hackathon, or make the repository public. Walter does those.
- Change a frozen name, type, error code or JSON shape without a decision file and a note to the integrator.
- Run `gh auth switch`. If `gh api user -q .login` does not print `Walter102202`, stop and say so.

---

## Workstreams and parallelism

```
Phase 0 (integrator, sequential)   P0.1 toolchain + spike S1 → P0.2 repo, hygiene, CI → P0.3 threat model + interface frozen
                                             │
Phase 1 (parallel)                           ├── Track C contract:  C1 rules → C2 settlement → C3 transfers → C4 storage, history, gas
                                             ├── Track W web:       W0 client package → W1 shell + buy → W2 tickets → W3 organizer + verifier → W4 proof
                                             └── Track M agent:     M1 policy + tools → M2 signer, watcher, docs      (starts when W0 is merged)
Integration (integrator, as tracks land)     I1 testnet deploy + scenario script → I2 README, proof, design docs → I3 hardening and final deploy
Submission (Walter + integrator)             S1 video → S2 X post → S3 submission
```

Calendar (America/Santiago). Gates are go/no-go points where the integrator applies the cut order below.

- Thu 11-12 night: Phase 0. Tracks C and W start as soon as it ends and run overnight.
- Fri 11-13 09:00 — **G1:** C1 and C2 green in the sandbox (rules, accounting, refunds, payouts, failure paths). W0 merged, W1 running on fixtures. Then: first testnet deploy (I1), Walter creates the Meteor testnet accounts, spike S3, Track M starts.
- Fri 11-13 14:00 — **G2:** C3 merged (transfers and locks). W2 and W3 against testnet.
- Fri 11-13 18:00 — **G3:** the full absent-organizer story works on testnet through the web with two wallets, and through the MCP smoke script.
- Fri 11-13 22:00 — **G4, feature freeze:** C4 merged, every track merged, `scripts/demo-scenario.mjs` has produced `docs/proof.md`. Decide the track list for the submission and what was cut. Video shot list ready.
- Sat 11-14 08:00–11:00: hardening (I3): judge rehearsal on a clean clone, fixes, final deployment, README final, repository public.
- Sat 11-14 11:00–14:30: video. 14:30–16:00: X post, submission payload. Submitted by 17:00.

Cut order when a gate is missed, first cut first. Money tests are never cut.

1. Verifier as a Sputnik DAO (stretch, script only).
2. Holder-only page signed with the wallet (stretch).
3. Reproducible build and on-chain source verification.
4. Track M and the `agents` track.
5. Organizer screen (events are then created by script).
6. `nft_transfer_call` (declared as a documented limitation; plain transfers stay).

Spikes (throwaway, results written to `docs/toolchain.md`), each with what it must prove:

- **S1 — Rust on this machine (Phase 0).** In WSL: install the toolchain, `cargo near new`, build, deploy to a sandbox, call a payable method with a deposit, read receipt outcomes and failures, `fast_forward` past a timestamp, read a balance. It must also prove: the build works from a Windows-created git worktree (otherwise tracks use full clones), the cold and warm build times with the cargo target directory on the Linux filesystem, and which harness we use (the `cargo near new` template's `near-sandbox` + `near-api`, or `near-workspaces` 0.24.0 if any of the listed operations is missing after 45 minutes).
- **S2 — failed transfer and failed callback (Track C, Task C2).** A recipient that no longer exists makes the transfer fail and the callback sees it; a build with the `fault-injection` feature makes the callback itself fail.
- **S3 — wallet signing (Fri morning, needs Walter's Meteor accounts).** From the web app on testnet: sign in, `buy_ticket` with a deposit, a 1-yocto call, popup closed by the user, and reading the outcome by transaction hash.
- **S4 — signer in Node (Track M, Task M2).** `near-api-js` 7.5.3 signs and sends a function call with a deposit from a key in the environment; the exact imports are read from the installed type declarations.

---

## Frozen interface (v1)

Shared by the contract, `packages/client`, the web and the MCP server. Only the integrator changes it.

### Rules

| Id | Rule | Spec |
|---|---|---|
| R1 | Each ticket records a fixed principal `P` = the price paid. Its current holder owns the right to the refund of exactly `P`. | D01 |
| R2 | An event is `Unresolved` until exactly one of: the accepted verifier attests completion with `ends_at_ms <= now < resolution_deadline_ms` → `Completed`; the organizer or the verifier cancels with `now < resolution_deadline_ms` → `Refundable`; anyone calls expire with `now >= resolution_deadline_ms` → `Refundable`. The outcome never changes again. | D02, D07 |
| R3 | The organizer cannot receive anything while the event is `Unresolved` or `Refundable`. | D02 |
| R4 | Tickets are sold only after the verifier accepted the exact terms, at exactly the price, while `now < starts_at_ms` and `sold < capacity`. | D02, D03 |
| R5 | Terms never change after creation. | D13 |
| R6 | A ticket can be transferred by its holder only while the event is `Unresolved`, `now < starts_at_ms` and the ticket has no pending operation. | D05 |
| R7 | Settlement reserves first: the right is debited and a pending operation recorded before the transfer is scheduled; a private callback confirms on success and restores on a confirmed failure; nothing is retried on a timer. | D06 |
| R8 | While a ticket has a pending refund or an unresolved `nft_transfer_call`, it cannot be transferred or refunded. | D05, D06 |
| R9 | The organizer prepays storage for the whole capacity at creation. Ticket money never pays for storage, and one event can never spend another event's principal. | D04 |
| R10 | The contract has no owner, no admin method, no upgrade method and no way to move principal outside R1–R8. The final deployment has zero access keys. | D08 |
| R11 | The event outcome and each payment's result are separate facts: `Completed` does not mean the organizer was paid; `Refundable` does not mean holders were refunded. | D14 |

Time: `now_ms = env::block_timestamp_ms()`. Every time field is Unix milliseconds. Terms must satisfy `now < starts_at_ms < ends_at_ms < resolution_deadline_ms`.

### Methods

```rust
#[init] pub fn new() -> Self;

// organizer
#[payable] pub fn create_event(&mut self, terms: EventTerms) -> u32;                       // deposit >= quote_event_budget(capacity)
#[payable] pub fn cancel_event(&mut self, event_id: u32, reason_ref: Option<String>);      // 1 yocto; organizer or verifier
#[payable] pub fn claim_payout(&mut self, event_id: u32) -> Promise;                       // 1 yocto; resolves to bool

// verifier
#[payable] pub fn accept_verification(&mut self, event_id: u32, terms_hash: String);       // 1 yocto; now < starts_at_ms
#[payable] pub fn attest_completed(&mut self, event_id: u32, evidence_ref: Option<String>); // 1 yocto

// buyer and holder
#[payable] pub fn buy_ticket(&mut self, event_id: u32) -> TokenId;                          // deposit == price exactly
#[payable] pub fn claim_refund(&mut self, token_id: TokenId) -> Promise;                    // 1 yocto; holder only; resolves to bool

// anyone
pub fn expire_event(&mut self, event_id: u32) -> Outcome;                                   // no deposit

// callbacks
#[private] pub fn on_refund_result(&mut self, operation_id: u64, #[callback_result] r: Result<(), PromiseError>) -> bool;
#[private] pub fn on_payout_result(&mut self, operation_id: u64, #[callback_result] r: Result<(), PromiseError>) -> bool;

// views
pub fn get_config(&self) -> Config;
pub fn quote_event_budget(&self, capacity: u32) -> U128;
pub fn get_event(&self, event_id: u32) -> Option<EventView>;
pub fn list_events(&self, from_index: u32, limit: u32) -> Vec<EventView>;
pub fn get_accounting(&self, event_id: u32) -> Option<AccountingView>;
pub fn get_ticket(&self, token_id: TokenId) -> Option<TicketView>;
pub fn list_tickets_for_owner(&self, account_id: AccountId, from_index: u32, limit: u32) -> Vec<TicketView>;
pub fn get_ticket_history(&self, token_id: TokenId) -> Option<TicketHistory>;
pub fn get_operation(&self, operation_id: u64) -> Option<OperationView>;
```

Plus the standard token surface: `nft_transfer`, `nft_transfer_call`, `nft_resolve_transfer` (private), `nft_token`, `nft_metadata`, `nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner`. Approvals are disabled: any `approval_id` other than `null` is rejected with `ERR_APPROVALS_DISABLED`.

Behaviour the signatures do not show:

- `create_event`: validates the terms and the deposit, stores the event with `verifier_accepted = false`, records the whole deposit as that event's operating budget. Event ids start at 1.
- `terms_hash`: lowercase hex SHA-256 of the Borsh encoding of `(organizer_id, verifier_id, title, venue, starts_at_ms, ends_at_ms, resolution_deadline_ms, price, capacity)`. Clients never recompute it; they echo `EventView.terms_hash`.
- `buy_ticket`: token id is `"<event_id>-<serial>"` with serial from 1 (`"3-17"`). The buyer is the first holder.
- `expire_event`: before the deadline it fails with `ERR_TOO_EARLY`; on an already resolved event it changes nothing and returns the outcome.
- `claim_refund`: if the event is still `Unresolved` and the deadline has passed, it expires the event first, then proceeds. It requires `prepaid_gas >= GAS_CLAIM_MIN` and the liquidity check below.
- `claim_payout`: sends the whole `organizer_available` to `organizer_id` in one transfer.
- `EventView.evidence_ref` is the reference given by whoever resolved the event: the `evidence_ref` of `attest_completed`, the `reason_ref` of `cancel_event`, `null` on expiry or when none was given (`docs/decisions/2026-11-12-cancel-reason-shares-evidence-ref.md`). Both are limited to `max_ref_bytes` (`ERR_LIMIT`).
- Paginated views (`list_events`, `list_tickets_for_owner`): `from_index` is a 0-based position, `list_events` is ordered by ascending `event_id`, `list_tickets_for_owner` follows the standard enumeration order (`nft_tokens_for_owner`), and each returns at most `min(limit, max_page)` items; they never panic on a large `limit` or an index past the end (empty list).
- `OperationView.token_id` is `null` for a `Payout`; `recipient_id` is then the organizer.
- Liquidity check before scheduling a transfer of `X`: `account_balance - X >= storage_usage * storage_byte_cost + total_held`, where `total_held` is the sum over all events of `principal_reserved + organizer_available` after this operation is reserved. Failing it rejects the call with `ERR_INSUFFICIENT_LIQUIDITY` and changes nothing.
- A callback never panics on an expected path. On `Ok` it settles; on `Err` it restores the right; in both cases it removes the pending operation and returns whether money moved.

### JSON shapes

Amounts are decimal strings of yoctoNEAR. Times and ids are JSON numbers. Optional fields are always present, `null` when empty. Enums are the strings shown.

```json
// EventTerms (input)
{ "title": "Jazz night", "venue": "Teatro Municipal", "starts_at_ms": 1794700000000, "ends_at_ms": 1794710800000,
  "resolution_deadline_ms": 1794883600000, "price": "1500000000000000000000000", "capacity": 50, "verifier_id": "teatro.testnet" }

// EventView
{ "event_id": 1, "organizer_id": "org.testnet", "verifier_id": "teatro.testnet", "verifier_accepted": true,
  "terms_hash": "9f2c…", "title": "Jazz night", "venue": "Teatro Municipal",
  "starts_at_ms": 1794700000000, "ends_at_ms": 1794710800000, "resolution_deadline_ms": 1794883600000,
  "price": "1500000000000000000000000", "capacity": 50, "sold": 3,
  "outcome": "Unresolved", "outcome_reason": null, "resolved_at_ms": null, "resolved_by": null, "evidence_ref": null,
  "created_at_ms": 1794600000000, "phase": "OnSale", "now_ms": 1794650000000 }

// TicketView
{ "token_id": "1-3", "event_id": 1, "serial": 3, "owner_id": "luis.testnet",
  "principal": "1500000000000000000000000", "status": "Active", "claim": "Reserved", "pending_operation_id": null }

// AccountingView
{ "event_id": 1, "principal_received": "4500000000000000000000000", "principal_reserved": "4500000000000000000000000",
  "refund_pending": "0", "refunds_settled": "0", "organizer_available": "0", "organizer_pending": "0",
  "organizer_settled": "0", "operating_budget": "700000000000000000000000" }

// OperationView (exists only while pending)
{ "operation_id": 7, "kind": "Refund", "event_id": 1, "token_id": "1-3", "recipient_id": "luis.testnet",
  "amount": "1500000000000000000000000", "started_at_ms": 1794900000000 }

// TicketHistory
{ "dropped": 0, "entries": [ { "kind": "Purchased", "account_id": "ana.testnet", "at_ms": 1794650000000 },
                             { "kind": "Transferred", "account_id": "luis.testnet", "at_ms": 1794660000000 } ] }

// Config
{ "version": "1.0.0", "max_capacity": 100, "max_page": 50, "max_title_bytes": 120, "max_venue_bytes": 120,
  "max_ref_bytes": 256, "max_memo_bytes": 256, "max_msg_bytes": 1024, "history_cap": 16,
  "storage_per_event": "…", "storage_per_ticket": "…", "fault_injection": false }
```

Enums:

- `outcome`: `Unresolved`, `Completed`, `Refundable`. `outcome_reason`: `Attested`, `Cancelled`, `Expired`.
- `phase` (derived from time, for display): `AwaitingVerifier`, `OnSale`, `SoldOut`, `InProgress`, `AwaitingAttestation`, `Expirable`, `Completed`, `Refundable`. An event never accepted by `starts_at_ms` shows `InProgress` onward like any other and simply has no tickets.
- Ticket `status` (stored): `Active`, `TransferPending`, `RefundPending`, `Refunded`.
- Ticket `claim` (derived): `Reserved` (event unresolved), `Refundable` (event refundable, status `Active`), `RefundPending`, `Refunded`, `ReleasedToOrganizer` (event completed).
- Operation `kind`: `Refund`, `Payout`. History `kind`: `Purchased`, `Transferred`, `TransferReturned`, `RefundRequested`, `RefundSettled`, `RefundFailed`. The history keeps the first entry and the latest fifteen; `dropped` counts the rest.

Accounting identity, true after every call and every callback:

```text
principal_received = principal_reserved + organizer_available + refund_pending + organizer_pending
                   + refunds_settled + organizer_settled
```

### Error codes

Every panic message starts with one of these, followed by `: ` and a sentence.

`ERR_NOT_FOUND`, `ERR_UNAUTHORIZED`, `ERR_ONE_YOCTO`, `ERR_WRONG_DEPOSIT`, `ERR_INVALID_TERMS`, `ERR_LIMIT`, `ERR_TERMS_MISMATCH`, `ERR_NOT_ACCEPTED`, `ERR_SOLD_OUT`, `ERR_TOO_EARLY`, `ERR_TOO_LATE`, `ERR_ALREADY_RESOLVED`, `ERR_NOT_REFUNDABLE`, `ERR_NOT_COMPLETED`, `ERR_TICKET_LOCKED`, `ERR_ALREADY_REFUNDED`, `ERR_NOTHING_TO_PAY`, `ERR_PAYOUT_PENDING`, `ERR_INSUFFICIENT_LIQUIDITY`, `ERR_INSUFFICIENT_GAS`, `ERR_APPROVALS_DISABLED`.

### Events (NEP-297)

Standard `ticket_escrow`, version `1.0.0`: `event_created`, `verification_accepted`, `ticket_purchased`, `event_resolved` (`outcome`, `reason`, `by`), `refund_requested`, `refund_settled`, `refund_failed`, `payout_requested`, `payout_settled`, `payout_failed`. Settlement events carry `operation_id`, `recipient_id` and `amount`. Token mint and transfer use the standard `nep171` events.

### Gas

Client side, one source in `packages/client/src/actions.ts`: `create_event` 30 Tgas, `accept_verification` 30, `buy_ticket` 50, `cancel_event` 30, `attest_completed` 30, `expire_event` 30, `claim_refund` 100, `claim_payout` 100, `nft_transfer` 30, `nft_transfer_call` 150. Contract side, initial values that Task C4 replaces with measured ones: callback static gas 15 Tgas, resolver static gas 20 Tgas, `GAS_CLAIM_MIN` 60 Tgas.

---

## Acceptance tests

Sandbox integration tests in `contract/tests/`, one function per name. The names are frozen: the README's claims table points at them. T20 and T23 are scripts owned by Track I.

| Name | Asserts | Task |
|---|---|---|
| `t01_purchase_reserves_exact_price` | Exact price: token minted to the buyer, `principal_reserved` up by `P`. Any other deposit: `ERR_WRONG_DEPOSIT`, no token, accounting unchanged. | C1 |
| `t02_purchase_needs_acceptance_and_capacity` | Not accepted: `ERR_NOT_ACCEPTED`. `accept_verification` with a hash that is not the event's `terms_hash`: `ERR_TERMS_MISMATCH`, still not accepted. Capacity reached: `ERR_SOLD_OUT`. `create_event` below the quote: `ERR_WRONG_DEPOSIT`. | C1 |
| `t03_organizer_cannot_withdraw_unresolved` | `claim_payout` before the end, and after the end without attestation: `ERR_NOT_COMPLETED`. Balance of the organizer unchanged apart from gas. | C2 |
| `t04_attestation_completes_event` | Verifier attests inside the window: outcome `Completed`, `organizer_available` equals all principal. Anyone else: `ERR_UNAUTHORIZED`. Added in C2: `claim_refund` then fails with `ERR_NOT_REFUNDABLE`. | C1, C2 |
| `t05_anyone_expires_after_deadline` | Nobody acts; after the deadline a third account calls `expire_event`: outcome `Refundable`, reason `Expired`. Added in C2: `claim_payout` then fails with `ERR_NOT_COMPLETED`. | C1, C2 |
| `t06_cancel_only_by_roles` | Organizer cancels before the start; verifier cancels during the wait; a third account: `ERR_UNAUTHORIZED`; after the deadline: `ERR_TOO_LATE`. | C1 |
| `t07_refund_follows_the_holder` | Ana buys, transfers to Luis, event cancelled: Ana's `claim_refund` fails with `ERR_UNAUTHORIZED`; Luis's succeeds for `P`. | C2 |
| `t08_no_double_refund` | Second claim while pending: `ERR_TICKET_LOCKED`. After settlement: `ERR_ALREADY_REFUNDED`. `refunds_settled` equals `P`, once. | C2 |
| `t09_refund_pays_exact_principal` | Luis's balance grows by `P` minus his own gas (bounded); `refund_pending` returns to 0; `refund_settled` event logged. | C2 |
| `t10_failed_transfer_restores_claim_once` | The holder is the `vanishing-holder` fixture, which claims and deletes itself in the same receipt: the transfer fails, the callback restores `principal_reserved`, status back to `Active`, `refund_failed` logged once. | C2 |
| `t11_failed_callback_keeps_pending` | With the `fault-injection` build the callback fails after a successful transfer: status stays `RefundPending`, a new claim fails with `ERR_TICKET_LOCKED`, no second transfer exists in the receipts. | C2 |
| `t12_transfer_call_receiver_outcomes` | Receiver fixture modes `keep`, `return`, `panic`, `garbage`, `oversized`, `reenter`: the final holder is right in each, the lock is cleared, and while unresolved a claim or transfer of that ticket fails with `ERR_TICKET_LOCKED`. | C3 |
| `t13_resolver_ignores_time_window` | The start passes between `nft_transfer_call` and its resolver: the resolver still completes and clears the lock. | C3 |
| `t14_callbacks_are_private` | Direct calls to `on_refund_result`, `on_payout_result`, `nft_resolve_transfer` from any account fail; nothing changes. | C2, C3 |
| `t15_deadline_boundaries` | Attest at exactly the deadline fails with `ERR_TOO_LATE`; expire one block earlier fails with `ERR_TOO_EARLY`; buy and transfer at exactly the start fail with `ERR_TOO_LATE`. | C1 |
| `t16_storage_stays_within_budget` | A full event with 64-character accounts, maximum texts, full histories and every ticket pending: contract storage cost never exceeds the operating budgets; empty owner indexes are removed. | C4 |
| `t17_mint_keeps_the_deposit` | After `buy_ticket` the buyer's balance fell by `P` plus gas (bounded): nothing was refunded by the mint helper. | C1 |
| `t18_payout_failure_paths` | Organizer deleted before the payout transfer: `organizer_available` restored once. Fault-injection build: `organizer_pending` stays, a second `claim_payout` fails with `ERR_PAYOUT_PENDING`. | C2 |
| `t19_events_do_not_share_money` | Event A completed and paid out, event B refundable: every B holder is still refunded in full; a payout of A cannot dip into B (`ERR_INSUFFICIENT_LIQUIDITY` in a forced shortfall built with `patch_state`). | C2 |
| `t21_false_attestation_is_a_trust_limit` | A verifier attests an event that did not happen: the contract applies it. The test documents the limit; the README states it. | C1 |
| `t22_standard_token_surface` | `nft_metadata`, `nft_token`, enumeration views and `nep171` mint and transfer events match the standard for a bought and a transferred ticket. | C3 |
| `t24_restored_claim_waits_for_liquidity` | After a failed transfer the right is restored at once, and a new claim works once the returned funds have arrived; it never uses another event's principal. | C2 |
| T20 (script) | With the web down, `scripts/direct-calls.sh` buys, expires and claims using only the CLI. | I2 |
| T23 (script) | `scripts/verify-deployment.mjs` prints the final account's code hash and an empty key list, and exits non-zero otherwise. | I3 |

---

## Phase 0 — integrator, tonight

Needs Walter's go for three things: installing the Rust toolchain in his WSL, creating the private GitHub repository, and a permission allowlist so background sessions are not stopped by prompts.

### Task P0.1: toolchain and spike S1

- [x] In WSL Ubuntu 24.04: rustup with Rust 1.95.0 and `wasm32-unknown-unknown`, `cargo-near` 0.23.0, `near-cli-rs` 0.31.1 (installers from the official release pages). Expected: `cargo near --version` and `near --version` print those versions. Done from verified archives instead of the installer scripts: `docs/decisions/2026-11-12-rust-toolchain-installed-from-verified-archives.md`.
- [x] Run spike S1 in a scratch folder. Record in `docs/toolchain.md`: the exact wrapper to run a command in WSL from the Windows shell, the `CARGO_TARGET_DIR` on the Linux filesystem per track, cold and warm build and test times, the harness chosen, whether worktrees or full clones are used for Rust, and the verified forms of `cargo near build`, `cargo near deploy`, account creation with the faucet (`save-to-legacy-keychain`) and key deletion. Deploy and faucet forms are read from the help text and first run in Task I1; key deletion is written down in Task I3 with Walter.
- [x] `npx skills add near/agent-skills` in the repository; record where the skills landed.

### Task P0.2: repository, hygiene, CI

- [x] `git init`, `.gitignore` as in Global Constraints, `LICENSE` (MIT), `.editorconfig`, `.gitattributes` (`* text=auto eol=lf`), `.nvmrc` (`22`), `biome.json`, `tsconfig.base.json` copied from `C:\dev\dealingwith-si` and trimmed. Verify `git status` shows neither the Spanish spec nor `docs/hackathon/`.
- [x] pnpm workspace with `packages/client`, `web`, `mcp` (empty packages with `lint`, `typecheck`, `test`, `build` scripts) and the `contract/` crate created by `cargo near new`, plus `fixtures/` for test-only contracts. `rust-toolchain.toml` pins 1.95.0. The crate was written from the template inside one cargo workspace: `docs/decisions/2026-11-12-one-cargo-workspace-and-the-template-harness.md`.
- [x] `scripts/gate.sh`: one command that builds the contract, runs the sandbox tests, then `pnpm install --frozen-lockfile`, lint, typecheck, test, build. This is the command the README gives to judges.
- [x] `.github/workflows/ci.yml` with three jobs, adapted from `C:\dev\dealingwith-si\.github\workflows\ci.yml`: `contract` (Rust 1.95, cargo-near, build, tests), `web` (frozen install, lint, typecheck, test, build), `hygiene` (no private file tracked, gitleaks over the whole history).
- [x] `docs/decisions/README.md` with the record format (Context, Decision, Alternatives considered, Consequences; one file per decision named `YYYY-MM-DD-slug.md`; append-only).
- [x] Private GitHub repository created, first commit pushed, CI green. `.claude/settings.local.json` (ignored) with the allow and deny lists used in `C:\dev\dealingwith-si`, extended with the WSL, cargo, near and pnpm commands.

### Task P0.3: threat model and interface, before any contract code

- [x] `docs/threat-model.md`: every way a previous holder, an organizer, a verifier, a receiver contract or a caller of a callback could keep or take money, each with the rule that stops it and the test that proves it (from spec section 12 and the rules above). The honest limits go in the same file: a lying verifier, a stuck callback, a lost key, an unaudited contract.
- [x] Commit this plan with the frozen interface. Fill each track's revision note (commit, test counts, worktree path, check command) and start Tracks C and W.

---

## Track C — contract (`contract/`, `fixtures/`)

**Revision note (2026-11-12, end of Phase 0).** Worktree `.claude/worktrees/c`, branch `track/c`, created from the `main` commit "chore: add the contract crate, the sandbox harness and the contract gate". Check command, from Git Bash in the worktree: `bash scripts/gate.sh contract` (it hops into WSL by itself). Expected on the scaffold: 1 unit test (`config_reports_the_frozen_limits`) and 2 sandbox tests (`deploys_and_reports_config`, `new_accounts_can_sign_at_once`) pass, then `== gate passed: contract ==`. First run in the worktree compiles for about 2 minutes; afterwards under 30 seconds plus your tests. Read `docs/toolchain.md`, section "Rust and the contract", before anything else: how commands reach WSL and its three traps, the cargo target directory (`~/.cache/ticket-escrow/<checkout>/target`), the sandbox harness and the facts it depends on. Already there to build on: the cargo workspace (`Cargo.toml`, `Cargo.lock`; members `contract` and `fixtures/*`), `contract/src/lib.rs` (constants, `Config`, `new`, `get_config`; split it into the modules below), `contract/tests/common/mod.rs` (`TestChain::start`, `accounts`, `deploy_escrow`, `escrow_wasm`; extend it, keep account creation going through `accounts`), `contract/tests/smoke.rs`, the `fault-injection` feature flag in `contract/Cargo.toml`. A new dependency or fixture crate changes `Cargo.lock`: commit it and say so in your report. You may also edit the root `Cargo.toml` only to add a shared dependency under `[workspace.dependencies]`. The plan's `contract/tests/common.rs` is `contract/tests/common/mod.rs`.

**Read first for this track:** the Frozen interface and Acceptance tests above; `docs/threat-model.md`; the `near-smart-contracts` skill; and, at the tag `near-sdk-v5.30.1`, `near-contract-standards/src/non_fungible_token/core/core_impl.rs` (mint helpers, `nft_transfer_call`, the resolver) and `examples/non-fungible-token`. Read them; never guess a name.

**Files you may touch, and nothing else:** `contract/**`, `fixtures/**`, `docs/decisions/` (new files and their index line), the Track C checkboxes in this plan. Never: `packages/`, `web/`, `mcp/`, root configuration, `README.md`.

**Decisions already taken (do not reopen):**

- One contract, one deployment, native NEAR, no fees, no owner. No per-event or per-ticket accounts and no global contracts.
- Module layout: `lib.rs` (state, init, public API surface), `events.rs` (terms, acceptance, outcome), `tickets.rs` (token traits, guards, locks, history), `settlement.rs` (operations, transfers, callbacks, liquidity check), `accounting.rs` (per-event ledger, `total_held`, storage budget), `views.rs` (view structs and methods), `errors.rs` (codes), `log.rs` (NEP-297 events).
- Ownership has one source of truth: the standard token storage. `Ticket` stores no owner.
- Holder-only `claim_refund` with 1 yocto, as the spec says. A trigger open to anyone is listed for after submission.
- No global cap on the number of events: each event prepays its own storage. Pagination bounds every view.
- The whole `create_event` deposit becomes the operating budget; nothing is sent back. The web sends exactly the quote.
- Unit tests cover pure logic and the callback branches with a mocked promise result; the sandbox tests above cover receipts, balances and time.
- The `fault-injection` cargo feature only lowers the callback static gas so the callback fails. `get_config().fault_injection` reports it. The released wasm is built without it and a test asserts that.

**Definition of done for the track:** C1–C4 committed and pushed on `track/c`; every acceptance test assigned to C passes; clippy clean; `get_config` reports measured storage constants; the gas table is in `docs/gas.md`; report ends with `STATUS: DONE`.

### Task C1: event rules and accounting

**Files:** create `contract/src/{lib,events,accounting,views,errors,log}.rs`, `contract/src/tickets.rs` (mint, token views, plain `nft_transfer` with the R6 guards; `nft_transfer_call` rejects with `ERR_LIMIT: not available yet` until C3); tests `contract/tests/{common,rules}.rs`.

**Interfaces.** Produces every method of the frozen interface except `claim_refund`, `claim_payout`, the two callbacks and `get_operation`; `quote_event_budget` uses provisional constants.

- [x] Write the failing tests `t01`, `t02`, `t04`, `t05`, `t06`, `t15`, `t17`, `t21` and the Review Focus 4 test `create_event_rejects_bad_terms` (verifier equal to organizer, price `0`, capacity `0` and `101`, start in the past, title of 121 bytes).
- [x] Run the contract check command. Expected: the new tests fail to compile or fail.
- [x] Implement. Notes the signatures do not decide: validate before any state change; `terms_hash` as defined above; `buy_ticket` mints with `internal_mint_with_refund(.., None)` and emits `NftMint`; the accounting identity is asserted by a `debug_assert!` helper called at the end of every state-changing method and checked in every test through `get_accounting`.
- [x] Run the check command. Expected: all listed tests pass.
- [x] Commit `feat(contract): event rules, purchases and per-event accounting`, tick, push.

### Task C2: settlement

**Files:** create `contract/src/settlement.rs`, `fixtures/vanishing-holder/` (a contract that can hold a ticket and has `claim_and_vanish(ticket_contract, token_id, beneficiary)`: it calls `claim_refund` with 1 yocto and deletes its own account in the same receipt); tests `contract/tests/settlement.rs`.

**Interfaces.** Consumes C1's ledger functions. Produces `claim_refund`, `claim_payout`, `on_refund_result`, `on_payout_result`, `get_operation`, the liquidity check, the `fault-injection` feature.

- [ ] Write the failing tests `t03`, `t07`, `t08`, `t09`, `t10`, `t11`, `t14` (callbacks), `t18`, `t19`, `t24`, the settlement assertions that `t04` and `t05` gain in this task, the Review Focus 3 test `claim_with_low_gas_fails_whole`, and unit tests of both callbacks for `Ok` and `Err` with a mocked promise result.
- [ ] Run. Expected: fail.
- [ ] Implement in this order inside each claim: checks, liquidity check, debit the ledger, record the operation, set the ticket status, emit `*_requested`, then `Promise::new(recipient).transfer(amount).then(Self::ext(current).with_static_gas(..).with_unused_gas_weight(0).on_*_result(operation_id))`. Spike S2 is the first thing this task proves; if the vanishing fixture is not deterministic, keep the unit tests as the proof of the failure branch, record a decision, and tell the integrator.
- [ ] Run. Expected: all listed tests pass, C1's tests still pass.
- [ ] Commit `feat(contract): refunds and payouts that reserve first and confirm in a callback`, tick, push.

### Task C3: ticket transfers between contracts

**Files:** modify `contract/src/tickets.rs`; create `fixtures/ticket-receiver/` (one contract whose `nft_on_transfer` behaves according to `msg`: `keep`, `return`, `panic`, `garbage`, `oversized`, `reenter` — the last tries `claim_refund` and `nft_transfer` on the ticket before returning); tests `contract/tests/transfers.rs`.

**Interfaces.** Produces `nft_transfer_call` and `nft_resolve_transfer` with the lock (status `TransferPending`), and the history entries `Transferred` and `TransferReturned`.

- [ ] Write the failing tests `t12`, `t13`, `t14` (resolver), `t22`.
- [ ] Run. Expected: fail.
- [ ] Implement: copy the standard `nft_transfer_call` body so the resolver gets our static gas; set the lock before the internal transfer; the resolver uses the unguarded internal transfer for the return path, treats a failed promise, invalid JSON or a result longer than 5 bytes as "return the ticket", and clears the lock on every path; `memo` and `msg` length limits enforced before any state change.
- [ ] Run. Expected: pass, earlier tests still pass.
- [ ] Commit `feat(contract): transfers to contracts with a per-ticket lock`, tick, push.

### Task C4: storage, history, gas

**Files:** modify `contract/src/accounting.rs`, `tickets.rs`, `views.rs`; create `docs/gas.md`; tests `contract/tests/storage.rs`.

- [ ] Write the failing tests `t16` and `history_keeps_first_and_latest` (after 20 transfers: 16 entries, the first is `Purchased`, `dropped` is 5).
- [ ] Run. Expected: fail.
- [ ] Implement: measure the worst-case bytes of an event and of a ticket (64-character accounts, maximum texts, full history, a pending operation) with `env::storage_usage()` deltas after `flush()`; set `storage_per_event` and `storage_per_ticket` from the measurements plus a 20% margin; measure the gas of every method and of both callbacks in the sandbox, set the contract-side gas constants to the measured maximum plus margin, and write the table in `docs/gas.md`. Report any client-side gas value that should change under "Needs the integrator".
- [ ] Run. Expected: the whole suite passes; `get_config` shows the measured constants and `fault_injection: false`.
- [ ] Commit `feat(contract): measured storage budget, bounded ticket history and gas table`, tick, push. End the report with `STATUS: DONE`.

---

## Track W — client package and web (`packages/client/`, `web/`)

**Revision note (2026-11-12, scaffold on `main`).** Worktree `.claude/worktrees/w`, branch `track/w`. Check command: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build`; expected on the scaffold: lint checks 23 files, 1 test file with 2 tests, the web build writes `web/dist`. Already pinned by the scaffold: `zod` 4.6.7 and `near-api-js` 7.5.3 in `packages/client`; React 19.3.1, Vite 8.3.8, `@vitejs/plugin-react` 6.3.0, `@hot-labs/near-connect` 0.12.0 and `util` 0.12.5 in `web`. `packages/client/src/{brand,index}.ts` and `web/src/{main,App}.tsx` are placeholders to build on. Testing Library and jsdom are not installed: add them pinned in Task W1. Remote: `origin`; push every commit (`docs/toolchain.md`).

**Read first for this track:** the Frozen interface; the `near-api-js` and `near-dapp` skills; the Vite React template of `create-near-app` (`templates/frontend/vite-react`, file `src/providers/near-provider.tsx`) for the wallet wiring; Walter's `landing-estilo-hosli` skill for the default look of the landing page, and `frontend-design`.

**Files you may touch, and nothing else:** `packages/client/**` (until Task W0 is merged; after that additions only: new exports, fixtures and tests, never a rename or removal, each listed in your report), `web/**`, `docs/decisions/`, the Track W checkboxes. Never: `contract/`, `fixtures/`, `mcp/`, root configuration, `README.md`.

**Decisions already taken (do not reopen):**

- No backend and no indexer. Every screen reads the contract through `@ticket-escrow/client` at `final` finality.
- Wallet: `@hot-labs/near-connect` 0.12.0 without the function-call-key plugin. Wallet methods are called directly inside click handlers (popup rules). Supported wallets: Meteor and Intear.
- RPC: `https://test.rpc.fastnear.com` first, `https://near-testnet.drpc.org` as fallback, through `FailoverRpcProvider`.
- After any transaction the UI is driven by the transaction outcome: it polls the status with receipts by hash, shows "Sending" until every non-refund receipt has run, shows the failed step if any receipt failed, then re-reads the contract.
- Fixture mode (`VITE_FIXTURES=1`): the same screens run on `packages/client` fixtures, which pass through the same Zod schemas as live responses. Tracks never depend on the contract being deployed.
- Plain CSS with design tokens, no component library. English only. State is always written, never colour alone.
- Words, with one meaning each: "Reserved", "Claimable", "Sending", "Refunded", "Awaiting confirmation". The promise, verbatim: "Your ticket keeps its price reserved. If the event is cancelled, or the deadline passes without the agreed confirmation, whoever holds the ticket can claim it." Attestation is shown as "Confirmed by <account>", never as a fact the chain verified.
- Buttons that move money name the amount and the destination: "Claim 1.5 NEAR to luis.testnet".
- Configuration: `VITE_NETWORK` (`testnet`), `VITE_CONTRACT_ID`, `VITE_RPC_URLS`, `VITE_FIXTURES`. Dev server on port 5173.

**Definition of done for the track:** W0–W4 committed and pushed on `track/w`; `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; every route works in fixture mode and, from G1 on, against testnet; report ends with `STATUS: DONE`.

### Task W0: `@ticket-escrow/client`

**Files:** create `packages/client/src/{schemas,reader,actions,tx,errors,format,fixtures,brand,index}.ts` and their `*.test.ts`.

**Interfaces.** Produces, for the web and the MCP server:

- `schemas.ts`: Zod schemas and inferred types for every JSON shape above (`EventView`, `TicketView`, `AccountingView`, `OperationView`, `TicketHistory`, `Config`, `EventTerms`), enums as string unions.
- `reader.ts`: `createReader({ contractId, rpcUrls }): Reader` with `getConfig()`, `quoteEventBudget(capacity)`, `getEvent(id)`, `listEvents(from, limit)`, `getAccounting(id)`, `getTicket(tokenId)`, `listTicketsForOwner(accountId, from, limit)`, `getTicketHistory(tokenId)`, `getOperation(id)`, `getAccountProof(accountId): Promise<{ balance: string; codeHash: string; accessKeys: number; blockHeight: number }>`. Every response is parsed; every read uses `final`.
- `actions.ts`: pure builders returning `{ methodName, args, deposit, gas }` (strings) for `createEvent`, `acceptVerification`, `buyTicket`, `cancelEvent`, `attestCompleted`, `expireEvent`, `claimRefund`, `claimPayout`, `transferTicket`, with the gas table above.
- `tx.ts`: `trackTransaction(rpc, txHash, signerId, onStage): Promise<{ ok: boolean; failedReceipt?: { receiptId: string; error: ContractError }; value?: unknown }>`, `explorerTxUrl(hash)`, `explorerAccountUrl(id)` (`https://testnet.nearblocks.io/txns/<hash>`, `/address/<id>`).
- `errors.ts`: `parseContractError(raw: unknown): { code: ErrorCode | 'UNKNOWN'; message: string }` with one plain-English sentence per code.
- `format.ts`: `formatNear(yocto: string, maxDecimals = 4): string` and `parseNear(text: string): string` with `bigint` only; `formatDateTime(ms, timeZone)`.
- `fixtures.ts`: one fixture set per phase and claim state, plus `createFixtureReader()` implementing `Reader`.

- [x] Write failing tests: schemas accept the plan's JSON examples and reject a number where an amount string is expected; `formatNear('1500000000000000000000000') === '1.5'`, `parseNear('1.5')` returns the same string, `parseNear('0.1') + parseNear('0.2')` as `bigint` equals `parseNear('0.3')`; `parseContractError` on `Smart contract panicked: ERR_TICKET_LOCKED: …` returns that code; every fixture passes its schema; `trackTransaction` on a recorded status with a failed callback receipt returns `ok: false` with that receipt.
- [x] Run `pnpm --filter @ticket-escrow/client test`. Expected: fail.
- [x] Implement, verifying each `near-api-js` name against the installed declarations (`JsonRpcProvider`, `FailoverRpcProvider`, `callFunction`, `viewAccount`, `viewAccessKeyList`, `viewTransactionStatusWithReceipts`).
- [x] Run. Expected: pass. Commit `feat(client): typed reader, action builders and transaction tracking`, tick, push, and tell the integrator: W0 is merged first so Track M can start.

### Task W1: shell, wallet, landing, event page with purchase

**Files:** `web/src/{main,App}.tsx`, `web/src/lib/near/{connector,useWallet,useTx}.ts`, `web/src/features/events/*`, `web/src/styles/*`, tests beside the code.

- [x] Failing tests (Testing Library, fixture mode): `/` lists the fixture events with price, verifier and phase; `/events/1` shows price, the reserved amount, "Confirmed by" account or "Awaiting verifier", start, end, deadline in the viewer's time zone with the UTC offset written out (`docs/decisions/2026-11-12-times-shown-in-the-viewers-zone.md`) and the promise text; the buy button reads "Buy for 1.5 NEAR" and is disabled with the reason outside `OnSale`; a rejected wallet popup leaves the page unchanged with a dismissible notice.
- [x] Implement the shell (header with account, network badge "testnet"), the wallet hook, the transaction hook built on `trackTransaction`, the two routes.
- [x] Run lint, typecheck, test, build. Expected: green. Commit `feat(web): event pages and ticket purchase`, tick, push.

### Task W2: my tickets, ticket page, transfer, refund

**Files:** `web/src/features/tickets/*`.

- [x] Failing tests: `/tickets` shows each ticket with holder, principal and claim word; `/tickets/1-3` shows the history list and the reserved amount; transfer form shows the full destination account and the sentence "You will lose the right to the refund", and is disabled after the start; the claim button reads "Claim 1.5 NEAR to <account>" only when `claim` is `Refundable`, or when `claim` is `Reserved` and the event's `phase` is `Expirable` (then the page also says "The deadline passed without confirmation"; `docs/decisions/2026-11-12-claim-shown-when-event-is-expirable.md`); Review Focus 1: with a recorded outcome whose callback receipt failed, the page shows "The payment did not complete" with the failed step and never "Refunded"; with `RefundPending` it shows "Sending" and no second button.
- [x] Implement. Run. Expected: green. Commit `feat(web): tickets, transfers and refund claims with honest pending states`, tick, push.

### Task W3: organizer and verifier

**Files:** `web/src/features/organizer/*`, `web/src/features/verify/*`.

- [x] Failing tests: `/organizer` form validates the terms client-side with the contract's limits, shows the storage budget from `quoteEventBudget`, and the three sentences the organizer must see (no payout before confirmation; no confirmation by the deadline means refunds; the budget is not ticket money); `/verify/1` shows the terms and enables "Accept", "Confirm the event took place" or "Declare cancelled" only for the verifier account and only in their windows, with the reason otherwise; organizer payout button "Collect 4.5 NEAR" only when `organizer_available` is above zero.
- [x] Implement. Run. Expected: green. Commit `feat(web): organizer and verifier flows`, tick, push.

### Task W4: proof page and state sweep

**Files:** `web/src/features/proof/*`.

- [x] Failing tests: `/proof` shows the contract account, code hash, number of access keys ("0 keys: nobody can change this contract" or "N keys: this deployment can still be changed"), contract balance, the sum of reserved principal from `get_accounting` over all events, the block height of the read, and links to the explorer; with the RPC failing it shows "Could not read the chain" and no stale numbers.
- [x] Implement, then sweep every route for loading, empty and error states, keyboard reach, focus, 375 px, and console errors.
- [x] Run. Expected: green. Commit `feat(web): proof page and complete states`, tick, push. End the report with `STATUS: DONE`.

---

## Track M — agent with its own capped account (`mcp/`)

Starts when W0 is on `main`. Enters the `agents` track of the hackathon only if G3 shows it working on testnet.

**Revision note (2026-11-13, W0 merged).** Worktree `.claude/worktrees/m`, branch `track/m`, created from the `main` commit "docs(plan): fill the Track M revision note". Check command: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build`; expected on that commit: lint checks 37 files, 8 test files with 72 tests pass (all in `packages/client`; `mcp` has none yet). `mcp/package.json` already pins `@modelcontextprotocol/sdk` 1.32.2, `near-api-js` 7.5.3, `zod` 4.6.7 and the workspace client; `mcp/src/index.ts` is an empty placeholder. What the client exports, with exact signatures, is listed in `C:\dev\near-project-reports\track-w.md` under "Notes for the next task" (two blocks: W0 and the W0 fix); use `createFixtureReader()` as the fake chain and `actions.*` for every call the agent builds. Never edit `packages/client`: write what you need under "Needs the integrator". Testnet: the agent's account is `te-d1-agent.testnet` (10 NEAR from the faucet; key in the WSL keychain file `~/.near-credentials/testnet/te-d1-agent.testnet.json`, never copied anywhere and never printed). Everything that touches testnet (spike S4, the smoke script with a key) waits until the integrator says the contract is deployed and gives its account id; until then build and test against the fixture reader and a recording signer.

**Read first for this track:** the Frozen interface; `packages/client/src`; `C:\dev\dealingwith-si\apps\backend\src\mcp\{server,tools,format}.ts` and `C:\dev\dealingwith-si\apps\backend\src\modules\policies\evaluate.ts` as the model for tool registration, the two-view results and ordered policy checks; `C:\dev\dealingwith-si\docs\mcp.md` as the model for the guide.

**Files you may touch, and nothing else:** `mcp/**`, `docs/mcp.md`, `docs/decisions/`, the Track M checkboxes.

**Decisions already taken (do not reopen):**

- A local stdio MCP server (`@modelcontextprotocol/sdk` 1.32.2, `McpServer`, `registerTool`). The agent's key stays on the user's machine; nothing is hosted.
- The agent has its own testnet account. The hard cap is that account's balance. On top, a policy from the environment: `MAX_PRICE_YOCTO` per ticket and `MAX_EXPOSURE_YOCTO` for the total principal of the tickets it holds, read from the chain each time. Only `CONTRACT_ID` may be called, and only `buy_ticket`, `nft_transfer`, `expire_event`, `claim_refund`.
- `evaluate(policy, state, intent)` is a pure function with ordered checks; the first failure wins; messages are verbatim and show the amounts.
- Without `AGENT_PRIVATE_KEY` the server runs read-only and the write tools return `denied: no key configured`.
- Every tool returns Markdown text and `structuredContent`; inputs and outputs are `z.strictObject` schemas.
- Tools: `list_events`, `get_event` (includes who confirms, the deadline and what triggers a refund), `get_ticket`, `list_my_tickets`, `get_wallet` (account, balance, caps, exposure), `verify_contract` (code hash, access keys, balance against reserved principal), `buy_ticket`, `transfer_ticket`, `expire_event`, `claim_refund`.
- Environment: `NEAR_NETWORK`, `CONTRACT_ID`, `RPC_URLS`, `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY`, `MAX_PRICE_YOCTO`, `MAX_EXPOSURE_YOCTO`.

**Definition of done for the track:** M1–M2 committed and pushed on `track/m`; lint, typecheck, test, build green; `pnpm --filter @ticket-escrow/mcp smoke` passes against testnet; `docs/mcp.md` written with the verification date; report ends with `STATUS: DONE`.

### Task M1: policy and tools on a fake chain

**Files:** `mcp/src/{server,tools,policy,format,config}.ts`, tests beside them.

- [ ] Failing tests: `evaluate` allows a purchase within both caps; denies with "Price 2 NEAR is above the per-ticket cap of 1.5 NEAR" (Review Focus 5); denies when exposure plus price exceeds the cap; denies a contract or method outside the allowlist. Through the SDK's in-memory transport pair with a fixture reader and a recording signer: `listTools` returns exactly the ten names; `get_event` text names the verifier and the deadline; `buy_ticket` above the cap returns `denied` and the signer recorded nothing; `buy_ticket` within the caps records one call equal to `actions.buyTicket(...)`; with no key every write tool is denied.
- [ ] Implement. Run. Expected: green. Commit `feat(mcp): capped agent tools over the ticket contract`, tick, push.

### Task M2: signer, watcher, guide

**Files:** `mcp/src/{signer,watch}.ts`, `mcp/scripts/smoke.mjs`, `docs/mcp.md`.

- [ ] Spike S4: read the installed `near-api-js` declarations for the account and signer classes, send one function call with a deposit on testnet, and record the imports in the report.
- [ ] Implement the signer behind the interface M1 used; `watch` (`pnpm --filter @ticket-escrow/mcp agent:watch`): every 30 s it reads the agent's tickets and, when one is claimable or its event is past the deadline, calls `expire_event` if needed and `claim_refund`, logging each transaction hash; it is a plain loop, described as such.
- [ ] `smoke.mjs`: lists the tools and calls `list_events` and `verify_contract` against `CONTRACT_ID`; with a key, buys one ticket within the caps and prints the transaction link.
- [ ] `docs/mcp.md`: what the server exposes, the caps and what enforces each, the `claude mcp add` command verified on the day, one example call and result per tool, limits.
- [ ] Run everything. Expected: green; smoke output pasted in the report with no key in it. Commit `feat(mcp): testnet signer, refund watcher and connection guide`, tick, push. End the report with `STATUS: DONE`.

---

## Track I — integration (integrator)

### Task I1: testnet deployment and the scenario script (after G1)

- [ ] Create a development contract account with the faucet, deploy the C1+C2 build, call `new`. Record the commands and the account in `docs/toolchain.md`.
- [ ] `scripts/demo-scenario.mjs`: with four keychain accounts (organizer, verifier, Ana, Luis) it creates an event with windows of a few minutes, accepts, Ana buys, transfers to Luis, the organizer tries to collect and is rejected, time passes, a fifth account expires the event, Ana's claim is rejected, Luis claims. It writes `docs/proof.md`: one row per step with the claim it proves, the transaction link and the observed result. A second run covers the completed path.
- [ ] Walter creates the Meteor testnet accounts; run spike S3 with him.

### Task I2: the documents a judge reads (by G4)

- [ ] `README.md`, written for a machine reader first: what it is in two sentences; the problem with three sourced facts; how each is solved; "Try it" as numbered "do X, see Y" steps (open the hosted demo; run `./scripts/gate.sh` and see the test names pass; run the read-only deployment check); the claims table (claim → test name → transaction in `docs/proof.md`); what NEAR does here, concretely; "What is real and what is simulated" (testnet funds, demo accounts played by us, a verifier that is one account, short demo windows); trust limits; architecture and interface; AI and third-party disclosure; license.
- [x] `docs/design.md`: the rules, state machines, accounting and decisions in English, derived from the spec without its market and naming sections.
- [ ] `scripts/direct-calls.sh` (T20) and a "If the website is down" section in the README.
- [ ] Hosted web on Vercel or Cloudflare Pages (Walter's account), kept up until 2026-11-25.

### Task I3: hardening and the final deployment (Saturday morning)

- [ ] Judge rehearsal, repository: two fresh sessions (Claude Code and Codex) each get only the repository on a clean Linux clone and this instruction: verify that it runs and that every README claim holds, then report what failed or could not be verified. Every finding is checked at `file:line`; real ones are fixed, test first.
- [ ] Judge rehearsal, product (the three-step pass used in `C:\dev\fitcheck-polish`): a fresh session walks the hosted demo as a first-time judge along a fixed path and reports a 30-second comprehension test, the eight worst friction points with exact replacement copy, and anything that reads as success when it is not; a second session fixes the accepted items test-first; a third verifies each item read-only.
- [ ] Fact check: every number, quote and link in the README, the X post and the video script is opened and confirmed against its source; anything unconfirmed is removed.
- [ ] `cargo near build reproducible-wasm` and `near contract verify` if Docker cooperates within one hour; otherwise the README states the build is not reproducible-verified.
- [ ] Final deployment to the account Walter names: deploy the released wasm, `new`, create the demo events, then delete every access key (Walter's explicit OK at that moment, it cannot be undone). `scripts/verify-deployment.mjs` (T23) prints zero keys and the code hash; both go in the README and the proof page.
- [ ] Full-history gitleaks pass, then Walter makes the repository public.

---

## Submission (Walter with the integrator)

- [ ] **S1 video.** Shot list by Friday night with the `hackathon-demo-video` skill: the problem in the first line, one complete action from a real click to a visible result (Ana buys, transfers to Luis, the organizer vanishes, Luis is refunded, Ana is not), what NEAR enables, the limits. Walter records the screen; the narrated cut is built as code.
- [ ] **S2 X post.** Draft by the integrator; Walter posts it. It leads with the user problem, says it was built at NEAR HACKATHON, tags `@NEARProtocol` and `#NEARHackathon`, attaches the video, links the demo and the repository.
- [ ] **S3 submission.** Walter decides every field (project name, lead name, email, team size, tracks, mainnet payout account, links, description, consent). The integrator prints the exact JSON payload and sends it only after Walter says yes. One attempt.

## What only Walter can do

Human-gated steps slipped in both earlier hackathon projects, so each one is asked for as early as it can be done, and nothing in Phase 1 waits for them (fixture mode and keychain accounts cover the gap).

- Go for Phase 0 (Rust in WSL, private repository, permission allowlist).
- As soon as possible, Friday 09:00 at the latest: four Meteor testnet accounts funded from the faucet (organizer, verifier, Ana, Luis); a Vercel or Cloudflare account for the hosted demo.
- By Saturday 10:00: the product name, the final contract account name, the mainnet account for the prize.
- Saturday: the OK to delete the final contract's keys, making the repository public, recording the video, the X post, the yes on the submission payload.

## Self-review notes

- Spec coverage: D01–D15 map to R1–R11 and the track decisions; T01–T24 map to the acceptance table (T20 and T23 as scripts). Spec section 15 (commercial validation) and 16 (names) are out of this plan by design.
- Deviations from the spec, each to be recorded in `docs/decisions/` during Phase 0: no global cap on events (spec 11.5 proposed 10); the storage budget is prepaid in full at creation, so "purchase without budget" becomes "creation below the quote" in T02; a bounded per-ticket history view is added (the hackathon track asks for it); an MCP agent track is added; user-facing text says "ticket" first and names the NFT standard where it helps.
- Researched and rejected on 2026-11-12: one account per event or per ticket through global contracts (publishing burns about 25 testnet NEAR per 250 KB and the idea is common among competitors); NEAR Intents payments (mainnet only, cannot call a contract with a deposit); meta-transactions and social login (not in the time available).
- UNTESTED items are named as such in "Known traps" and in the spikes; Phase 0 and the first task of each track resolve them before anything depends on them.
