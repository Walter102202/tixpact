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
  /** Sum of `organizer_available` over every event, yoctoNEAR. */
  available: string;
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
    const sum = (pick: (row: NonNullable<(typeof rows)[number]>) => string) =>
      rows.reduce((total, row) => total + BigInt(row ? pick(row) : '0'), 0n).toString();
    return {
      proof,
      reserved: sum((row) => row.principal_reserved),
      available: sum((row) => row.organizer_available),
      events: events.length,
    };
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
  const { proof, reserved, available, events } = data;
  // What the contract must still pay out of its balance (its own invariant: balance >= storage +
  // reserved + available). Amounts already being sent have left it.
  const covers = BigInt(proof.balance) >= BigInt(reserved) + BigInt(available);
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
        <dt>Reserved for ticket holders</dt>
        <dd>{near(reserved)}</dd>
        <dt>Waiting for organizers to collect</dt>
        <dd>{near(available)}</dd>
        <dt>Events read</dt>
        <dd>{events}</dd>
        <dt>Read at block</dt>
        <dd>{proof.blockHeight.toLocaleString('en-US')}</dd>
      </dl>
      <p className="proof-verdict">
        {covers
          ? 'The balance covers both.'
          : 'The balance is below what the contract holds for others.'}
      </p>
      <p className="muted">
        The contract must be able to pay both out of its balance: the ticket money not yet refunded
        or released, and what confirmed events owe their organizers. Refunds and payouts already
        being sent have left it. The balance also pays for storage.
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
