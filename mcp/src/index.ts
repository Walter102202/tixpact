// @ticket-escrow/mcp: a local MCP server for an agent that buys, transfers and claims tickets from
// its own testnet account, within caps checked before anything is signed.

export { type Agent, type AgentDeps, createAgent } from './agent.js';
export {
  type AgentConfig,
  type Caps,
  ConfigError,
  DEFAULT_RPC_URLS,
  type Env,
  loadConfig,
  readAgentKey,
} from './config.js';
export {
  type AgentState,
  ALLOWED_METHODS,
  type Decision,
  type DenyReason,
  evaluate,
  exposureOf,
  type Intent,
  type Policy,
} from './policy.js';
export { TOOL_NAMES, type ToolName, type WriteResult, type WriteStatus } from './schemas.js';
export { createServer, SERVER_NAME } from './server.js';
export { type AgentSigner, SendError } from './signer.js';
