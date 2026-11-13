import { format } from 'node:util';

// RPC URLs can carry an API key, so none of them leaves the server: not in a tool result the model
// reads, not in a watcher log line, not on stderr. Errors from the client (its timeout message) and
// from near-api-js (HTTP errors, and the failover provider's own console.error) quote the URL of
// the endpoint that failed; every message is passed through one function before it is emitted.

export type Redact = (text: string) => string;

const URL_PATTERN = /https?:\/\/[^\s"'<>()[\]{}`,]+/gi;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Replaces each URL on the host of an RPC endpoint, and each bare mention of that host, with
 * "RPC endpoint N" (its position in the list). Other URLs, such as explorer links, are kept.
 */
export function createRedactor(rpcUrls: readonly string[]): Redact {
  const hosts = new Map<string, number>();
  rpcUrls.forEach((url, index) => {
    const host = hostOf(url);
    if (host !== null && !hosts.has(host)) hosts.set(host, index + 1);
  });
  // Longest first, so a host that contains another is replaced whole.
  const bare = [...hosts.entries()].sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let out = text.replace(URL_PATTERN, (match) => {
      // Punctuation that ends the sentence is not part of the URL.
      const url = match.replace(/[.:;!?]+$/, '');
      const position = hosts.get(hostOf(url) ?? '');
      return position === undefined ? match : `RPC endpoint ${position}${match.slice(url.length)}`;
    });
    for (const [host, position] of bare) {
      out = out.replace(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => {
        return `RPC endpoint ${position}`;
      });
    }
    return out;
  };
}

/** Every string inside a JSON-like value, redacted. */
export function redactDeep<T>(value: T, redact: Redact): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]),
    ) as T;
  }
  return value;
}

/**
 * Routes console.error and console.warn (near-api-js's failover prints each failed endpoint's error
 * object with them) to one redacted line on stderr. Returns a function that restores them.
 */
export function quietConsole(
  redact: Redact,
  write: (line: string) => void = (line) => process.stderr.write(line),
): () => void {
  const { error, warn } = console;
  const oneLine = (...args: unknown[]) => {
    const first = format(...args).split('\n')[0] ?? '';
    write(`${redact(first)}\n`);
  };
  console.error = oneLine;
  console.warn = oneLine;
  return () => {
    console.error = error;
    console.warn = warn;
  };
}
