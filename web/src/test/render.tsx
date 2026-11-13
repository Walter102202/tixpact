import { render } from '@testing-library/react';
import {
  createFixtureReader,
  createFixtureRpc,
  FIXTURE_NOW_MS,
  FIXTURE_TOKEN_ID,
} from '@ticket-escrow/client';
import { App } from '../App';
import { createFixtureWallet, type FixtureWallet } from '../lib/near/wallet';
import type { AppServices } from '../services';

export const TEST_TIME_ZONE = 'America/Santiago';

const noSleep = async () => {};

/** Fixture services with no waiting, a fixed viewer zone and a wallet the test can script. */
export function testServices(overrides: Partial<AppServices> = {}): AppServices & {
  wallet: FixtureWallet;
} {
  const wallet = (overrides.wallet as FixtureWallet | undefined) ?? createFixtureWallet();
  return {
    network: 'testnet',
    contractId: 'ticket-escrow.testnet',
    fixtureMode: true,
    reader: createFixtureReader(),
    txRpc: createFixtureRpc(),
    timeZone: TEST_TIME_ZONE,
    trackOptions: { sleep: noSleep },
    rereadOptions: { sleep: noSleep },
    now: () => FIXTURE_NOW_MS,
    faucets: [FIXTURE_TOKEN_ID],
    ...overrides,
    wallet,
  };
}

/** Renders the whole app at `path`. */
export function renderAt(path: string, services: AppServices = testServices()) {
  window.history.pushState(null, '', path);
  const view = render(<App services={services} />);
  return { ...view, services };
}
