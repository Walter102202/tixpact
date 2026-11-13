#!/usr/bin/env node
// Plays the product's two stories on NEAR testnet with accounts held by this script, checks every
// result against what the rules promise, and writes docs/proof.md with one link per transaction.
//
//   pnpm install --frozen-lockfile && pnpm build      (the script uses the built client package)
//   CONTRACT_ID=<contract> ORGANIZER_ID=<a> VERIFIER_ID=<b> ANA_ID=<c> LUIS_ID=<d> ANYONE_ID=<e> \
//     node scripts/demo-scenario.mjs
//
// Each account's key is read from the NEAR CLI legacy keychain: <account>.json inside
// ~/.near-credentials/testnet, or inside NEAR_CREDENTIALS_DIR. Nothing is printed from it.
// Testnet only. It takes about eight minutes, most of it waiting for the events' time windows.
// Exits non-zero if any step does not end as expected.

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actions,
  createReader,
  createRpc,
  explorerAccountUrl,
  explorerTxUrl,
  formatNear,
  parseNear,
  trackTransaction,
} from '@ticket-escrow/client';
import { Account, actions as near } from 'near-api-js';

const DEFAULT_RPC_URLS = 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org';
const PRICE = parseNear(process.env.PRICE_NEAR ?? '0.5');
const STARTS_IN_MS = Number(process.env.STARTS_IN_SECONDS ?? '150') * 1000;
const WINDOW_MS = 30_000;
const GAS_ALLOWANCE = parseNear('0.05');

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}. See the header of this file.`);
    process.exit(2);
  }
  return value;
}

const contractId = need('CONTRACT_ID');
const ids = {
  organizer: need('ORGANIZER_ID'),
  verifier: need('VERIFIER_ID'),
  ana: need('ANA_ID'),
  luis: need('LUIS_ID'),
  anyone: need('ANYONE_ID'),
};
for (const id of [contractId, ...Object.values(ids)]) {
  if (!id.endsWith('.testnet')) {
    console.error(`${id} is not a testnet account. This script only runs on testnet.`);
    process.exit(2);
  }
}

const credentialsDir =
  process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), '.near-credentials', 'testnet');
const rpc = createRpc((process.env.RPC_URLS ?? DEFAULT_RPC_URLS).split(','));
const reader = createReader({ contractId, rpc });

const signers = {};
for (const [role, accountId] of Object.entries(ids)) {
  const file = JSON.parse(await readFile(join(credentialsDir, `${accountId}.json`), 'utf8'));
  signers[role] = new Account(accountId, rpc, file.private_key);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = [];
let failures = 0;

function record(row) {
  rows.push({ ...row, number: rows.filter((r) => r.story === row.story).length + 1 });
  if (!row.pass) failures += 1;
  console.log(`${row.pass ? 'ok  ' : 'FAIL'} ${row.story} ${row.title}: ${row.observed}`);
}

/** Signs and sends one contract call, then judges it the way the web does: by hash, at final. */
async function send(role, call) {
  const response = await signers[role].signAndSendTransaction({
    receiverId: contractId,
    actions: [
      near.functionCall(call.methodName, call.args, BigInt(call.gas), BigInt(call.deposit)),
    ],
    waitUntil: 'EXECUTED_OPTIMISTIC',
    throwOnFailure: false,
  });
  const hash = response.transaction?.hash ?? response.transaction_outcome.id;
  const result = await trackTransaction(rpc, hash, ids[role], () => {});
  return { hash, ...result };
}

/** One transaction of a story. `expect` is `{ ok: true, value? }` or `{ code: 'ERR_...' }`. */
async function step(story, title, proves, role, call, expect) {
  const { hash, ok, value, failedReceipt } = await send(role, call);
  const code = failedReceipt?.error.code;
  const shown =
    value === undefined || value === null ? '' : `, returned \`${JSON.stringify(value)}\``;
  const observed = ok ? `succeeded${shown}` : `rejected with \`${code ?? 'UNKNOWN'}\``;
  const pass = expect.code
    ? !ok && code === expect.code
    : ok && (expect.value === undefined || value === expect.value);
  const expected = expect.code
    ? `rejected with \`${expect.code}\``
    : `succeeds${expect.value === undefined ? '' : `, returns \`${JSON.stringify(expect.value)}\``}`;
  record({ story, title, proves, signer: ids[role], expected, observed, pass, hash });
  return { ok, value };
}

/** One fact read from the chain at final finality, with no transaction. */
function check(story, title, proves, expected, observed, pass) {
  record({ story, title, proves, signer: 'read at final', expected, observed, pass, hash: null });
}

async function untilChainTime(eventId, targetMs, label) {
  for (;;) {
    const event = await reader.getEvent(eventId);
    const left = targetMs - event.now_ms;
    if (left < 0) return event;
    console.log(`     waiting ${Math.ceil(left / 1000)} s for ${label}`);
    await sleep(Math.min(left + 2000, 15_000));
  }
}

async function balanceOf(accountId) {
  return BigInt((await reader.getAccountProof(accountId)).balance);
}

async function createAcceptedEvent(story, title) {
  const starts = Date.now() + STARTS_IN_MS;
  const terms = {
    title,
    venue: 'Teatro Municipal',
    starts_at_ms: starts,
    ends_at_ms: starts + WINDOW_MS,
    resolution_deadline_ms: starts + 2 * WINDOW_MS,
    price: PRICE,
    capacity: 5,
    verifier_id: ids.verifier,
  };
  const budget = await reader.quoteEventBudget(terms.capacity);
  const created = await step(
    story,
    `Organizer creates "${title}" and prepays ${formatNear(budget)} NEAR of storage`,
    'R5, R9',
    'organizer',
    actions.createEvent(terms, budget),
    { ok: true },
  );
  const eventId = created.value;
  if (typeof eventId !== 'number') throw new Error('create_event did not return an event id');
  const event = await reader.getEvent(eventId);
  await step(
    story,
    'Verifier accepts the exact terms',
    'R4 · `t02_purchase_needs_acceptance_and_capacity`',
    'verifier',
    actions.acceptVerification(eventId, event.terms_hash),
    { ok: true },
  );
  return { eventId, terms };
}

async function buy(story, eventId) {
  const bought = await step(
    story,
    `Ana buys a ticket for ${formatNear(PRICE)} NEAR`,
    'R1, R4 · `t01_purchase_reserves_exact_price`',
    'ana',
    actions.buyTicket(eventId, PRICE),
    { ok: true },
  );
  if (typeof bought.value !== 'string') throw new Error('buy_ticket did not return a token id');
  const accounting = await reader.getAccounting(eventId);
  check(
    story,
    'The price is reserved in the contract, not paid to the organizer',
    'R1, R3',
    `principal_reserved = ${PRICE}, organizer_available = 0`,
    `principal_reserved = ${accounting.principal_reserved}, organizer_available = ${accounting.organizer_available}`,
    accounting.principal_reserved === PRICE && accounting.organizer_available === '0',
  );
  return bought.value;
}

// Story A: nobody confirms the event. The holder is refunded without the organizer.
async function organizerDisappears() {
  const story = 'A';
  const { eventId, terms } = await createAcceptedEvent(story, 'Jazz night');
  const tokenId = await buy(story, eventId);
  await step(
    story,
    'Organizer tries to collect before any confirmation',
    'R3 · `t03_organizer_cannot_withdraw_unresolved`',
    'organizer',
    actions.claimPayout(eventId),
    { code: 'ERR_NOT_COMPLETED' },
  );
  await step(
    story,
    `Ana transfers ticket ${tokenId} to Luis`,
    'R6 · `t07_refund_follows_the_holder`',
    'ana',
    actions.transferTicket(tokenId, ids.luis),
    { ok: true },
  );
  await untilChainTime(eventId, terms.resolution_deadline_ms, 'the deadline, with no confirmation');
  await step(
    story,
    'A stranger switches the event to refunds after the deadline',
    'R2 · `t05_anyone_expires_after_deadline`',
    'anyone',
    actions.expireEvent(eventId),
    { ok: true, value: 'Refundable' },
  );
  await step(
    story,
    'Ana, who sold the ticket, tries to claim the refund',
    'R1 · `t07_refund_follows_the_holder`',
    'ana',
    actions.claimRefund(tokenId),
    { code: 'ERR_UNAUTHORIZED' },
  );
  const before = await balanceOf(ids.luis);
  await step(
    story,
    `Luis, the holder, claims ${formatNear(PRICE)} NEAR`,
    'R1, R7 · `t09_refund_pays_exact_principal`',
    'luis',
    actions.claimRefund(tokenId),
    { ok: true, value: true },
  );
  const gained = (await balanceOf(ids.luis)) - before;
  check(
    story,
    "Luis's balance grew by the price, minus his own gas",
    'R1 · `t09_refund_pays_exact_principal`',
    `between ${formatNear((BigInt(PRICE) - BigInt(GAS_ALLOWANCE)).toString())} and ${formatNear(PRICE)} NEAR`,
    `${formatNear(gained.toString(), 6)} NEAR`,
    gained <= BigInt(PRICE) && gained >= BigInt(PRICE) - BigInt(GAS_ALLOWANCE),
  );
  await step(
    story,
    'Luis tries to claim the same ticket again',
    'R8 · `t08_no_double_refund`',
    'luis',
    actions.claimRefund(tokenId),
    { code: 'ERR_ALREADY_REFUNDED' },
  );
  const accounting = await reader.getAccounting(eventId);
  check(
    story,
    'The books close: refunded once, nothing left for the organizer',
    'R11 · accounting identity',
    `refunds_settled = ${PRICE}, principal_reserved = 0, organizer_available = 0`,
    `refunds_settled = ${accounting.refunds_settled}, principal_reserved = ${accounting.principal_reserved}, organizer_available = ${accounting.organizer_available}`,
    accounting.refunds_settled === PRICE &&
      accounting.principal_reserved === '0' &&
      accounting.organizer_available === '0',
  );
  return eventId;
}

// Story B: the verifier confirms the event. Only then is the organizer paid.
async function eventTakesPlace() {
  const story = 'B';
  const { eventId, terms } = await createAcceptedEvent(story, 'Opening night');
  const tokenId = await buy(story, eventId);
  await untilChainTime(eventId, terms.ends_at_ms, 'the end of the event');
  await step(
    story,
    'Verifier confirms the event took place',
    'R2 · `t04_attestation_completes_event`',
    'verifier',
    actions.attestCompleted(eventId, 'https://example.org/evidence/opening-night'),
    { ok: true },
  );
  await step(
    story,
    'Ana tries to claim a refund for an event that took place',
    'R2 · `t04_attestation_completes_event`',
    'ana',
    actions.claimRefund(tokenId),
    { code: 'ERR_NOT_REFUNDABLE' },
  );
  await step(
    story,
    `Organizer collects ${formatNear(PRICE)} NEAR`,
    'R3, R7 · `t18_payout_failure_paths`',
    'organizer',
    actions.claimPayout(eventId),
    { ok: true, value: true },
  );
  const accounting = await reader.getAccounting(eventId);
  check(
    story,
    'The books close: paid once to the organizer',
    'R11 · accounting identity',
    `organizer_settled = ${PRICE}, organizer_available = 0`,
    `organizer_settled = ${accounting.organizer_settled}, organizer_available = ${accounting.organizer_available}`,
    accounting.organizer_settled === PRICE && accounting.organizer_available === '0',
  );
  return eventId;
}

function table(story) {
  const head =
    '| # | Step | Signed by | Rule and test | Expected | Observed | Transaction |\n|---|---|---|---|---|---|---|\n';
  return (
    head +
    rows
      .filter((row) => row.story === story)
      .map((row) => {
        const link = row.hash ? `[${row.hash.slice(0, 8)}…](${explorerTxUrl(row.hash)})` : '';
        const mark = row.pass ? '' : ' **(NOT AS EXPECTED)**';
        return `| ${story}${row.number} | ${row.title} | \`${row.signer}\` | ${row.proves} | ${row.expected} | ${row.observed}${mark} | ${link} |`;
      })
      .join('\n')
  );
}

const startedAt = new Date().toISOString();
const proofBefore = await reader.getAccountProof(contractId);
console.log(`Contract ${contractId}, code hash ${proofBefore.codeHash}`);
const eventA = await organizerDisappears();
const eventB = await eventTakesPlace();
const proof = await reader.getAccountProof(contractId);
const books = {
  [`event ${eventA}`]: await reader.getAccounting(eventA),
  [`event ${eventB}`]: await reader.getAccounting(eventB),
};

const document = `# Proof: the two stories on NEAR testnet

Written by \`scripts/demo-scenario.mjs\` on ${startedAt}. Do not edit by hand: run the script again.

Contract: [\`${contractId}\`](${explorerAccountUrl(contractId)}), code hash \`${proof.codeHash}\`, ${proof.accessKeys} access key(s) at block ${proof.blockHeight}.

Every row is a real testnet transaction, judged by reading its status by hash at final finality and checking every receipt, or a view read at final finality. The accounts are demo accounts held by the script; the money is testnet NEAR. "Rule and test" names the rule in \`docs/design.md\` and the sandbox test that pins the same behaviour.

Result: ${failures === 0 ? 'every step ended as expected' : `${failures} step(s) did NOT end as expected`}.

## A. The organizer disappears

Nobody confirms the event. After the deadline anyone can switch it to refunds, and the refund goes to whoever holds the ticket.

${table('A')}

## B. The event takes place

The verifier agreed in advance confirms it. Only then can the organizer collect.

${table('B')}

## The books after the run

\`\`\`json
${JSON.stringify(books, null, 2)}
\`\`\`
`;

const output = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'proof.md');
await writeFile(output, document);
console.log(
  `\nWrote ${output}. ${failures === 0 ? 'All steps as expected.' : `${failures} FAILED.`}`,
);
process.exit(failures === 0 ? 0 : 1);
