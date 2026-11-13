import { useCallback, useEffect, useRef, useState } from 'react';

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown };

export interface Load<T> {
  state: Loadable<T>;
  reload: () => void;
  /** Replace the data with a fresher read (after a transaction). */
  set: (data: T) => void;
}

/** Loads `load()` when `key` changes; never shows stale data while reloading after an error. */
export function useLoad<T>(key: string, load: () => Promise<T>): Load<T> {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: key and attempt are the reload triggers; load is read from a ref.
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    loadRef.current().then(
      (data) => current && setState({ status: 'ready', data }),
      (error: unknown) => current && setState({ status: 'error', error }),
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const set = useCallback((data: T) => setState({ status: 'ready', data }), []);
  return { state, reload, set };
}
