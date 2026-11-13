import { createPassChain, createReader, createRpc } from '@ticket-escrow/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readConfig } from './config';
import { createNearConnectWallet } from './lib/near/connector';
import { type AppServices, createFixtureServices, viewerTimeZone } from './services';
import './styles/tokens.css';
import './styles/app.css';
import './styles/landing.css';
import './styles/pass.css';

function liveServices(contractId: string, rpcUrls: string[]): AppServices {
  const rpc = createRpc(rpcUrls);
  const reader = createReader({ contractId, rpc });
  return {
    network: 'testnet',
    contractId,
    fixtureMode: false,
    reader,
    txRpc: rpc,
    wallet: createNearConnectWallet({ contractId, rpcUrls }),
    passChain: createPassChain(reader, rpc),
    timeZone: viewerTimeZone(),
  };
}

const config = readConfig(import.meta.env);
const services =
  config.fixtureMode || config.contractId === null
    ? createFixtureServices()
    : liveServices(config.contractId, config.rpcUrls);

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
