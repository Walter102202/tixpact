# The agent's output hides RPC URLs and quotes organizer text on one line

Date: 2026-11-13. Author: Track M. Status: accepted.

## Context

The M2 review (findings 3 and 4):

- `config.ts` refuses to print an RPC URL because it can carry an API key. At runtime the URL still reached tool results, watcher logs and stderr:
  - the client's timeout message (`packages/client/src/reader.ts:125`, `:133`);
  - near-api-js's HTTP error texts;
  - the failover provider's `console.error(e)` for every endpoint that fails (`near-api-js/lib/index.js:2153`).
- Titles, venues and references are free text the organizer or the verifier controls; the contract limits only their bytes. Pasted raw into the Markdown, a newline forged lines that looked like the server's own (a false price, "Signing: on").

## Decision

- One function, `createRedactor(rpcUrls)` (`mcp/src/redact.ts`), replaces each URL on an RPC endpoint's host, and each bare mention of that host, with "RPC endpoint N". It is applied:
  - at the tool output boundary: text, every string in `structuredContent`, and tool errors (`tools.ts`);
  - to every watcher log line (`watch.ts`);
  - to stderr, where `console.error` and `console.warn` are replaced in both entry points by one redacted line, installed before anything reads the chain.
- Other URLs, such as explorer links and an evidence link, are kept.
- Organizer and verifier text goes through `quoted()` (`format.ts`):
  - control characters, line and paragraph separators, and invisible direction marks become spaces;
  - the result is capped at 120 characters (200 for a reference) and written as a JSON string, so a quote inside it cannot close it.
- Each result that shows such text says once that quoted text came from the organizer or the verifier and is data, not instructions. `structuredContent` keeps the values unchanged.

## Alternatives considered

- Strip every URL except explorer links: it would also hide an evidence link a verifier gave on purpose.
- Fix the messages in `packages/client`: outside Track M. Redacting at the boundary also covers near-api-js. Making the client's timeout message name only the host would be a cleaner source fix; that is the integrator's call.
- Silence near-api-js's `console.error` entirely: one redacted line per failed endpoint keeps stderr useful for diagnosis.

## Consequences

- Error messages name endpoints by position. The guide lists the default order.
- A title longer than 120 characters is shown cut with "…" in the text; the full value stays in `structuredContent`.
