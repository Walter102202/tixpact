import { type ContractCall, parseContractError } from '@ticket-escrow/client';
import {
  Account,
  baseEncode,
  FailoverRpcError,
  KeyPairSigner,
  type KeyPairString,
  actions as nearActions,
  type Provider,
} from 'near-api-js';
import {
  ActionExecutionError,
  InvalidNonceError,
  InvalidTransactionError,
  TransactionExecutionError,
  UnknownTransactionError,
} from 'near-api-js/rpc-errors';

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

export interface NearSignerOptions {
  accountId: string;
  /** Curve-prefixed secret key (`ed25519:...`). It stays inside the signer and is never logged. */
  secretKey: string;
  /**
   * Where nonces, blocks and transactions go: the `FailoverRpcProvider` from `createRpc`. The signer
   * calls `viewNodeStatus`, `viewAccessKey`, `viewBlock` and `sendTransactionUntil`.
   */
  provider: Provider;
  /** The chain the provider must report before every signature. Default `testnet`. */
  chainId?: string;
}

/** Fresh nonces tried when another process using the same key took the nonce first. */
const NONCE_ATTEMPTS = 3;

type SendVerdict = 'executed' | 'refused' | 'stale_nonce' | 'unknown';

/**
 * What a send error says about the transaction. The failover provider sends the same signed
 * transaction to every endpoint in turn, so its errors are judged together: one endpoint may time
 * out after receiving it, and the next then answers that its nonce is already used.
 */
function verdictOf(error: unknown): SendVerdict {
  const errors = error instanceof FailoverRpcError ? [...error.errors] : [error];
  const each = errors.map((e): SendVerdict => {
    if (e instanceof ActionExecutionError) return 'executed';
    if (e instanceof InvalidNonceError) return 'stale_nonce';
    if (e instanceof TransactionExecutionError || e instanceof InvalidTransactionError) {
      return 'refused';
    }
    return 'unknown';
  });
  if (each.includes('executed')) return 'executed';
  if (each.includes('unknown')) return 'unknown';
  if (each.every((v) => v === 'stale_nonce')) return 'stale_nonce';
  return 'refused';
}

function describe(error: unknown): string {
  const parsed = parseContractError(error);
  if (parsed.code !== 'UNKNOWN' || !parsed.message.startsWith('The transaction failed for')) {
    return parsed.message;
  }
  const first = error instanceof FailoverRpcError ? error.errors[0] : error;
  return first instanceof Error ? first.message : String(first);
}

/**
 * Signs with a key from the environment through near-api-js. Each call reads a fresh nonce, signs
 * locally (so the hash is known before anything is sent) and submits with `waitUntil: 'INCLUDED'`.
 * Before every signature it checks that the provider is on the expected chain.
 */
export function createNearSigner(options: NearSignerOptions): AgentSigner {
  const { accountId, provider } = options;
  const chainId = options.chainId ?? 'testnet';
  let keySigner: KeyPairSigner;
  try {
    keySigner = KeyPairSigner.fromSecretKey(options.secretKey as KeyPairString);
  } catch {
    // The library's message may quote part of the key; ours never does.
    throw new Error('AGENT_PRIVATE_KEY is not a valid secret key (the value is not shown).');
  }
  // Checked before every signature, not once: the provider fails over between endpoints, and one
  // read at startup says nothing about the endpoint that answers later.
  async function ensureChain(): Promise<void> {
    let reported: string;
    try {
      reported = (await provider.viewNodeStatus()).chain_id;
    } catch (error) {
      throw new SendError(
        `Could not read the chain id from the RPC, so nothing was signed: ${describe(error)}`,
        null,
        false,
        { cause: error },
      );
    }
    if (reported !== chainId) {
      throw new SendError(
        `The RPC reports chain ${reported}, not ${chainId}, so nothing was signed.`,
        null,
        false,
      );
    }
  }

  /** Whether the chain knows a transaction: only "unknown" on every endpoint that answered is no. */
  async function lookUp(txHash: string): Promise<'known' | 'unknown' | 'cannot_tell'> {
    try {
      await provider.viewTransactionStatus({ txHash, accountId, waitUntil: 'NONE' });
      return 'known';
    } catch (error) {
      const errors = error instanceof FailoverRpcError ? [...error.errors] : [error];
      const unknown =
        errors.length > 0 && errors.every((e) => e instanceof UnknownTransactionError);
      return unknown ? 'unknown' : 'cannot_tell';
    }
  }

  return {
    accountId,
    async signAndSend(receiverId, call) {
      await ensureChain();
      const action = nearActions.functionCall(
        call.methodName,
        call.args,
        BigInt(call.gas),
        BigInt(call.deposit),
      );
      const publicKey = await keySigner.getPublicKey();
      for (let attempt = 1; ; attempt += 1) {
        let txHash: string | null = null;
        try {
          // A new Account per attempt reads the nonce from the chain instead of a local cache, so
          // the MCP server and the watcher can share one key.
          const account = new Account(accountId, provider);
          const transaction = await account.createTransaction({
            receiverId,
            actions: [action],
            publicKey,
          });
          const signed = await keySigner.signTransaction(transaction);
          txHash = baseEncode(signed.txHash);
          await provider.sendTransactionUntil(signed.signedTransaction, 'INCLUDED');
          return txHash;
        } catch (error) {
          if (error instanceof SendError) throw error;
          if (txHash === null) {
            throw new SendError(`Nothing was sent: ${describe(error)}`, null, false, {
              cause: error,
            });
          }
          const verdict = verdictOf(error);
          if (verdict === 'executed') return txHash;
          if (verdict === 'stale_nonce') {
            // "Nonce already used" may mean this very transaction used it: an endpoint can include
            // it and still time out, and the failover then sends the same bytes to the next one.
            // Sign again only once the chain says it does not know this hash.
            const known = await lookUp(txHash);
            if (known === 'known') return txHash;
            if (known === 'cannot_tell') {
              throw new SendError(
                `${describe(error)} Whether this transaction landed could not be checked.`,
                txHash,
                true,
                { cause: error },
              );
            }
            if (attempt < NONCE_ATTEMPTS) continue;
          }
          throw new SendError(describe(error), txHash, verdict === 'unknown', { cause: error });
        }
      }
    },
  };
}
