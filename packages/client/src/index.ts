// @ticket-escrow/client: the one shared copy of the contract's shapes, calls, errors and words,
// used by the web app and the MCP server.

export type { ContractCall, ContractMethod, ExternalCall } from './actions.js';
export * as actions from './actions.js';
export { APP_NAME, PROMISE_TEXT } from './brand.js';
export type { ContractError, ErrorCode } from './errors.js';
export { ERROR_CODES, ERROR_MESSAGES, parseContractError } from './errors.js';
export type { FixtureData, RecordedTx } from './fixtures.js';
export {
  createFixtureReader,
  createFixtureRpc,
  FIXTURE_CONTRACT_ID,
  FIXTURE_NOW_MS,
  FIXTURE_TOKEN_ID,
  FIXTURES,
  FIXTURES_WITH_TOKENS,
  TX_FIXTURES,
} from './fixtures.js';
export type { Unit } from './format.js';
export {
  CLAIM_LABELS,
  formatAmount,
  formatDateTime,
  formatNear,
  NEAR_UNIT,
  PHASE_LABELS,
  parseAmount,
  parseNear,
  unitOf,
} from './format.js';
export type {
  AccountProof,
  CallFunctionParams,
  Reader,
  ReaderOptions,
  ReaderRpc,
  RpcOptions,
  TokenRegistration,
  ViewAccessKeyListParams,
  ViewAccountParams,
} from './reader.js';
export { createReader, createRpc } from './reader.js';
export { canClaimRefund } from './rules.js';
export * from './schemas.js';
export type {
  ContractEvent,
  FailedReceipt,
  FailedStep,
  PurchaseResult,
  ReadUntilChangedOptions,
  TrackOptions,
  TxResult,
  TxStage,
  TxStatus,
  TxStatusRpc,
  TxWaitLevel,
} from './tx.js';
export {
  explorerAccountUrl,
  explorerTxUrl,
  moneyMoved,
  purchaseResult,
  readUntilChanged,
  summarizeTransaction,
  TxStatusSchema,
  trackTransaction,
} from './tx.js';
