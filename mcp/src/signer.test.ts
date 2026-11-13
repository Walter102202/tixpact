import { createHash } from 'node:crypto';
import { actions, nep413Hash, parseNear, passRequest } from '@ticket-escrow/client';
import {
  baseEncode,
  FailoverRpcError,
  KeyPair,
  type Provider,
  type SignedTransaction,
} from 'near-api-js';
import {
  ActionExecutionError,
  InvalidNonceError,
  NotEnoughBalanceError,
  TransactionTimeoutError,
  UnknownTransactionError,
} from 'near-api-js/rpc-errors';
import { describe, expect, it } from 'vitest';
import { createNearSigner, SendError } from './signer.js';

// A key made for this test run; it controls no account.
const KEY = KeyPair.fromRandom('ed25519');
const SECRET = KEY.toString();
const AGENT = 'agent.testnet';
const CONTRACT = 'ticket-escrow.testnet';
const BLOCK_HASH = baseEncode(new Uint8Array(32).fill(7));

type Send = (tx: SignedTransaction, count: number) => Promise<unknown>;
/** Answers a status-by-hash lookup; the default is a chain that never saw the transaction. */
type Lookup = (txHash: string) => Promise<unknown>;

/** A provider with one access key whose nonce moves forward when the chain says it was used. */
function fakeChain(
  options: { chainId?: string; send?: Send; lookup?: Lookup; status?: () => Promise<unknown> } = {},
) {
  const sent: SignedTransaction[] = [];
  const lookedUp: string[] = [];
  let nonce = 41n;
  let statusReads = 0;
  const provider = {
    async viewNodeStatus() {
      statusReads += 1;
      if (options.status !== undefined) return options.status();
      return { chain_id: options.chainId ?? 'testnet' };
    },
    async viewTransactionStatus({ txHash }: { txHash: string }) {
      lookedUp.push(txHash);
      if (options.lookup !== undefined) return options.lookup(txHash);
      throw new FailoverRpcError(2, [
        new UnknownTransactionError(txHash),
        new UnknownTransactionError(txHash),
      ]);
    },
    async viewAccessKey() {
      return { nonce, permission: 'FullAccess', block_hash: BLOCK_HASH, block_height: 1 };
    },
    async viewBlock() {
      return { header: { hash: BLOCK_HASH, height: 1 } };
    },
    async sendTransactionUntil(tx: SignedTransaction) {
      sent.push(tx);
      try {
        return options.send === undefined ? {} : await options.send(tx, sent.length);
      } catch (error) {
        if (error instanceof FailoverRpcError || error instanceof InvalidNonceError) nonce += 1n;
        throw error;
      }
    },
  };
  return {
    provider: provider as unknown as Provider,
    sent,
    lookedUp,
    statusReads: () => statusReads,
  };
}

const hashOf = (tx: SignedTransaction) =>
  baseEncode(createHash('sha256').update(tx.transaction.encode()).digest());

const signer = (provider: Provider) =>
  createNearSigner({ accountId: AGENT, secretKey: SECRET, provider });

async function sendError(promise: Promise<unknown>): Promise<SendError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SendError) return error;
    throw error;
  }
  throw new Error('expected a SendError');
}

const buy = actions.buyTicket(1, parseNear('1.5'));

describe('createNearSigner', () => {
  it('signs exactly the call, to the contract, from the agent, and returns the hash the chain uses', async () => {
    const chain = fakeChain();
    const hash = await signer(chain.provider).signAndSend(CONTRACT, buy);

    expect(chain.sent).toHaveLength(1);
    const tx = chain.sent[0];
    if (tx === undefined) throw new Error('nothing sent');
    expect(hash).toBe(hashOf(tx));
    expect(tx.transaction.signerId).toBe(AGENT);
    expect(tx.transaction.receiverId).toBe(CONTRACT);
    expect(tx.transaction.publicKey.toString()).toBe(KEY.getPublicKey().toString());
    expect(tx.transaction.nonce).toBe(42n);
    expect(tx.transaction.actions).toHaveLength(1);
    const fn = tx.transaction.actions[0]?.functionCall;
    expect(fn?.methodName).toBe('buy_ticket');
    expect(JSON.parse(new TextDecoder().decode(fn?.args))).toEqual(buy.args);
    expect(fn?.deposit).toBe(BigInt(buy.deposit));
    expect(fn?.gas).toBe(BigInt(buy.gas));
  });

  it('checks the chain before every signature, not only the first', async () => {
    const chain = fakeChain();
    const agent = signer(chain.provider);
    await agent.signAndSend(CONTRACT, buy);
    await agent.signAndSend(CONTRACT, actions.claimRefund('1-1'));
    expect(chain.statusReads()).toBe(2);
  });

  it('signs nothing when the RPC is not on testnet', async () => {
    const chain = fakeChain({ chainId: 'mainnet' });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error).toMatchObject({ txHash: null, mayHaveLanded: false });
    expect(error.message).toBe(
      'The RPC reports chain mainnet, not testnet, so nothing was signed.',
    );
    expect(chain.sent).toEqual([]);
  });

  it('reports a transaction the node refused as not landed, with its hash', async () => {
    const chain = fakeChain({
      send: async () => {
        throw new NotEnoughBalanceError(0n, 10n ** 24n, AGENT, 'h', BLOCK_HASH);
      },
    });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error.mayHaveLanded).toBe(false);
    expect(error.txHash).toBe(chain.sent[0] && hashOf(chain.sent[0]));
  });

  it('reports a timeout as possibly landed, with the hash to track', async () => {
    const chain = fakeChain({
      send: async () => {
        throw new Error('sendTransactionUntil on https://rpc.example timed out after 30000 ms');
      },
    });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error.mayHaveLanded).toBe(true);
    expect(error.txHash).toBe(chain.sent[0] && hashOf(chain.sent[0]));
    expect(chain.sent).toHaveLength(1);
  });

  it('a timeout on one endpoint and a used nonce on the next may mean the first one landed', async () => {
    const chain = fakeChain({
      send: async () => {
        throw new FailoverRpcError(2, [
          new Error('sendTransactionUntil on https://a.example timed out after 30000 ms'),
          new InvalidNonceError(42, 42, 'h', BLOCK_HASH),
        ]);
      },
    });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error.mayHaveLanded).toBe(true);
    expect(chain.sent).toHaveLength(1);
  });

  it('signs again with a fresh nonce when another process used this one', async () => {
    const chain = fakeChain({
      send: async (_tx, count) => {
        if (count === 1) {
          throw new FailoverRpcError(2, [
            new InvalidNonceError(42, 42, 'h', BLOCK_HASH),
            new InvalidNonceError(42, 42, 'h', BLOCK_HASH),
          ]);
        }
        return {};
      },
    });
    const hash = await signer(chain.provider).signAndSend(CONTRACT, buy);
    expect(chain.sent.map((tx) => tx.transaction.nonce)).toEqual([42n, 43n]);
    expect(hash).toBe(chain.sent[1] && hashOf(chain.sent[1]));
  });

  it('does not sign a second time when the transaction whose nonce was "used" had landed', async () => {
    // Endpoint A included the transaction and timed out; B then says its nonce is used.
    const chain = fakeChain({
      send: async () => {
        throw new FailoverRpcError(2, [
          new InvalidNonceError(42, 42, 'h', BLOCK_HASH),
          new InvalidNonceError(42, 42, 'h', BLOCK_HASH),
        ]);
      },
      lookup: async () => ({ final_execution_status: 'INCLUDED' }),
    });
    const hash = await signer(chain.provider).signAndSend(CONTRACT, buy);
    expect(chain.sent).toHaveLength(1);
    expect(hash).toBe(chain.sent[0] && hashOf(chain.sent[0]));
    expect(chain.lookedUp).toEqual([hash]);
  });

  it('signs again after a used nonce only when the chain says the first one is unknown', async () => {
    const chain = fakeChain({
      send: async (_tx, count) => {
        if (count === 1) throw new InvalidNonceError(42, 42, 'h', BLOCK_HASH);
        return {};
      },
    });
    await signer(chain.provider).signAndSend(CONTRACT, buy);
    expect(chain.sent).toHaveLength(2);
    expect(chain.lookedUp).toEqual([chain.sent[0] && hashOf(chain.sent[0])]);
  });

  it('stops, as possibly landed, when the lookup after a used nonce cannot answer', async () => {
    const chain = fakeChain({
      send: async () => {
        throw new InvalidNonceError(42, 42, 'h', BLOCK_HASH);
      },
      lookup: async (txHash) => {
        throw new FailoverRpcError(2, [
          new UnknownTransactionError(txHash),
          new Error('viewTransactionStatus on https://b.example timed out after 30000 ms'),
        ]);
      },
    });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error).toMatchObject({
      mayHaveLanded: true,
      txHash: chain.sent[0] && hashOf(chain.sent[0]),
    });
    expect(chain.sent).toHaveLength(1);
  });

  it('counts the node timing out the transaction as possibly landed', async () => {
    const chain = fakeChain({
      send: async () => {
        throw new FailoverRpcError(1, [new TransactionTimeoutError()]);
      },
    });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error.mayHaveLanded).toBe(true);
    expect(chain.sent).toHaveLength(1);
  });

  it('signs nothing when the chain id cannot be read', async () => {
    const chain = fakeChain({
      status: async () => {
        throw new Error('viewNodeStatus on https://a.example timed out after 8000 ms');
      },
    });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error).toMatchObject({ txHash: null, mayHaveLanded: false });
    expect(chain.sent).toEqual([]);
  });

  it('gives up on a nonce that keeps being taken, as not landed', async () => {
    const chain = fakeChain({
      send: async () => {
        throw new InvalidNonceError(1, 1, 'h', BLOCK_HASH);
      },
    });
    const error = await sendError(signer(chain.provider).signAndSend(CONTRACT, buy));
    expect(error.mayHaveLanded).toBe(false);
    expect(chain.sent).toHaveLength(3);
  });

  it('returns the hash of a transaction that ran and failed, so the verdict comes from the chain', async () => {
    const chain = fakeChain({
      send: async () => {
        throw new ActionExecutionError('Smart contract panicked: ERR_SOLD_OUT', 0, 'h', BLOCK_HASH);
      },
    });
    const hash = await signer(chain.provider).signAndSend(CONTRACT, buy);
    expect(hash).toBe(chain.sent[0] && hashOf(chain.sent[0]));
  });

  it('never repeats the secret key, even for a malformed one', () => {
    const chain = fakeChain();
    const bad = `${SECRET.slice(0, -4)}0OIl`;
    expect(() =>
      createNearSigner({ accountId: AGENT, secretKey: bad, provider: chain.provider }),
    ).toThrow('AGENT_PRIVATE_KEY is not a valid secret key (the value is not shown).');
  });

  it('signs an entry pass message with its key, without reading or sending anything', async () => {
    const chain = fakeChain();
    const request = passRequest({
      contract: CONTRACT,
      ticket: '1-3',
      issuedAtMs: 1_794_650_000_000,
    });
    const signed = await signer(chain.provider).signMessage(request);
    expect(signed.publicKey).toBe(KEY.getPublicKey().toString());
    const bytes = Uint8Array.from(Buffer.from(signed.signature, 'base64'));
    expect(KEY.getPublicKey().verify(nep413Hash(request), bytes)).toBe(true);
    expect(chain.sent).toEqual([]);
    expect(chain.statusReads()).toBe(0);
  });
});
