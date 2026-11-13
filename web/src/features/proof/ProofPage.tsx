import { type AccountProof, explorerAccountUrl, type Unit } from '@ticket-escrow/client';
import { money, NEAR_UNIT, readConfigOnce } from '../../lib/money';
import { readAllPages } from '../../lib/pages';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { AccountLink } from '../../ui/AccountLink';
import { TEST_DOLLAR, useIsTestToken } from '../../ui/CurrencyFact';
import { LoadState } from '../../ui/LoadState';

/** What the contract holds in one token next to what it owes in it, in the token's smallest unit. */
interface TokenHolding {
  token: string;
  unit: Unit;
  /** The contract's balance at the token. */
  balance: string;
  reserved: string;
  available: string;
}

interface ProofData {
  proof: AccountProof;
  /** Sum of `principal_reserved` over every event priced in NEAR, yoctoNEAR. */
  reserved: string;
  /** Sum of `organizer_available` over every event priced in NEAR, yoctoNEAR. */
  available: string;
  /** One per token the contract accepts, in the contract's order. */
  tokens: TokenHolding[];
  events: number;
}

export function keysText(count: number): string {
  if (count === 0) return '0 keys: nobody can change this contract';
  return `${count} ${count === 1 ? 'key' : 'keys'}: this deployment can still be changed`;
}

/**
 * What anyone can check without trusting this site: the deployed code, who can still change it,
 * what the account holds, and what it owes ticket holders, all read from the chain. One event's
 * money is in one currency, so each currency is compared on its own: NEAR with the account's
 * balance, a token with the contract's balance at that token.
 */
export function ProofPage() {
  const { reader, contractId } = useServices();
  const load = useLoad('proof', async (): Promise<ProofData> => {
    const [proof, events] = await Promise.all([
      reader.getAccountProof(contractId),
      readAllPages((from, limit) => reader.listEvents(from, limit)),
    ]);
    const rows = await Promise.all(events.map((e) => reader.getAccounting(e.event_id)));
    const accountings = rows.filter((row) => row !== null);
    const sum = (currency: string | null, pick: (row: (typeof accountings)[number]) => string) =>
      accountings
        .filter((row) => row.currency === currency)
        .reduce((total, row) => total + BigInt(pick(row)), 0n)
        .toString();
    // Every token the contract accepts, even one no event is priced in yet.
    const listed = (await readConfigOnce(reader)).tokens;
    const tokens = await Promise.all(
      listed.map(async (spec) => ({
        token: spec.account_id,
        unit: { symbol: spec.symbol, decimals: spec.decimals },
        balance: await reader.tokenBalance(spec.account_id, contractId),
        reserved: sum(spec.account_id, (row) => row.principal_reserved),
        available: sum(spec.account_id, (row) => row.organizer_available),
      })),
    );
    return {
      proof,
      reserved: sum(null, (row) => row.principal_reserved),
      available: sum(null, (row) => row.organizer_available),
      tokens,
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
  const { proof, reserved, available, tokens, events } = data;
  // What the contract must still pay out of its balance (its own invariant: balance >= storage +
  // reserved + available). Amounts already being sent have left it.
  const covers = BigInt(proof.balance) >= BigInt(reserved) + BigInt(available);
  const near = (yocto: string) => money(yocto, NEAR_UNIT);
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
        {tokens.length > 0 && ' These NEAR amounts count only the events priced in NEAR.'}
      </p>
      {tokens.map((holding) => (
        <TokenFacts key={holding.token} holding={holding} />
      ))}
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

/** One token: the contract's balance at the token next to what it owes in that token. */
function TokenFacts({ holding }: { holding: TokenHolding }) {
  const { token, unit, balance, reserved, available } = holding;
  const covers = BigInt(balance) >= BigInt(reserved) + BigInt(available);
  const test = useIsTestToken(token);
  const headingId = `proof-${token}`;
  return (
    <section className="proof-token" aria-labelledby={headingId}>
      <h2 id={headingId} className="card-title">
        In {unit.symbol}
      </h2>
      <p className="muted">
        Events priced in {unit.symbol} keep their money at the token <AccountLink id={token} />
        {test && `, ${TEST_DOLLAR}`}.
      </p>
      <dl className="facts">
        <dt>{unit.symbol} balance of the contract</dt>
        <dd>{money(balance, unit)}</dd>
        <dt>{unit.symbol} reserved for ticket holders</dt>
        <dd>{money(reserved, unit)}</dd>
        <dt>{unit.symbol} waiting for organizers to collect</dt>
        <dd>{money(available, unit)}</dd>
      </dl>
      <p className="proof-verdict">
        {covers
          ? `The ${unit.symbol} balance covers both.`
          : `The ${unit.symbol} balance is below what the contract holds for others.`}
      </p>
    </section>
  );
}
