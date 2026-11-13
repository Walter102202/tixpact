import { Component, type ReactNode } from 'react';

/**
 * A render error replaces the page body with one sentence and a reload button, instead of a
 * blank screen. Keyed by the path in `App`, so another route starts clean.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="page" role="alert">
        <h1>Something went wrong</h1>
        <p>This page hit an error and stopped.</p>
        <p className="muted">
          Nothing was sent. Reloading reads everything again from the contract.
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </section>
    );
  }
}
