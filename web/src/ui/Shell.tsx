import { APP_NAME } from '@ticket-escrow/client';
import type { ReactNode } from 'react';
import { useWallet } from '../lib/near/useWallet';
import { Link } from '../lib/router';
import { useServices } from '../services';

const NAV: Array<{ to: string; label: string }> = [{ to: '/', label: 'Events' }];

export function Shell({ children }: { children: ReactNode }) {
  const { fixtureMode, network } = useServices();
  const { accountId, signIn, signOut } = useWallet();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="wordmark">
          {APP_NAME}
        </Link>
        <nav aria-label="Main" className="site-nav">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="site-account">
          <span className="network-badge">{network}</span>
          {accountId ? (
            <>
              <span className="account-id">{accountId}</span>
              <button type="button" className="btn btn-sm btn-secondary" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={signIn}>
              Sign in
            </button>
          )}
        </div>
      </header>
      {fixtureMode && (
        <p className="demo-banner">
          Demo data: nothing on this page is on chain. Set VITE_CONTRACT_ID to read the testnet
          contract.
        </p>
      )}
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <p>
          {APP_NAME} runs on NEAR {network}. No real money moves here.
        </p>
      </footer>
    </>
  );
}
