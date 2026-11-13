import {
  createFixturePassChain,
  createFixtureReader,
  createFixtureRpc,
  FIXTURE_CONTRACT_ID,
  FIXTURE_NOW_MS,
  FIXTURE_TOKEN_ID,
  FIXTURES_WITH_TOKENS,
  type PassChain,
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
  /** What the door reads to check an entry pass: access keys and tickets. */
  passChain: PassChain;
  /** IANA zone every time is shown in: the viewer's. */
  timeZone: string;
  trackOptions?: TrackOptions;
  rereadOptions?: ReadUntilChangedOptions;
  /** The clock new terms are checked against; the chain's clock judges them again. */
  now?: () => number;
  /**
   * Tokens with a test faucet (`faucet()`): test money, which the buy panel may offer and every
   * screen calls "a test dollar with no value".
   */
  faucets: readonly string[];
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

/**
 * Demo mode: fixture data (events in NEAR and in the test dollar token), recorded transactions,
 * and a wallet that signs in as luis.testnet.
 */
export function createFixtureServices(): AppServices {
  // One reader for the pages and the door, so a tUSD ticket checks at the door as it shows.
  const reader = createFixtureReader(FIXTURES_WITH_TOKENS);
  return {
    network: 'testnet',
    contractId: FIXTURE_CONTRACT_ID,
    fixtureMode: true,
    reader,
    txRpc: createFixtureRpc(),
    wallet: createFixtureWallet(null),
    // Demo accounts sign passes with built-in keys that this chain lists as theirs.
    passChain: createFixturePassChain(reader),
    timeZone: viewerTimeZone(),
    // The fixture events are laid out around this instant.
    now: () => FIXTURE_NOW_MS,
    faucets: [FIXTURE_TOKEN_ID],
  };
}
