import { explorerAccountUrl } from '@ticket-escrow/client';
import { useServices } from '../services';

/**
 * An account id that links to the explorer on live data, so every claim on the page can be
 * checked without this site (threat model, Limit 7). Plain text on demo data, whose accounts are
 * not on chain.
 */
export function AccountLink({ id }: { id: string }) {
  const { fixtureMode } = useServices();
  if (fixtureMode) return <span className="account-id">{id}</span>;
  return (
    <a className="account-id" href={explorerAccountUrl(id)} target="_blank" rel="noreferrer">
      {id}
    </a>
  );
}
