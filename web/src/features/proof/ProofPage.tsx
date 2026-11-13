import { type AccountProof, explorerAccountUrl } from '@ticket-escrow/client';
import { readAllPages } from '../../lib/pages';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { near } from '../events/eventCopy';

interface ProofData {
  proof: AccountProof;
  /** Sum of `principal_reserved` over every event, yoctoNEAR. */
  reserved: string;
  events: number;
}

export function keysText(count: number): string {
  if (count === 0) return '0 keys: nobody can change this contract';
  return `${count} ${count === 1 ? 'key' : 'keys'}: this deployment can still be changed`;
}

/**
 * What anyone can check without trusting this site: the deployed code, who can still change it,
 * what the account holds, and what it owes ticket holders, all read from the chain.
 */
export function ProofPage() {
  const { reader, contractId } = useServices();
  const load = useLoad('proof', async (): Promise<ProofData> => {
    const [proof, events] = await Promise.all([
      reader.getAccountProof(contractId),
      readAllPages((from, limit) => reader.listEvents(from, limit)),
    ]);
    const rows = await Promise.all(events.map((e) => reader.getAccounting(e.event_id)));
    const reserved = rows.reduce((sum, row) => sum + BigInt(row?.principal_reserved ?? '0'), 0n);
    return { proof, reserved: reserved.toString(), events: events.length };
  });

  return (
    <article className="page proof-page" aria-labelledby="proof-heading">
      <p className="eyebrow">Proof</p>
      <h1 id="proof-heading">Check the contract yourself</h1>
      <p className="lead">
        Everything below is read from NEAR testnet at final finality, not from this site.
      </p>
      <LoadState load={load} loadingText="Reading the contract account from the chain…">
        {(data) => <ProofFacts data={data} contractId={contractId} reload={load.reload} />}
      </LoadState>
    </article>
  );
}

function ProofFacts({
  data,
  contractId,
  reload,
}: {
  data: ProofData;
  contractId: string;
  reload: () => void;
}) {
  const { fixtureMode } = useServices();
  const { proof, reserved, events } = data;
  const covers = BigInt(proof.balance) >= BigInt(reserved);
  return (
    <section className="card proof-card" aria-label="What the chain says">
      <dl className="facts">
        <dt>Contract account</dt>
        <dd className="account-id">{contractId}</dd>
        <dt>Code hash</dt>
        <dd className="reference">{proof.codeHash}</dd>
        <dt>Access keys</dt>
        <dd>{keysText(proof.accessKeys)}</dd>
        <dt>Contract balance</dt>
        <dd>{near(proof.balance)}</dd>
        <dt>Reserved ticket principal</dt>
        <dd>
          {near(reserved)} across {events} {events === 1 ? 'event' : 'events'}
        </dd>
        <dt>Read at block</dt>
        <dd>{proof.blockHeight.toLocaleString('en-US')}</dd>
      </dl>
      <p className="proof-verdict">
        {covers
          ? 'The balance covers the reserved ticket principal.'
          : 'The balance is below the reserved ticket principal.'}
      </p>
      <p className="muted">
        The reserved principal is the ticket money not yet refunded or released to an organizer. The
        balance also pays for storage and holds what organizers have yet to collect.
      </p>
      <div className="proof-actions">
        {!fixtureMode && (
          <a href={explorerAccountUrl(contractId)} target="_blank" rel="noreferrer">
            Open the contract account in the explorer
          </a>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
          Read again
        </button>
      </div>
    </section>
  );
}
