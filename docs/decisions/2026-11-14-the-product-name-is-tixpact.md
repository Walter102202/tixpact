# The product is called TixPact

Date: 2026-11-14. Author: Walter (recorded by the integrator). Status: accepted; the repository name part is replaced by `2026-11-14-the-repository-is-called-tixpact.md`.

## Context

The plan left the product name open and kept `TixPact` as a working value in one constant (`packages/client/src/brand.ts:2`). The hackathon submission asks for a project name, and it cannot be edited once sent.

## Decision

The product, and the project in the hackathon submission, are called **TixPact**. `APP_NAME` keeps its value, now as the final one.

Where a person reads the name, it is TixPact: the README title, the web's tab title (`web/index.html`), the agent's MCP server name `tixpact-agent` (`mcp/src/server.ts`) and its line on the landing, the `claude mcp add tixpact` examples in `docs/mcp.md`, and the descriptions in `docs/gas.md`, `fixtures/README.md` and `packages/client/package.json`.

Identifiers do not change: the crate `ticket-escrow`, the packages `@ticket-escrow/*`, the NEP-297 standard `ticket_escrow`, the testnet accounts, the repository name, the web's storage key and the demo pass seed stay as they are. Records stay as written: decision records, plans, proofs and the transcript in `docs/mcp.md` that printed `ticket-escrow-agent`.

## Alternatives considered

- **StageVow.** Leans toward shows only, and its pronunciation is less obvious in Spanish.
- **Pasefiel.** The most direct in Spanish, but its meaning does not carry into English.

## Consequences

Wallets still show the ticket collection as "Ticket escrow": that name is in the deployed contract (`nft_metadata`, `contract/src/tickets.rs:564`), and changing it means a new deploy, a new code hash and the proofs played again. It stays for the submission.

A later change of name is small in the code; the submitted name is not. No domain or trademark was checked: that comes first if the name is ever registered.
