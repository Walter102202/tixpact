import { createReader, createRpc } from '@ticket-escrow/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readConfig } from './config';
import { createNearConnectWallet } from './lib/near/connector';
import { type AppServices, createFixtureServices, viewerTimeZone } from './services';
import './styles/tokens.css';
import './styles/app.css';
import './styles/landing.css';

function liveServices(contractId: string, rpcUrls: string[], faucets: string[]): AppServices {
  const rpc = createRpc(rpcUrls);
  return {
    network: 'testnet',
    contractId,
    fixtureMode: false,
    reader: createReader({ contractId, rpc }),
    txRpc: rpc,
    wallet: createNearConnectWallet({ contractId, rpcUrls }),
    timeZone: viewerTimeZone(),
    faucets,
  };
}

const config = readConfig(import.meta.env);
const services =
  config.fixtureMode || config.contractId === null
    ? createFixtureServices()
    : liveServices(config.contractId, config.rpcUrls, config.faucetTokens);

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
