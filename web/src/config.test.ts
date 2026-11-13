import { describe, expect, it } from 'vitest';
import { DEFAULT_RPC_URLS, readConfig } from './config';

describe('readConfig', () => {
  it('runs on demo data when no contract id is set', () => {
    expect(readConfig({})).toEqual({
      network: 'testnet',
      contractId: null,
      rpcUrls: DEFAULT_RPC_URLS,
      fixtureMode: true,
    });
    expect(readConfig({ VITE_CONTRACT_ID: '   ' }).fixtureMode).toBe(true);
  });

  it('reads the contract when one is set, unless fixtures are asked for', () => {
    const live = readConfig({ VITE_CONTRACT_ID: 'te-d3-escrow.testnet' });
    expect(live.fixtureMode).toBe(false);
    expect(live.contractId).toBe('te-d3-escrow.testnet');
    expect(
      readConfig({ VITE_CONTRACT_ID: 'te-d3-escrow.testnet', VITE_FIXTURES: '1' }).fixtureMode,
    ).toBe(true);
  });

  it('refuses any network but testnet', () => {
    expect(() => readConfig({ VITE_NETWORK: 'mainnet', VITE_CONTRACT_ID: 'x.near' })).toThrow(
      'VITE_NETWORK is "mainnet"; this app only runs on testnet.',
    );
  });

  it('takes a comma-separated RPC list in order, and falls back to the defaults', () => {
    expect(
      readConfig({ VITE_RPC_URLS: ' https://a.example , https://b.example ,' }).rpcUrls,
    ).toEqual(['https://a.example', 'https://b.example']);
    expect(readConfig({ VITE_RPC_URLS: ' , ' }).rpcUrls).toEqual(DEFAULT_RPC_URLS);
  });
});
