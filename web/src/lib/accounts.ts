import { AccountIdSchema } from '@ticket-escrow/client';

const IMPLICIT = /^[0-9a-f]{64}$/;
const ETH_IMPLICIT = /^0x[0-9a-f]{40}$/;

/**
 * Why `id` cannot receive a ticket or confirm an event on testnet, or null when it can. A valid but
 * foreign id ("ana", "ana.testne") is refused too: nobody can sign for it on testnet, so a ticket
 * or a verifier role sent there is lost.
 */
export function testnetAccountError(id: string): string | null {
  if (!AccountIdSchema.safeParse(id).success) return 'That is not a valid NEAR account id.';
  if (id.endsWith('.testnet') || IMPLICIT.test(id) || ETH_IMPLICIT.test(id)) return null;
  return 'Testnet accounts end in .testnet.';
}

/**
 * Whether `id` is a named account. While one does not exist anyone can register it, so a typo
 * could hand a ticket or the verifier role to a stranger. An implicit id is bound to its key.
 */
export function isNamedAccount(id: string): boolean {
  return !IMPLICIT.test(id) && !ETH_IMPLICIT.test(id);
}

export const missingAccountMessage = (id: string) => `No account named ${id} exists on testnet.`;
