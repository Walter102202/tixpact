import type { ContractCall } from '@ticket-escrow/client';

// The one way the agent signs. The tools hand it a call the policy already allowed and judge the
// result by re-reading the transaction by hash (`trackTransaction`), never by what the send returned.

export interface AgentSigner {
  /** The account that signs and pays. */
  readonly accountId: string;
  /**
   * Signs one function call to `receiverId` and submits it. Resolves with the transaction hash once
   * the node accepted it. Rejects with `SendError` when it was not accepted.
   */
  signAndSend(receiverId: string, call: ContractCall): Promise<string>;
}

/** A transaction that was signed but not confirmed as accepted by the node. */
export class SendError extends Error {
  override name = 'SendError';

  /**
   * @param txHash The hash of the signed transaction, when it is known.
   * @param mayHaveLanded True when the node may still have received it (a timeout or a dropped
   *   connection); the tools then track the hash. False when the node refused it, so nothing ran.
   */
  constructor(
    message: string,
    readonly txHash: string | null,
    readonly mayHaveLanded: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
