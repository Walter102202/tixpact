# The web uses a 60-line history router instead of a routing library

Date: 2026-11-12. Author: Track W. Status: accepted.

## Context

The web has seven routes (`/`, `/events/:id`, `/tickets`, `/tickets/:id`, `/organizer`, `/verify/:id`, `/proof`), each with at most one parameter, no nested layouts and no data loaders. The plan pins no router (plan, "Track W", revision note) and asks for few dependencies.

## Decision

`web/src/lib/router.tsx` holds `usePath` (a `useSyncExternalStore` over `popstate` and one custom event), `navigate`, `matchPath(pattern, path)` and `Link` (a plain `<a href>` that pushes history on a plain left click and leaves modified clicks to the browser). `App.tsx` matches the path in order and shows "There is no page at <path>." for anything else.

Paths are real (`/events/1`, not `#/events/1`), so a static host must serve `index.html` for every path. Whoever sets up hosting (Task I2) adds the rewrite: `vercel.json` `{"rewrites":[{"source":"/(.*)","destination":"/"}]}` or a Cloudflare Pages `_redirects` line `/* /index.html 200`.

## Alternatives considered

- `react-router` 7: about 60 kB more, a data-router API we would not use, and one more version to pin and audit.
- Hash routes: no host rewrite needed, but links read worse in the video and in the X post.

## Consequences

No route-level code splitting and no scroll restoration beyond "go to the top on navigate". Revisit if routes gain nested layouts or loaders.
