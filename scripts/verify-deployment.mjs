#!/usr/bin/env node
// Read-only check of a deployed contract: which code runs there and who can still change it.
// It signs nothing and needs no key.
//
//   pnpm install --frozen-lockfile && pnpm build
//   node scripts/verify-deployment.mjs <contract-account> [--wasm <file>] [--allow-keys]
//
// Prints the account's code hash, the number of access keys, its balance and the principal the
// contract says it holds. Exits non-zero when:
//   - the account has an access key (somebody could still replace the code), unless --allow-keys;
//   - --wasm is given and the deployed code hash is not the SHA-256 of that file;
//   - the balance does not cover the principal the contract reports as held.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createReader, createRpc, explorerAccountUrl, formatNear } from '@ticket-escrow/client';
import { baseEncode } from 'near-api-js';

const DEFAULT_RPC_URLS = 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org';
const args = process.argv.slice(2);
const wasmFlag = args.indexOf('--wasm');
const wasmPath = wasmFlag === -1 ? undefined : args[wasmFlag + 1];
const allowKeys = args.includes('--allow-keys');
const contractId = args.find(
  (arg, index) => !arg.startsWith('--') && (wasmFlag === -1 || index !== wasmFlag + 1),
);

if (!contractId) {
  console.error(
    'usage: node scripts/verify-deployment.mjs <contract-account> [--wasm <file>] [--allow-keys]',
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

let held = 0n;
let events = 0;
for (let from = 0; ; from += config.max_page) {
  const page = await reader.listEvents(from, config.max_page);
  for (const event of page) {
    const books = await reader.getAccounting(event.event_id);
    held +=
      BigInt(books.principal_reserved) +
      BigInt(books.organizer_available) +
      BigInt(books.refund_pending) +
      BigInt(books.organizer_pending);
    events += 1;
  }
  if (page.length < config.max_page) break;
}

console.log(`Contract        ${contractId}  (${explorerAccountUrl(contractId)})`);
console.log(`Block height    ${proof.blockHeight} (final)`);
console.log(
  `Version         ${config.version}${config.fault_injection ? '  FAULT INJECTION BUILD' : ''}`,
);
console.log(`Code hash       ${proof.codeHash}`);
console.log(`Access keys     ${proof.accessKeys}`);
console.log(`Balance         ${formatNear(proof.balance, 6)} NEAR`);
console.log(`Principal held  ${formatNear(held.toString(), 6)} NEAR in ${events} event(s)`);

if (proof.accessKeys > 0 && !allowKeys) {
  problems.push(
    `${proof.accessKeys} access key(s): this deployment can still be changed by its key holder.`,
  );
}
if (config.fault_injection) {
  problems.push('The deployed code is a test build with fault injection.');
}
if (BigInt(proof.balance) < held) {
  problems.push('The balance is lower than the principal the contract reports as held.');
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
  console.log('\nOK: nobody holds a key to this contract and its balance covers what it holds.');
  process.exit(0);
}
console.error(`\nNOT VERIFIED:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
process.exit(1);
