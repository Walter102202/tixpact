import type { ReactNode } from 'react';
import type { Load } from '../lib/useLoad';

/** Renders the loading and error states of a read; `children` gets the data once it is there. */
export function LoadState<T>({
  load,
  loadingText,
  children,
}: {
  load: Load<T>;
  loadingText: string;
  children: (data: T) => ReactNode;
}) {
  const { state, reload } = load;
  if (state.status === 'loading') {
    return (
      <p className="load-state" role="status" aria-busy="true">
        {loadingText}
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="load-state load-error" role="alert">
        <p>Could not read the chain.</p>
        <p className="muted">Nothing below is shown until a fresh read succeeds.</p>
        <button type="button" className="btn btn-secondary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }
  return <>{children(state.data)}</>;
}
