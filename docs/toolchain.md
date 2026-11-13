# Toolchain

The exact, verified commands for building and testing this repository. Everything here was run on the development machine (Windows 11 with WSL2 Ubuntu 24.04) on the date shown in each section. A judge on Linux or macOS only needs "Run everything" from the README; this file is for people working on the code.

## TypeScript workspace (verified 2026-11-12)

- Node 22 (`.nvmrc`), pnpm 10.30.1 (`packageManager` in `package.json`). `near-api-js` asks for Node 22.22.2 or later; on Node 22.18.0 pnpm only warns.
- Packages: `packages/client` (`@ticket-escrow/client`), `web` (`@ticket-escrow/web`), `mcp` (`@ticket-escrow/mcp`). Every dependency is pinned to an exact version.
- Check command, from the repository root or from a worktree:

  ```bash
  pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
  ```

  Expected on the scaffold commit: lint checks 23 files with no fixes, typecheck is clean in three packages, 1 test file with 2 tests passes, the web build writes `web/dist`.
- `@ticket-escrow/client` is consumed as TypeScript source during development, typecheck and tests (the `development` export condition) and as `dist` in production builds. `pnpm build` builds packages in dependency order, so the client is built before the web.
- Adding a dependency changes `pnpm-lock.yaml`. Pin the exact version, and say so in your report so the integrator expects the lockfile change.

## Worktrees and branches

- The main checkout is `C:\dev\near-project` on `main`. Only the integrator commits there.
- Each track has a worktree inside the main checkout, on its own branch:

  | Track | Worktree | Branch |
  |---|---|---|
  | C (contract) | `.claude/worktrees/c` | `track/c` |
  | W (client and web) | `.claude/worktrees/w` | `track/w` |
  | M (agent) | `.claude/worktrees/m` | `track/m` |

  Created by the integrator with `git worktree add .claude/worktrees/<letter> -b track/<letter> main`, followed by `pnpm install --frozen-lockfile` inside it.
- Git commands run with Windows Git (Git Bash or PowerShell), never from inside WSL: a worktree's `.git` file holds a Windows path.
- Nothing is removed: no worktree, branch or stash is deleted without Walter's written OK.
- Remote: `origin` on GitHub (private until the submission). Every commit is pushed to its branch right away: `git push -u origin track/<letter>` the first time, `git push` afterwards. Never force-push.

## Ports

One port per session. Stop every server you start before you report.

| Who | Port | What |
|---|---|---|
| Track W | 5173 | `pnpm --filter @ticket-escrow/web dev` (strict port) |
| Integrator | 5174 | previews and rehearsals |
| Track M | none | the MCP server speaks over stdio |

## NEAR agent skills

Installed in Phase 0 with `npx skills add near/agent-skills --skill near-smart-contracts near-api-js near-dapp --agent claude-code --copy -y` and recorded in `skills-lock.json` (`npx skills experimental_install` restores them). They live in `.claude/skills/` of the main checkout, which is not committed. From a worktree, read them by absolute path: `C:\dev\near-project\.claude\skills\<name>\SKILL.md`. They describe current idioms; the plan wins where they differ.

## Rust and the contract (verified 2026-11-12, spike S1)

Versions, as printed in WSL Ubuntu 24.04: `rustc 1.95.0 (59807616e 2026-04-14)`, `cargo 1.95.0`, `cargo-near-near 0.23.0`, `near-cli-rs 0.31.1`, sandbox node `neard 2.14.1`. `rust-toolchain.toml` pins the Rust version, `rustfmt`, `clippy` and the `wasm32-unknown-unknown` target. `Cargo.lock` pins `near-sdk` and `near-contract-standards` 5.30.1, `near-sandbox` 0.4.1, `near-api` 0.8.7, `cargo-near-build` 0.11.5.

### One command

```bash
bash scripts/gate.sh contract
```

It runs, in order: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo near build non-reproducible-wasm --locked` (inside `contract/`), `cargo test --workspace --locked`. Expected on the scaffold commit: 1 unit test and 2 sandbox tests pass (`deploys_and_reports_config`, `new_accounts_can_sign_at_once`), then `== gate passed: contract ==`.

Measured on this machine: 4 min 20 s the first time in a new checkout (compiling 451 crates; 2 min of it was the one-time download of the sandbox node), 24 s afterwards for the whole gate including the TypeScript part. The wasm build alone: 23 s cold, 3 s warm. One sandbox test costs about 3 s (node start, account creation, deploy).

### On Windows everything Rust runs inside WSL

The sandbox node has no Windows build. From Git Bash, in the main checkout or in a worktree:

```bash
bash scripts/gate.sh contract                     # the gate hops into WSL by itself
bash scripts/wsl.sh cargo test -p ticket-escrow   # any other command
bash scripts/wsl.sh cargo fmt --all
```

`scripts/wsl.sh` enters WSL in the same folder and runs `scripts/in-wsl.sh`, which loads cargo and sets the cargo target directory to `~/.cache/ticket-escrow/<checkout path>/target` on the Linux filesystem (one per checkout, so the main checkout and a worktree never fight over a lock). The built wasm is at `<target>/near/ticket_escrow/ticket_escrow.wasm`. On Linux or macOS skip the wrapper and run the commands directly.

Three traps, all seen on 2026-11-12:

- Keep the arguments plain words. A `$`, a quote, a pipe or `&&` is expanded by a shell on the way in and arrives empty or broken. Put anything like that in a script file and run the file.
- An argument that is an absolute Linux path (`/mnt/c/...`, `/home/...`) is rewritten by Git Bash into a Windows path. Use paths relative to the repository, or prefix the whole command: `MSYS_NO_PATHCONV=1 bash scripts/wsl.sh bash /mnt/c/.../script.sh`.
- Git runs on Windows only (Git Bash or PowerShell). Inside WSL a worktree's `.git` points to a Windows path, and WSL has no git identity. `cargo near build non-reproducible-wasm` does not need git.

### Sandbox tests

Harness: `near-sandbox` + `near-api`, the one `cargo near new` generates (`docs/decisions/2026-11-12-one-cargo-workspace-and-the-template-harness.md`). Shared helpers live in `contract/tests/common/mod.rs`; each test file starts with `mod common;`.

```rust
let chain = TestChain::start().await?;                        // sandbox, network, signer
let contract = chain.deploy_escrow().await?;                   // escrow.sandbox, 50 NEAR, `new`
let people = chain.accounts(&["ana.sandbox", "luis.sandbox"], 10).await?;
contract.call_function("buy_ticket", json!({ "event_id": 1 }))
    .transaction().deposit(NearToken::from_near(1)).gas(NearGas::from_tgas(50))
    .with_signer(people[0].0.clone(), chain.signer.clone())
    .send_to(&chain.network).await?.assert_success();          // or .assert_failure()
let view: Value = contract.call_function("get_event", json!({ "event_id": 1 }))
    .read_only().fetch_from(&chain.network).await?.data;
let balance = people[0].tokens().near_balance().fetch_from(&chain.network).await?.total;
chain.sandbox.fast_forward(200).await?;
```

Verified facts the code depends on:

- Every sandbox account is created with the genesis key, so `chain.signer` signs for all of them.
- **Create accounts only through `TestChain::accounts`.** `sandbox.create_account(..)` patches state, and the new account reaches final blocks a moment later. `near-api` reads the signer's nonce from a final block (`near-api-0.8.7/src/signer/mod.rs:555`), so a transaction signed right after the patch fails about one time in ten with `Failed to fetch nonce`. The helper waits until the account is visible in a final block. After the fix: 12 runs out of 12 pass.
- `near-sandbox` and `near-api` depend on different versions of the account id type (3.0.0 and 2.6.0): parse the text once for each (`id.parse()?`), never pass one where the other is expected.
- Views (`read_only()`) and balances read the optimistic head, which already includes a transaction that `send_to` returned from.
- `escrow_wasm()` builds the contract once per test binary with `cargo_near_build::build_with_cli(Default::default())`, which builds the crate in the current directory; cargo runs each test binary from its crate folder. To build a fixture or a feature variant, pass `BuildOpts` with `manifest_path` and `features` (read the struct in `~/.cargo/registry/src/*/cargo-near-build-0.11.5/src/types/near/build/input/`).
- The sandbox node is downloaded once per target directory (94 MB). If `~/.cache/ticket-escrow/near-sandbox-2.14.1` exists, `scripts/in-wsl.sh` points `NEAR_SANDBOX_BIN_PATH` at it and nothing is downloaded. It exists on this machine.
- Each test starts its own node on its own ports and stops it when `TestChain` is dropped. After a run that was killed, check that no `near-sandbox` process is left.
- `fast_forward(200)` moved the block time past a 60-second deadline in the template's test. Read the block time in tests instead of assuming a rate.

### CLI forms on testnet (run on 2026-11-12 unless marked)

```text
# build, from contract/ (the gate runs it)
cargo near build non-reproducible-wasm --locked

# a new account with 10 testnet NEAR; the key goes to ~/.near-credentials/testnet/<account>.json
near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create

# deploy and initialize in one transaction
near contract deploy <account> use-file <wasm> with-init-call new json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send

# a view
near contract call-function as-read-only <contract> get_config json-args '{}' network-config testnet now

# a change call (NOT RUN YET: assembled from the help text; Task I2 runs it for scripts/direct-calls.sh)
near contract call-function as-transaction <contract> <method> json-args '<json>' prepaid-gas '<n> Tgas' attached-deposit '<amount>' sign-as <account> network-config testnet sign-with-legacy-keychain send
```

Development accounts created with the faucet on 2026-11-12 (keys only in the WSL keychain of the development machine): `te-d1-escrow.testnet` (holds the Phase 0 scaffold, deployed to prove the commands; the real development deployment goes to a fresh account), `te-d1-organizer.testnet`, `te-d1-verifier.testnet`, `te-d1-ana.testnet`, `te-d1-luis.testnet`, `te-d1-anyone.testnet`, `te-d1-agent.testnet`.

The scripts that need those keys run inside WSL, where Node 22.22.0 is installed (`/usr/bin/node`): `node scripts/demo-scenario.mjs` reads the keychain itself. Deleting the final contract's keys (Task I3) is done with Walter present and is written down then.
