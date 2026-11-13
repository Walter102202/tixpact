import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react';

// A minimal history router: a handful of fixed routes do not need a routing library.

const NAVIGATE = 'app:navigate';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

export function usePath(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/',
  );
}

export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE));
  if (!navigator.userAgent.includes('jsdom')) window.scrollTo(0, 0);
}

/** `matchPath('/events/:id', '/events/3')` is `{ id: '3' }`; null when it does not match. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.replace(/\/+$/, '').split('/');
  const have = path.replace(/\/+$/, '').split('/');
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of want.entries()) {
    const value = have[i] ?? '';
    if (part.startsWith(':')) {
      if (value === '') return null;
      const decoded = decodeSegment(value);
      if (decoded === null) return null;
      params[part.slice(1)] = decoded;
    } else if (part !== value) {
      return null;
    }
  }
  return params;
}

/** A typed-in address can hold a malformed escape; that is "no such page", not a crash. */
function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

type LinkProps = { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

export function Link({ to, onClick, ...props }: LinkProps) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || event.button !== 0 || modified || props.target) return;
    event.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={follow} {...props} />;
}
