#!/usr/bin/env node
// Read-only check of a deployed contract: which code runs there and who can still change it.
// It signs nothing and needs no key.
//
//   pnpm install --frozen-lockfile && pnpm --filter @ticket-escrow/client build
//   node scripts/verify-deployment.mjs <contract-account> [--wasm <file>] [--tokens <a,b>] [--allow-keys]
//
// Prints the account's code hash, the number of access keys, its balance and the principal the
// contract says it holds, in NEAR and in each token it accepts. Exits non-zero when:
//   - the account has an access key (somebody could still replace the code), unless --allow-keys;
//   - the deployed code is a test build with fault injection;
//   - --wasm is given and the deployed code hash is not the SHA-256 of that file;
//   - --tokens is given and the tokens the contract accepts are not exactly that list (the list is
//     fixed when the contract is created; `--tokens ""` means it must accept NEAR only);
//   - a balance does not cover the principal the contract reports as held in that currency;
//   - the contract is not registered with a token it accepts (the token would reject every
//     purchase in it).
//
// "Held" is what the contract still owes out of its own balance: each event's reserved principal
// plus what is available to its organizer. Payments in flight have already left the account and
// are shown on their own line.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createReader,
  createRpc,
  explorerAccountUrl,
  formatAmount,
  formatNear,
} from '@ticket-escrow/client';
import { baseEncode } from 'near-api-js';

const DEFAULT_RPC_URLS = 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org';
const args = process.argv.slice(2);
const wasmFlag = args.indexOf('--wasm');
const wasmPath = wasmFlag === -1 ? undefined : args[wasmFlag + 1];
const tokensFlag = args.indexOf('--tokens');
const expectedTokens =
  tokensFlag === -1
    ? undefined
    : (args[tokensFlag + 1] ?? '').split(',').filter((token) => token !== '');
const allowKeys = args.includes('--allow-keys');
const flagValues = new Set([wasmFlag, tokensFlag].filter((at) => at !== -1).map((at) => at + 1));
const contractId = args.find((arg, index) => !arg.startsWith('--') && !flagValues.has(index));

if (!contractId) {
  console.error(
    'usage: node scripts/verify-deployment.mjs <contract-account> [--wasm <file>] [--tokens <a,b>] [--allow-keys]',
  );
  process.exit(2);
}

const rpc = createRpc((process.env.RPC_URLS ?? DEFAULT_RPC_URLS).split(','));
const reader = createReader({ contractId, rpc });
const problems = [];

const proof = await reader.getAccountProof(contractId);
// An account without code reports a code hash of 32 zero bytes, which is this text in base58.
if (proof.codeHash === '1'.repeat(32)) {
  console.error(`NOT VERIFIED: no contract is deployed at ${contractId}.`);
  process.exit(1);
}
const config = await reader.getConfig();

// One ledger per currency: `null` is NEAR, the rest are the tokens fixed at deployment.
const ledgers = new Map(
  [null, ...config.tokens.map((token) => token.account_id)].map((currency) => [
    currency,
    { held: 0n, inFlight: 0n, events: 0 },
  ]),
);
for (let from = 0; ; from += config.max_page) {
  const page = await reader.listEvents(from, config.max_page);
  for (const event of page) {
    const books = await reader.getAccounting(event.event_id);
    const ledger = ledgers.get(books.currency);
    if (ledger === undefined) {
      problems.push(
        `Event ${event.event_id} is priced in ${books.currency}, which the contract does not list.`,
      );
      continue;
    }
    ledger.held += BigInt(books.principal_reserved) + BigInt(books.organizer_available);
    ledger.inFlight += BigInt(books.refund_pending) + BigInt(books.organizer_pending);
    ledger.events += 1;
  }
  if (page.length < config.max_page) break;
}
const { held, inFlight, events } = ledgers.get(null);

console.log(`Contract        ${contractId}  (${explorerAccountUrl(contractId)})`);
console.log(`Block height    ${proof.blockHeight} (final)`);
console.log(
  `Version         ${config.version}${config.fault_injection ? '  FAULT INJECTION BUILD' : ''}`,
);
console.log(`Code hash       ${proof.codeHash}`);
console.log(`Access keys     ${proof.accessKeys}`);
console.log(`Balance         ${formatNear(proof.balance, 6)} NEAR`);
console.log(`Principal held  ${formatNear(held.toString(), 6)} NEAR in ${events} event(s)`);
if (inFlight > 0n) {
  console.log(
    `In flight       ${formatNear(inFlight.toString(), 6)} NEAR, payments not yet confirmed`,
  );
}
for (const token of config.tokens) {
  const ledger = ledgers.get(token.account_id);
  const unit = { symbol: token.symbol, decimals: token.decimals };
  const [standing, balance] = await Promise.all([
    reader.tokenRegistration(token.account_id, contractId),
    reader.tokenBalance(token.account_id, contractId),
  ]);
  console.log(`\nToken           ${token.account_id}  (${explorerAccountUrl(token.account_id)})`);
  console.log(`Registered      ${standing.registered ? 'yes' : 'NO'}`);
  console.log(`Balance         ${formatAmount(balance, unit)}`);
  console.log(
    `Principal held  ${formatAmount(ledger.held.toString(), unit)} in ${ledger.events} event(s)`,
  );
  if (ledger.inFlight > 0n) {
    console.log(
      `In flight       ${formatAmount(ledger.inFlight.toString(), unit)}, payments not yet confirmed`,
    );
  }
  if (!standing.registered) {
    problems.push(
      `The contract is not registered with ${token.account_id}: the token rejects every purchase in ${token.symbol}.`,
    );
  }
  if (BigInt(balance) < ledger.held) {
    problems.push(
      `The ${token.symbol} balance is lower than the principal the contract reports as held in it.`,
    );
  }
}

if (proof.accessKeys > 0 && !allowKeys) {
  problems.push(
    `${proof.accessKeys} access key(s): this deployment can still be changed by its key holder.`,
  );
}
if (config.fault_injection) {
  problems.push('The deployed code is a test build with fault injection.');
}
if (expectedTokens !== undefined) {
  const accepted = config.tokens.map((token) => token.account_id).sort();
  if (accepted.join(',') !== [...expectedTokens].sort().join(',')) {
    const list = (tokens) => (tokens.length === 0 ? 'no token' : tokens.join(', '));
    problems.push(
      `The contract accepts ${list(accepted)}; the expected list is ${list(expectedTokens)}.`,
    );
  }
}
if (BigInt(proof.balance) < held) {
  problems.push('The NEAR balance is lower than the principal the contract reports as held.');
}
if (wasmPath) {
  const local = baseEncode(
    createHash('sha256')
      .update(await readFile(wasmPath))
      .digest(),
  );
  console.log(`Local wasm      ${local}  (${wasmPath})`);
  if (local !== proof.codeHash) problems.push('The deployed code is not the wasm file given.');
}

if (problems.length === 0) {
  console.log(
    proof.accessKeys === 0
      ? '\nOK: nobody holds a key to this contract and its balance covers what it holds.'
      : `\nOK with --allow-keys: the balance covers what the contract holds, but ${proof.accessKeys} access key(s) can still change the code.`,
  );
  process.exit(0);
}
console.error(`\nNOT VERIFIED:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
process.exit(1);
