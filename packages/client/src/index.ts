// @ticket-escrow/client: the one shared copy of the contract's shapes, calls, errors and words,
// used by the web app and the MCP server.

export type { ContractCall, ContractMethod } from './actions.js';
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
  FIXTURES,
  TX_FIXTURES,
} from './fixtures.js';
export { CLAIM_LABELS, formatDateTime, formatNear, PHASE_LABELS, parseNear } from './format.js';
export type { EntryPass, PassChain, PassCheck, PassRequest, PassRpc } from './pass.js';
export {
  checkPass,
  createFixturePassChain,
  createPassChain,
  decodePass,
  demoPassKey,
  doorUrl,
  encodePass,
  nep413Hash,
  PASS_SKEW_MS,
  PASS_TTL_MS,
  passMessage,
  passNonce,
  passRequest,
  signedPass,
  signPassWithKey,
} from './pass.js';
export type {
  AccountProof,
  CallFunctionParams,
  GroupVerifier,
  Reader,
  ReaderOptions,
  ReaderRpc,
  RpcOptions,
  ViewAccessKeyListParams,
  ViewAccountParams,
} from './reader.js';
export { createReader, createRpc, groupVerifierOf } from './reader.js';
export { canClaimRefund } from './rules.js';
export * from './schemas.js';
export type {
  FailedReceipt,
  FailedStep,
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
  readUntilChanged,
  summarizeTransaction,
  TxStatusSchema,
  trackTransaction,
} from './tx.js';
