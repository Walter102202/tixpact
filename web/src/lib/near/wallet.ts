import { type ContractCall, type RecordedTx, TX_FIXTURES } from '@ticket-escrow/client';

/** A transaction the wallet says it sent. The chain decides how it ended (`trackTransaction`). */
export interface SentTx {
  txHash: string;
  signerId: string;
}

/** What the screens need from a wallet. Methods are called directly inside click handlers. */
export interface WalletPort {
  getAccountId(): string | null;
  subscribe(listener: () => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Opens the wallet to sign and send one call to the contract. */
  send(call: ContractCall): Promise<SentTx>;
}

/** A wallet for fixture mode and tests: answers with recorded transactions, records every call. */
export interface FixtureWallet extends WalletPort {
  readonly sent: ContractCall[];
  /** How `send` answers; tests replace it. */
  answer: (call: ContractCall) => Promise<SentTx>;
  /** Demo only: act as another fixture account without a wallet. */
  signInAs(accountId: string): void;
}

export const FIXTURE_ACCOUNT = 'luis.testnet';
/** The fixture accounts a demo viewer can act as: two holders, the organizer, the verifier. */
export const DEMO_ACCOUNTS = ['luis.testnet', 'ana.testnet', 'org.testnet', 'teatro.testnet'];

export function isFixtureWallet(wallet: WalletPort): wallet is FixtureWallet {
  return 'signInAs' in wallet;
}

const RECORDED: Partial<Record<ContractCall['methodName'], RecordedTx>> = {
  buy_ticket: TX_FIXTURES.buySucceeded,
  claim_refund: TX_FIXTURES.refundSettled,
  nft_transfer: TX_FIXTURES.transferSucceeded,
  create_event: TX_FIXTURES.eventCreated,
  accept_verification: TX_FIXTURES.verificationAccepted,
  attest_completed: TX_FIXTURES.eventAttested,
  cancel_event: TX_FIXTURES.eventCancelled,
  claim_payout: TX_FIXTURES.payoutSettled,
};

export function createFixtureWallet(accountId: string | null = FIXTURE_ACCOUNT): FixtureWallet {
  let current = accountId;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const wallet: FixtureWallet = {
    sent: [],
    async answer(call) {
      const tx = RECORDED[call.methodName];
      if (!tx) throw new Error(`Demo mode has no recorded ${call.methodName} transaction.`);
      // Signed by whoever is signed in, as with a real wallet; the recording only lends its hash.
      return { txHash: tx.hash, signerId: current ?? tx.signerId };
    },
    getAccountId: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async signIn() {
      current = FIXTURE_ACCOUNT;
      notify();
    },
    async signOut() {
      current = null;
      notify();
    },
    signInAs(id) {
      current = id;
      notify();
    },
    async send(call) {
      if (current === null) throw new Error('Sign in first.');
      wallet.sent.push(call);
      return wallet.answer(call);
    },
  };
  return wallet;
}
