import { screen, waitFor } from '@testing-library/react';
import { createFixtureReader, FIXTURES, type FixtureData } from '@ticket-escrow/client';
import { describe, expect, it } from 'vitest';
import { renderAt, testServices } from '../../test/render';
import { groupLine } from './groupVerifier';

const JURY = 'jury.sputnikv2.testnet';
const COUNCIL = ['a.testnet', 'b.testnet', 'c.testnet'];

/** Event 1 confirmed by a Sputnik DAO whose council of three decides by more than half. */
function juryData(): FixtureData {
  const data = structuredClone(FIXTURES);
  data.events = data.events.map((e) => (e.event_id === 1 ? { ...e, verifier_id: JURY } : e));
  data.policies = {
    [JURY]: {
      roles: [
        { name: 'all', kind: 'Everyone', permissions: ['*:AddProposal'], vote_policy: {} },
        {
          name: 'council',
          kind: { Group: COUNCIL },
          permissions: ['*:Finalize', '*:AddProposal', '*:VoteApprove', '*:VoteReject'],
          vote_policy: {},
        },
      ],
      default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 2] },
    },
  };
  return data;
}

function verifierFact(): string {
  const term = screen.getByText('Verifier', { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
}

describe('an event whose verifier is a group', () => {
  it('says how many members must agree, and who they are', async () => {
    renderAt('/events/1', testServices({ reader: createFixtureReader(juryData()) }));
    await screen.findByRole('heading', { level: 1, name: 'Jazz night' });
    await waitFor(() =>
      expect(verifierFact()).toBe(
        `${JURY} · a group of 3; its rules now: 2 must agree (a.testnet, b.testnet, c.testnet) · accepted these terms`,
      ),
    );
  });

  it('reads as before when the verifier is a plain account', async () => {
    renderAt('/events/1', testServices());
    await screen.findByRole('heading', { level: 1, name: 'Jazz night' });
    expect(verifierFact()).toBe('teatro.testnet · accepted these terms');
  });

  it('names five members of a larger group and counts the rest', () => {
    const members = Array.from({ length: 9 }, (_, i) => `m${i + 1}.testnet`);
    expect(groupLine({ members, needed: 5 })).toBe(
      'a group of 9; its rules now: 5 must agree (m1.testnet, m2.testnet, m3.testnet, m4.testnet, m5.testnet and 4 more)',
    );
    expect(groupLine({ members: members.slice(0, 6), needed: 4 })).toContain('m6.testnet)');
  });
});
