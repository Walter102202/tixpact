# Web test pins, the `process` replacement and the wallet-error wording

Date: 2026-11-12. Author: Track W. Status: accepted.

## Context

Four things Task W1 had to settle that the plan leaves open.

1. jsdom 30 requires Node 22.22.2 or later; this machine runs Node 22.18.0 (`node --version`), so its tests would not start.
2. In the browser the first load threw `ReferenceError: process is not defined`: `near-api-js` pulls in the `util` 0.12.5 polyfill, which reads `process.env.NODE_DEBUG` and `process.*Deprecation` when it loads. Tests passed because jsdom runs on Node.
3. The look (`landing-estilo-hosli`) uses IBM Plex Serif and Sans, which no system has.
4. When the wallet throws, the page cannot tell a rejected popup from a wallet that failed after broadcasting the transaction.

## Decision

1. `jsdom` 29.1.1, `@testing-library/react` 16.3.3 and `@testing-library/dom` 10.4.2, pinned exactly in `web/package.json`.
2. `web/vite.config.ts` replaces those four reads with `false` at build time (`define`). No global `process` object is added.
3. IBM Plex is loaded from Google Fonts in `web/index.html`, with system serif and sans fallbacks in `web/src/styles/tokens.css`.
4. The notice says "The wallet returned no transaction." and "If you did approve it, reload this page before trying again." When the wallet's error carries a contract error code, it says "The wallet reported a failed transaction:" and that code's sentence.

## Alternatives considered

- `happy-dom` instead of jsdom: a second DOM implementation to learn for no gain on this suite.
- `vite-plugin-node-polyfills`: a global `process` and more bundle, to fix four property reads.
- Self-hosted font files: about 200 kB in the repository; worth it only if the hosted demo must work without Google.
- "The wallet did not send a transaction.": false when a wallet throws after broadcasting, and a user who believes it may click Buy again and pay twice.

## Consequences

Moving to jsdom 30 needs Node 22.22.2. A future dependency that reads another `process` field fails loudly in the browser console, not in tests; the W4 sweep checks the console on every route. Without network access to Google the page falls back to system fonts.
