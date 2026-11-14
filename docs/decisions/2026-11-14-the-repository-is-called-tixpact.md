# The GitHub repository is called tixpact

Date: 2026-11-14. Author: Walter (recorded by the integrator). Status: accepted. Replaces the repository-name part of `2026-11-14-the-product-name-is-tixpact.md`.

## Context

The product is called TixPact, and the repository still carried the working name `Walter102202/ticket-escrow-near`. The repository is private, so no public link pointed at the old name.

## Decision

The repository is `Walter102202/tixpact` (renamed on 2026-11-14). `origin` points at `https://github.com/Walter102202/tixpact.git`.

`repository` in the root `Cargo.toml` keeps the old URL on purpose: it is the link the deployed contract carries in its NEP-330 metadata, and a build with another URL would no longer match the deployed code byte for byte. GitHub redirects the old URL, for the web and for git.

## Alternatives considered

- **Keep `ticket-escrow-near`.** It costs nothing, and it is the old name, shown wherever the repository is linked.
- **Also change `Cargo.toml`.** Every link would then show the new name, but a fresh build would no longer reproduce the deployed wasm.

## Consequences

No repository may ever be created as `Walter102202/ticket-escrow-near`: it would take over the old URL and break the redirect, including the link inside the deployed contract. The crate, packages, NEP-297 standard and testnet accounts keep `ticket-escrow`.
