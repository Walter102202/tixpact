# The wallet selector offers only Meteor and Intear, through an allow list on `availableWallets`

Date: 2026-11-13. Author: Track W. Status: accepted. Decided by the integrator (limit the selector to the two wallets the plan verified on testnet); this record says how.

## Context

On testnet, near-connect 0.12.0 lists six wallets from its manifest (version 1.1.0, read 2026-11-13): Meteor, Intear, Ledger, Nightly, Ethereum Wallets and NEAR CLI. The plan verified only Meteor and Intear. A judge who picks another wallet may reach a dead end.

near-connect offers only a deny list, `excludedWallets`. It never removes `hot-wallet` (the library deletes it from the set). It does not cover wallets a browser extension injects after load, nor wallets the manifest adds later.

## Decision

`limitWallets(connector, TESTNET_WALLETS)` (`web/src/lib/near/connector.ts`) redefines the instance's `availableWallets` getter. It returns the library's own result (network and feature filters included), narrowed to `meteor-wallet` and `intear-wallet`. The selector popup builds its list from that getter when it opens (`NearConnector.selectWallet`), so the limit covers manifest, injected and debug wallets alike.

Tests build the real `NearConnector` over an inline manifest:
- six testnet wallets give two;
- an injected wallet is dropped;
- the library's testnet filter still applies.

## Alternatives considered

- **`excludedWallets` with today's four other ids.** A wallet added to the manifest, or injected by an extension, would reappear.
- **Our own manifest (`manifest` option) filtered to the two wallets.** It means fetching and copying near-connect's manifest, executor URLs included, and it still lets injected wallets in.

## Consequences

- The override relies on a public getter of the pinned 0.12.0. If a version bump removes the getter, `limitWallets` throws at start instead of silently showing every wallet.
- An account already connected with another wallet stays connected. Only the selector is narrowed.
- No browser check was run on the live selector in this round: the session was limited to the allowed commands. The behaviour comes from the library source and the unit tests on the real class.
