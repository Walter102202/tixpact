interface ImportMetaEnv {
  readonly VITE_NETWORK?: string;
  readonly VITE_CONTRACT_ID?: string;
  readonly VITE_RPC_URLS?: string;
  readonly VITE_FIXTURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
