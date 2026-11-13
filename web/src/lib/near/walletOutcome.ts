import type { ConnectorAction } from '@hot-labs/near-connect';
import type { ContractCall } from '@ticket-escrow/client';
import { z } from 'zod';

// The two edges between our calls and NEAR Connect, kept apart from the connector so they can be
// tested without loading a wallet. near-connect's declarations import their outcome type from a
// package that is not installed, so the wallet's answer is typed here as unknown and parsed.

/** One contract call as NEAR Connect's FunctionCall action; amounts and gas pass unchanged. */
export function toConnectorAction(call: ContractCall): ConnectorAction {
  return {
    type: 'FunctionCall',
    params: {
      methodName: call.methodName,
      args: call.args,
      gas: call.gas,
      deposit: call.deposit,
    },
  };
}

const OutcomeSchema = z.object({ transaction_outcome: z.object({ id: z.string().min(1) }) });

/**
 * The transaction hash from what `signAndSendTransaction` resolved with. The outcome itself is not
 * trusted for anything else: the page reads the chain by this hash.
 */
export function txHashFromOutcome(outcome: unknown): string {
  const parsed = OutcomeSchema.safeParse(outcome);
  if (!parsed.success) throw new Error('The wallet did not return a transaction hash.');
  return parsed.data.transaction_outcome.id;
}
