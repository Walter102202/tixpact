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

## Rust and the contract

Added by the integrator when spike S1 ends (plan, Task P0.1). Track C does not start before this section exists.
