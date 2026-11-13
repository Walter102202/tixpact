import { render } from '@testing-library/react';
import {
  createFixturePassChain,
  createFixtureReader,
  createFixtureRpc,
  FIXTURE_NOW_MS,
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
  const reader = overrides.reader ?? createFixtureReader();
  return {
    network: 'testnet',
    contractId: 'ticket-escrow.testnet',
    fixtureMode: true,
    reader,
    passChain: createFixturePassChain(reader),
    txRpc: createFixtureRpc(),
    timeZone: TEST_TIME_ZONE,
    trackOptions: { sleep: noSleep },
    rereadOptions: { sleep: noSleep },
    now: () => FIXTURE_NOW_MS,
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
