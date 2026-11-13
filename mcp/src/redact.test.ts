import { createFixtureReader, FIXTURE_CONTRACT_ID, type Reader } from '@ticket-escrow/client';
import { FailoverRpcError } from 'near-api-js';
import { describe, expect, it } from 'vitest';
import { createAgent } from './agent.js';
import { createRedactor, quietConsole, redactDeep } from './redact.js';
import { watch } from './watch.js';

const SECRET_RPC = 'https://rpc.provider.example/near-testnet/APIKEY-s3cr3t';
const OTHER_RPC = 'https://near-testnet.drpc.org';
const redact = createRedactor([OTHER_RPC, SECRET_RPC]);

describe('createRedactor', () => {
  it('replaces RPC URLs and their bare hosts with their position, and keeps other links', () => {
    expect(redact(`callFunction on ${SECRET_RPC} timed out after 8000 ms`)).toBe(
      'callFunction on RPC endpoint 2 timed out after 8000 ms',
    );
    expect(redact(`Server error 502 from ${SECRET_RPC}/status: Bad gateway`)).toBe(
      'Server error 502 from RPC endpoint 2: Bad gateway',
    );
    expect(redact('getaddrinfo ENOTFOUND rpc.provider.example')).toBe(
      'getaddrinfo ENOTFOUND RPC endpoint 2',
    );
    expect(redact(`${OTHER_RPC} answered 503`)).toBe('RPC endpoint 1 answered 503');
    const explorer = 'https://testnet.nearblocks.io/txns/AbC';
    expect(redact(`Transaction: ${explorer}`)).toBe(`Transaction: ${explorer}`);
  });

  it('reaches every string inside a structured result', () => {
    expect(redactDeep({ message: `x ${SECRET_RPC}`, list: [SECRET_RPC], n: 1 }, redact)).toEqual({
      message: 'x RPC endpoint 2',
      list: ['RPC endpoint 2'],
      n: 1,
    });
  });
});

describe('quietConsole', () => {
  it("turns near-api-js's console.error of a failed endpoint into one line without its URL", () => {
    const written: string[] = [];
    const restore = quietConsole(redact, (line) => written.push(line));
    try {
      console.error(new Error(`viewNodeStatus on ${SECRET_RPC} timed out after 8000 ms`));
      console.warn('retrying', SECRET_RPC);
    } finally {
      restore();
    }
    expect(written).toEqual([
      'Error: viewNodeStatus on RPC endpoint 2 timed out after 8000 ms\n',
      'retrying RPC endpoint 2\n',
    ]);
    expect(written.join('')).not.toContain('http');
  });
});

describe('the watcher log', () => {
  it('shows no RPC URL when an endpoint fails', async () => {
    const failing: Reader = {
      ...createFixtureReader(),
      async listTicketsForOwner() {
        throw new FailoverRpcError(1, [
          new Error(`callFunction on ${SECRET_RPC} timed out after 8000 ms`),
        ]);
      },
    };
    const agent = createAgent({
      config: {
        network: 'testnet',
        contractId: FIXTURE_CONTRACT_ID,
        rpcUrls: [OTHER_RPC, SECRET_RPC],
        agentAccountId: 'luis.testnet',
        caps: null,
        hasKey: false,
      },
      reader: failing,
      txRpc: { viewTransactionStatusWithReceipts: async () => ({}) },
      signer: null,
    });
    const lines: string[] = [];
    const controller = new AbortController();
    await watch({
      agent,
      log: (line) => lines.push(line),
      redact,
      intervalMs: 5,
      signal: controller.signal,
      sleep: async () => controller.abort(),
    });
    expect(lines.some((l) => l.startsWith('Round failed:'))).toBe(true);
    expect(lines.join('\n')).not.toContain('http');
    expect(lines.join('\n')).toContain('RPC endpoint 2');
  });
});
