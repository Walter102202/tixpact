#!/usr/bin/env node
// Entry passes from the command line: check one exactly as the door page does, or make one with the
// NEAR CLI alone. It signs nothing and sends nothing; `verify` only reads the chain.
//
//   pnpm install --frozen-lockfile && pnpm --filter @ticket-escrow/client build
//
//   CONTRACT_ID=<contract> node scripts/pass.mjs verify '<pass or door link>'
//       Prints the five checks, one per line ("ok" or "NO" and the sentence), then ADMIT or
//       DO NOT ADMIT. Exits 0 when it admits, 1 when it does not.
//
//   CONTRACT_ID=<contract> node scripts/pass.mjs request --ticket <id> --account <holder>
//       Prints the message and nonce to sign, the NEAR CLI command that signs them and the
//       command below that turns the CLI's answer into a pass.
//
//   near message sign-nep413 ... | CONTRACT_ID=<contract> node scripts/pass.mjs encode \
//       --ticket <id> --issued <ISO time or ms> --nonce <base64>
//       Reads the JSON the NEAR CLI prints on stdin and prints the pass (and the door link when
//       SITE_URL is set). Exits 1 when the signature does not match what the flags describe.
//
// RPC_URLS: comma-separated endpoints, as in the other scripts.

import {
  checkPass,
  createPassChain,
  createReader,
  createRpc,
  decodePass,
  doorUrl,
  encodePass,
  passMessage,
  passRequest,
} from '@ticket-escrow/client';
import { base64Encode } from 'near-api-js';

const DEFAULT_RPC_URLS = 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org';
const USAGE = `usage:
  CONTRACT_ID=<contract> node scripts/pass.mjs verify '<pass or door link>'
  CONTRACT_ID=<contract> node scripts/pass.mjs request --ticket <id> --account <holder>
  <near CLI output> | CONTRACT_ID=<contract> node scripts/pass.mjs encode --ticket <id> --issued <time> --nonce <base64>`;

const [command, ...rest] = process.argv.slice(2);

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function flag(name) {
  const at = rest.indexOf(`--${name}`);
  const value = at === -1 ? undefined : rest[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`missing --${name}\n${USAGE}`);
  return value;
}

function contractId() {
  const id = process.env.CONTRACT_ID?.trim();
  if (!id) fail(`CONTRACT_ID is required: the contract the pass must name.\n${USAGE}`);
  return id;
}

/** `2026-11-13T16:30:00.000Z` or milliseconds. */
function issuedMs(text) {
  const ms = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  if (!Number.isSafeInteger(ms) || ms < 0) fail(`--issued is not a time: ${text}`);
  return ms;
}

/** The first JSON object in the text: the CLI may print words around it. */
function cliAnswer(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start)
    fail('stdin holds no JSON object: pipe in what the NEAR CLI printed.', 1);
  let json;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    fail('the JSON on stdin cannot be read: pipe in what the NEAR CLI printed.', 1);
  }
  const accountId = json.accountId ?? json.account_id;
  const publicKey = json.publicKey ?? json.public_key;
  const { signature } = json;
  if (
    typeof accountId !== 'string' ||
    typeof publicKey !== 'string' ||
    typeof signature !== 'string'
  ) {
    fail('the JSON on stdin needs accountId, publicKey and signature.', 1);
  }
  return { accountId, publicKey, signature };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** A chain that admits everything: `encode` checks the signature alone, before anyone reads the chain. */
const offline = { accessKey: async () => 'full', ticket: async () => null };

async function verify() {
  const text = rest[0];
  if (!text) fail(USAGE);
  const contract = contractId();
  const pass = decodePass(text);
  if (pass === null) {
    console.log(
      'NO  pass       This is not an entry pass, or it is damaged. Ask the holder to show it again.',
    );
    console.log('DO NOT ADMIT');
    process.exit(1);
  }
  const rpc = createRpc((process.env.RPC_URLS ?? DEFAULT_RPC_URLS).split(','));
  const chain = createPassChain(createReader({ contractId: contract, rpc }), rpc);
  const { admitted, checks } = await checkPass(pass, contract, chain, Date.now());
  console.log(
    `Ticket ${pass.ticket} on ${contract}, signed by ${pass.account} at ${new Date(pass.issuedAtMs).toISOString()}`,
  );
  for (const check of checks) {
    console.log(`${check.ok ? 'ok' : 'NO'}  ${check.id.padEnd(9)}  ${check.detail}`);
  }
  console.log(admitted ? 'ADMIT' : 'DO NOT ADMIT');
  process.exit(admitted ? 0 : 1);
}

function request() {
  const contract = contractId();
  const ticket = flag('ticket');
  const account = flag('account');
  const req = passRequest({ contract, ticket, issuedAtMs: Date.now() });
  const nonce = base64Encode(req.nonce);
  const issued = new Date(req.issuedAtMs).toISOString();
  // Bash ANSI-C quoting keeps the line breaks; account ids and ISO times hold no quotes.
  const message = `$'${req.message.replaceAll('\n', '\\n')}'`;
  console.log(`Message  ${JSON.stringify(req.message)}`);
  console.log(`Nonce    ${nonce}`);
  console.log(`Issued   ${issued} (the pass admits for five minutes from then)\n`);
  console.log('Sign it, then turn the answer into a pass:\n');
  console.log(
    `near message sign-nep413 utf8 ${message} nonce '${nonce}' recipient ${contract} sign-as ${account} sign-with-legacy-keychain network-config testnet \\`,
  );
  console.log(
    `  | CONTRACT_ID=${contract} node scripts/pass.mjs encode --ticket ${ticket} --issued ${issued} --nonce '${nonce}'`,
  );
}

async function encode() {
  const contract = contractId();
  const ticket = flag('ticket');
  const issuedAtMs = issuedMs(flag('issued'));
  const nonce = flag('nonce');
  const signed = cliAnswer(await readStdin());
  const draft = {
    v: 1,
    contract,
    ticket,
    account: signed.accountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
    nonce,
    issuedAtMs,
  };
  // Through decodePass, so the pass printed is one the door can read.
  const pass = decodePass(encodePass(draft));
  if (pass === null)
    fail('these values do not make a pass: check --ticket, --nonce and the JSON.', 1);
  const [signature] = (await checkPass(pass, contract, offline, issuedAtMs)).checks;
  if (!signature?.ok) {
    fail(
      `${signature?.detail}\nThe CLI must sign exactly this message with --nonce as its nonce:\n${passMessage(pass)}`,
      1,
    );
  }
  console.log(encodePass(pass));
  const site = process.env.SITE_URL?.trim();
  if (site) console.log(doorUrl(site, pass));
}

switch (command) {
  case 'verify':
    await verify();
    break;
  case 'request':
    request();
    break;
  case 'encode':
    await encode();
    break;
  default:
    fail(USAGE);
}
