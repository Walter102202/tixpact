import {
  actions,
  ERROR_MESSAGES,
  type ErrorCode,
  type PurchaseResult,
  purchaseResult,
  type TxResult,
  type Unit,
} from '@ticket-escrow/client';
import { type ReactNode, useEffect, useId } from 'react';
import { money, moneyExact } from '../../lib/money';
import { type Refresh, type TxControl, useTx } from '../../lib/near/useTx';
import { useWallet } from '../../lib/near/useWallet';
import { Link } from '../../lib/router';
import { useServices } from '../../services';
import { TxStatus } from '../../ui/TxStatus';
import { RegisterPanel } from '../tokens/RegisterPanel';
import { type TokenAccount, useTokenAccount } from '../tokens/useTokenAccount';
import type { EventData } from './EventPage';
import { buyBlockedReason } from './eventCopy';

/** What the test token's faucet mints per call, in whole units (`fixtures/test-token`, T1). */
const FAUCET_WHOLE_UNITS = 100n;

interface BuyProps {
  data: EventData;
  reread: () => Promise<EventData>;
  apply: (data: EventData) => void;
}

export function BuyPanel(props: BuyProps) {
  const currency = props.data.event.currency;
  return currency === null ? <NearBuy {...props} /> : <TokenBuy {...props} token={currency} />;
}

/** What a purchase changes; the view's clock (now_ms) moves on every block. */
const purchaseKey = (d: EventData) => [d.event.sold, d.accounting];

function NearBuy({ data, reread, apply }: BuyProps) {
  const { event, unit } = data;
  const { accountId, signIn } = useWallet();
  const tx = useTx();
  const reasonId = useId();
  const reason = buyBlockedReason(event);
  const label = `Buy for ${moneyExact(event.price, unit)}`;

  function buy() {
    void tx.run(actions.buyTicket(event.event_id, event.price), {
      before: data,
      read: reread,
      apply,
      key: purchaseKey,
    });
  }

  let control: ReactNode = null;
  if (tx.busy) {
    control = null;
  } else if (reason !== null) {
    control = <BlockedBuy label={label} reason={reason} reasonId={reasonId} />;
  } else if (accountId === null) {
    control = <SignInToBuy signIn={signIn} />;
  } else {
    control = (
      <>
        <button type="button" className="btn" onClick={buy}>
          {label}
        </button>
        <p className="muted">
          {moneyExact(event.price, unit)} goes to the contract, not to the organizer, and stays
          reserved for whoever holds the ticket.
        </p>
      </>
    );
  }

  return (
    <section className="buy-panel" aria-label="Buy a ticket">
      {control}
      <TxStatus
        tx={tx}
        failureTitle="The payment did not complete."
        failureNote="A rejected purchase returns the deposit to your account."
        success={(result, signerId) => (
          <Bought
            tokenId={typeof result.value === 'string' ? result.value : null}
            holder={signerId}
          />
        )}
      />
    </section>
  );
}

/**
 * A purchase in a token: the buyer's wallet calls `ft_transfer_call` on the token, which hands the
 * price to the contract. That transaction succeeds even when the contract refuses the purchase,
 * because the token then gives the money back, so the page decides from the receipts
 * (`purchaseResult`) and never from the transaction's own status.
 */
function TokenBuy({ data, reread, apply, token }: BuyProps & { token: string }) {
  const { event, unit } = data;
  const { contractId, faucets } = useServices();
  const { accountId, signIn } = useWallet();
  const { load: funds, refresh: fundsRefresh } = useTokenAccount(token, accountId, true);
  const tx = useTx();
  const registerTx = useTx();
  const faucetTx = useTx();
  const reasonId = useId();
  const busy = tx.busy || registerTx.busy || faucetTx.busy;
  const reason = buyBlockedReason(event);
  const price = moneyExact(event.price, unit);
  const label = `Buy for ${price}`;

  // A finished purchase moved the buyer's balance, or gave it back: read it again.
  const finished = tx.view.kind === 'done';
  const { reload } = funds;
  useEffect(() => {
    if (finished) reload();
  }, [finished, reload]);

  function buy() {
    void tx.run(actions.buyTicketWithToken(contractId, event), {
      before: data,
      read: reread,
      apply,
      key: purchaseKey,
    });
  }

  let control: ReactNode = null;
  if (busy) {
    control = null;
  } else if (reason !== null) {
    control = <BlockedBuy label={label} reason={reason} reasonId={reasonId} />;
  } else if (accountId === null) {
    control = <SignInToBuy signIn={signIn} />;
  } else if (funds.state.status === 'loading') {
    control = (
      <BlockedBuy
        label={label}
        reason={`Reading your ${unit.symbol} balance…`}
        reasonId={reasonId}
      />
    );
  } else if (funds.state.status === 'error' || funds.state.data === null) {
    control = (
      <>
        <BlockedBuy
          label={label}
          reason={`Could not read your ${unit.symbol} balance.`}
          reasonId={reasonId}
        />
        <button type="button" className="btn btn-sm btn-secondary" onClick={funds.reload}>
          Try again
        </button>
      </>
    );
  } else {
    const account = funds.state.data;
    const balance = BigInt(account.balance ?? '0');
    const short = balance < BigInt(event.price);
    let blocked: string | null = null;
    if (!account.registered) blocked = `Register with ${unit.symbol} first.`;
    else if (short) {
      blocked = `Your balance is ${moneyExact(balance.toString(), unit)}; the price is ${price}.`;
    }
    control = (
      <>
        {account.registered && (
          <p className="balance">Your balance: {money(balance.toString(), unit)}</p>
        )}
        {blocked === null ? (
          <>
            <button type="button" className="btn" onClick={buy}>
              {label}
            </button>
            <p className="muted">
              {price} goes to the contract, not to the organizer, and stays reserved for whoever
              holds the ticket.
            </p>
            <p className="muted">
              Your wallet shows a call to the token {token}: it moves the {unit.symbol} to the
              contract, and asks for 1 yoctoNEAR to confirm.
            </p>
          </>
        ) : (
          <BlockedBuy label={label} reason={blocked} reasonId={reasonId} />
        )}
        {!account.registered && (
          <RegisterPanel
            account={account}
            unit={unit}
            signer={accountId}
            why={
              <p>
                {accountId} is not registered with {unit.symbol} yet. The token keeps a balance only
                for accounts registered with it.
              </p>
            }
            tx={registerTx}
            refresh={fundsRefresh(account)}
          />
        )}
        {account.registered && short && faucets.includes(token) && (
          <Faucet account={account} unit={unit} tx={faucetTx} refresh={fundsRefresh(account)} />
        )}
        {account.registered && short && !faucets.includes(token) && (
          <p className="muted">
            Send at least {price} to {accountId} on the token {token}, then buy.
          </p>
        )}
      </>
    );
  }

  return (
    <section className="buy-panel" aria-label="Buy a ticket">
      {control}
      <TxStatus
        tx={tx}
        failureTitle="The purchase did not happen."
        failureBody={(result, signerId) => (
          <Refused
            result={result}
            purchase={purchaseResult(result, contractId)}
            buyer={signerId}
            price={price}
            unit={unit}
          />
        )}
        succeeded={(result) => purchaseResult(result, contractId).bought}
        success={(result, signerId) => {
          const purchase = purchaseResult(result, contractId);
          return <Bought tokenId={purchase.bought ? purchase.tokenId : null} holder={signerId} />;
        }}
      />
    </section>
  );
}

/**
 * Why a token purchase gave no ticket, and where the money is, each said only as far as the
 * receipts show it: the token refused the transfer (nothing moved), or the contract refused the
 * purchase and the token's resolver reports the whole price returned (its value is the amount
 * kept, `"0"`).
 */
function Refused({
  result,
  purchase,
  buyer,
  price,
  unit,
}: {
  result: TxResult;
  purchase: PurchaseResult;
  buyer: string;
  price: string;
  unit: Unit;
}) {
  const failed = result.failedReceipt;
  // The transaction, then its first receipt, run on the token: if either failed, nothing moved.
  if (failed?.step === 'transaction' || failed?.step === 'contract') {
    return (
      <>
        <p>
          {failed.step === 'transaction'
            ? 'The transaction was rejected before it ran.'
            : `The token ${failed.executorId} refused the transfer.`}
        </p>
        <p>{failed.error.message}</p>
        <p>
          No {unit.symbol} left {buyer}, and no ticket was bought.
        </p>
      </>
    );
  }
  const code = purchase.bought ? null : purchase.code;
  const known = code !== null && Object.hasOwn(ERROR_MESSAGES, code);
  return (
    <>
      {known ? (
        <p>The contract refused it: {ERROR_MESSAGES[code as ErrorCode]}</p>
      ) : (
        failed && <p>{failed.error.message}</p>
      )}
      {result.value === '0' ? (
        <p>
          No ticket was bought. The token gave the {price} back to {buyer}.
        </p>
      ) : (
        <p>
          No ticket was bought, and the token did not report the {price} as returned. Check the
          transaction and your {unit.symbol} balance before trying again.
        </p>
      )}
    </>
  );
}

/**
 * The test token's faucet: it mints `FAUCET_WHOLE_UNITS` whole units to a registered caller
 * (`fixtures/test-token`). Offered only for a token the deployment lists as having one.
 */
function Faucet({
  account,
  unit,
  tx,
  refresh,
}: {
  account: TokenAccount;
  unit: Unit;
  tx: TxControl;
  refresh: Refresh<TokenAccount | null>;
}) {
  const { fixtureMode } = useServices();
  const amount = moneyExact((FAUCET_WHOLE_UNITS * 10n ** BigInt(unit.decimals)).toString(), unit);
  const done = tx.view.kind === 'done' && tx.view.result.ok;
  return (
    <div className="faucet">
      {!tx.busy && !done && (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void tx.run(actions.faucet(account.token), refresh)}
          >
            Get {amount} from the test faucet
          </button>
          <p className="muted">
            Test money for testnet only. It sends {amount} to {account.accountId}.
          </p>
        </>
      )}
      <TxStatus
        tx={tx}
        failureTitle="The faucet did not send anything."
        success={() =>
          fixtureMode ? (
            <p>
              Demo: nothing was sent. Live, the faucet sends {amount} to {account.accountId}.
            </p>
          ) : (
            <p>
              The faucet sent {amount} to {account.accountId}.
            </p>
          )
        }
      />
    </div>
  );
}

function BlockedBuy({
  label,
  reason,
  reasonId,
}: {
  label: string;
  reason: string;
  reasonId: string;
}) {
  return (
    <>
      <button type="button" className="btn" disabled aria-describedby={reasonId}>
        {label}
      </button>
      <p id={reasonId} className="muted">
        {reason}
      </p>
    </>
  );
}

function SignInToBuy({ signIn }: { signIn: () => void }) {
  return (
    <>
      <button type="button" className="btn" onClick={signIn}>
        Sign in to buy
      </button>
      <p className="muted">Your wallet opens to sign in; buying is a second, separate step.</p>
    </>
  );
}

/** Names the account that signed, captured at the click, not whoever is signed in now. */
function Bought({ tokenId, holder }: { tokenId: string | null; holder: string }) {
  if (tokenId === null) return <p>The purchase went through.</p>;
  return (
    <>
      <p>
        {holder} holds ticket {tokenId}.
      </p>
      <Link to={`/tickets/${tokenId}`}>Open ticket {tokenId}</Link>
    </>
  );
}
