# The product is called TixPact

Date: 2026-11-14. Author: Walter (recorded by the integrator). Status: accepted.

## Context

The plan left the product name open and kept `TixPact` as a working value in one constant (`packages/client/src/brand.ts:2`). The hackathon submission asks for a project name, and it cannot be edited once sent.

## Decision

The product, and the project in the hackathon submission, are called **TixPact**. `APP_NAME` keeps its value, now as the final one.

Identifiers do not change: the crate `ticket-escrow`, the packages `@ticket-escrow/*`, the NEP-297 standard `ticket_escrow`, the testnet accounts and the repository name stay as they are.

## Alternatives considered

- **StageVow.** Leans toward shows only, and its pronunciation is less obvious in Spanish.
- **Pasefiel.** The most direct in Spanish, but its meaning does not carry into English.

## Consequences

The name is written in one constant and one README sentence, so a later change is small in the code; the submitted name is not. No domain or trademark was checked: that comes first if the name is ever registered.
