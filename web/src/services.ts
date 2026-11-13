import {
  createFixtureReader,
  createFixtureRpc,
  FIXTURE_CONTRACT_ID,
  FIXTURE_NOW_MS,
  type Reader,
  type ReadUntilChangedOptions,
  type TrackOptions,
  type TxStatusRpc,
} from '@ticket-escrow/client';
import { createContext, useContext } from 'react';
import { createFixtureWallet, type WalletPort } from './lib/near/wallet';

/** Everything a screen talks to. Built once in `main.tsx`; tests build their own. */
export interface AppServices {
  network: 'testnet';
  contractId: string;
  fixtureMode: boolean;
  reader: Reader;
  txRpc: TxStatusRpc;
  wallet: WalletPort;
  /** IANA zone every time is shown in: the viewer's. */
  timeZone: string;
  trackOptions?: TrackOptions;
  rereadOptions?: ReadUntilChangedOptions;
  /** The clock new terms are checked against; the chain's clock judges them again. */
  now?: () => number;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices needs a ServicesContext provider');
  return services;
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Demo mode: fixture data, recorded transactions, and a wallet that signs in as luis.testnet. */
export function createFixtureServices(): AppServices {
  return {
    network: 'testnet',
    contractId: FIXTURE_CONTRACT_ID,
    fixtureMode: true,
    reader: createFixtureReader(),
    txRpc: createFixtureRpc(),
    wallet: createFixtureWallet(null),
    timeZone: viewerTimeZone(),
    // The fixture events are laid out around this instant.
    now: () => FIXTURE_NOW_MS,
  };
}
