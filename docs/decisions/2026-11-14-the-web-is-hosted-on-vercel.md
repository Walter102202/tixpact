# The web is hosted on Vercel at tixpact.vercel.app, deployed by hand from `main`

Date: 2026-11-14. Author: Walter (recorded by the integrator). Status: accepted.

## Context

The hackathon submission links to the app, and the web was not hosted anywhere: `vercel.json` existed, but no Vercel project used it.

## Decision

Vercel project `tixpact` (Walter's personal scope) serves https://tixpact.vercel.app. Its build is the root `vercel.json`: it bakes in `ticket-escrow-v2.testnet` and the faucet token `tusd.ticket-escrow-v2.testnet`. The project variable `ENABLE_EXPERIMENTAL_COREPACK=1` (production) makes Vercel install with the pinned `pnpm@10.30.1`.

The project is not connected to GitHub: a push to `main` publishes nothing. To publish, export `main` to a clean folder and deploy it from there:

```bash
git archive origin/main | tar -x -C <empty folder named tixpact>
cd <that folder> && vercel deploy --prod --yes
```

The first deployment (2026-11-14) was `main` at `d07679f`: the events and the proof page read the chain, with no console errors.

## Alternatives considered

- **Connect the project to GitHub.** It would publish on every merge to `main`, with no person approving that merge's deploy, on submission day.
- **Deploy from a working checkout.** It would upload files that are not committed.

## Consequences

The site shows what was last deployed, not what is on `main`; a fix merged to `main` needs a new deploy. Vercel warns that `engines.node` `>=22` will follow new major versions of Node.
