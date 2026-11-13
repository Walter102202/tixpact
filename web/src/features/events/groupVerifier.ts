import type { GroupVerifier } from '@ticket-escrow/client';
import { useEffect, useState } from 'react';
import { useServices } from '../../services';

/** Members named before the list is cut, so a large council stays one line. */
const NAMED = 5;

/**
 * "a group of 3; its rules now: 2 must agree (a.testnet, b.testnet, c.testnet)". "Now": a DAO can
 * change its own policy, and the line is read when the page loads.
 */
export function groupLine({ members, needed }: GroupVerifier): string {
  const named =
    members.length <= NAMED + 1
      ? members.join(', ')
      : `${members.slice(0, NAMED).join(', ')} and ${members.length - NAMED} more`;
  return `a group of ${members.length}; its rules now: ${needed} must agree (${named})`;
}

/**
 * The group behind a verifier that is a Sputnik DAO, or null: for a plain account, while it is
 * read, or when the read fails. The page then shows the account as it always has.
 */
export function useGroupVerifier(accountId: string): GroupVerifier | null {
  const { reader } = useServices();
  const [group, setGroup] = useState<{ accountId: string; group: GroupVerifier | null } | null>(
    null,
  );
  useEffect(() => {
    let current = true;
    reader.readGroupVerifier?.(accountId).then(
      (found) => current && setGroup({ accountId, group: found }),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [reader, accountId]);
  return group?.accountId === accountId ? group.group : null;
}
