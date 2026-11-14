# Proof: an entry pass, signed and checked on testnet

On 2026-11-13 the holder of ticket `9-1` on [`ticket-escrow-v2.testnet`](https://testnet.nearblocks.io/address/ticket-escrow-v2.testnet) signed an entry pass with the NEAR CLI, and it was checked three ways: from the command line, by the door page of the web app reading the same contract, and again after it expired and after it was altered. A pass is a signed message (NEP-413), so there is no transaction to link: the evidence is the pass itself, printed below, which anyone can check again.

What a pass proves and what it does not: [threat model, "Entry pass"](threat-model.md#entry-pass).

## The accounts

| Role | Account |
|---|---|
| Contract | `ticket-escrow-v2.testnet` |
| Holder of ticket `9-1` ("Jury night", an event confirmed by a group) | `te-d1-ana.testnet`, an account we hold |

## 1. The holder signs

`scripts/pass.mjs request` prints the message, a nonce that starts with the time, and the command that signs them. No key is read by our code: the NEAR CLI (near-cli-rs 0.31.1) signs with the holder's key from its own keychain.

```bash
CONTRACT_ID=ticket-escrow-v2.testnet node scripts/pass.mjs request --ticket 9-1 --account te-d1-ana.testnet
```

```text
Message  "Entry pass\nContract: ticket-escrow-v2.testnet\nTicket: 9-1\nIssued: 2026-11-13T20:03:57.569Z"
Nonce    AAABodaCegG4DSdGT5CjKjm8wcuCmqBirC+mcVCtaxo=
Issued   2026-11-13T20:03:57.569Z (the pass admits for five minutes from then)

Sign it, then turn the answer into a pass:

near message sign-nep413 utf8 $'Entry pass\nContract: ticket-escrow-v2.testnet\nTicket: 9-1\nIssued: 2026-11-13T20:03:57.569Z' nonce 'AAABodaCegG4DSdGT5CjKjm8wcuCmqBirC+mcVCtaxo=' recipient ticket-escrow-v2.testnet sign-as te-d1-ana.testnet sign-with-legacy-keychain network-config testnet \
  | CONTRACT_ID=ticket-escrow-v2.testnet node scripts/pass.mjs encode --ticket 9-1 --issued 2026-11-13T20:03:57.569Z --nonce 'AAABodaCegG4DSdGT5CjKjm8wcuCmqBirC+mcVCtaxo='
```

The pass that came out (467 characters; it holds the contract, the ticket, the account, the public key, the signature, the nonce and the time, and no secret):

```text
eyJ2IjoxLCJjb250cmFjdCI6InRpY2tldC1lc2Nyb3ctdjIudGVzdG5ldCIsInRpY2tldCI6IjktMSIsImFjY291bnQiOiJ0ZS1kMS1hbmEudGVzdG5ldCIsInB1YmxpY0tleSI6ImVkMjU1MTk6REgxVTRXSzU4MnlNUFlKaVdWdHRDaFJOY3REa1pucVZpSjE1YzU5YXc0N00iLCJzaWduYXR1cmUiOiJlZDI1NTE5OjRVRlpLQlpYYlJQR1VkQ3RIajlIa3k0b2RYcXV1WWZ6eHBINERqa0FYUGhFZW95cGpvdzFzV0xNV2Z4UWNwZHNISnVadUw5TEtZdGhXOG5UYmQyR1c0R2IiLCJub25jZSI6IkFBQUJvZGFDZWdHNERTZEdUNUNqS2ptOHdjdUNtcUJpckMrbWNWQ3RheG89IiwiaXNzdWVkQXRNcyI6MTc5NDYwMDIzNzU2OX0
```

## 2. The door admits it

Thirty-three seconds after signing, from the command line:

```bash
CONTRACT_ID=ticket-escrow-v2.testnet node scripts/pass.mjs verify '<the pass above>'
```

```text
Ticket 9-1 on ticket-escrow-v2.testnet, signed by te-d1-ana.testnet at 2026-11-13T20:03:57.569Z
ok  signature  The pass names ticket-escrow-v2.testnet and its signature checks out.
ok  key        The signing key is a full-access key of te-d1-ana.testnet.
ok  holder     te-d1-ana.testnet holds ticket 9-1.
ok  ticket     Ticket 9-1 is active and has not been refunded.
ok  fresh      Signed 33 s ago; it admits for 4 min 26 s more.
ADMIT
```

Forty seconds after signing, the web app's door page (`/door`, run locally against the same contract) showed, as read from the page:

```text
Admit
Ticket 9-1 · te-d1-ana.testnet
This device now remembers ticket 9-1 as admitted at 17:04:38: any other pass for it reads "Do not admit" here.
Checked at 17:04:38.
ok Signature, ok Key, ok Holder, ok Ticket, ok Fresh (Signed 40 s ago; it admits for 4 min 19 s more.)
```

## 3. The same pass, shown again at the same door

"Check again" on that page, five seconds later. The five checks still passed; the device's own record refused it:

```text
Do not admit
Ticket 9-1 · te-d1-ana.testnet
Already admitted on this device at 17:04:38.
Checked at 17:04:43.
```

"Undo: scanned by mistake" then answered "Admission removed. This device no longer remembers ticket 9-1 as admitted."

## 4. The same pass after its five minutes

```text
Ticket 9-1 on ticket-escrow-v2.testnet, signed by te-d1-ana.testnet at 2026-11-13T20:03:57.569Z
ok  signature  The pass names ticket-escrow-v2.testnet and its signature checks out.
ok  key        The signing key is a full-access key of te-d1-ana.testnet.
ok  holder     te-d1-ana.testnet holds ticket 9-1.
ok  ticket     Ticket 9-1 is active and has not been refunded.
NO  fresh      This pass expired 21 s ago: a pass admits for 5 minutes after it is signed. Ask the holder to sign a new one.
DO NOT ADMIT
```

**This is what you will see if you run the command of step 2 today**, with a longer time in the `fresh` line: four checks read from the chain pass for as long as `te-d1-ana.testnet` keeps the ticket and the key, and the pass no longer admits.

## 5. The pass, altered

The ticket changed to `6-1`, which the same account also holds. The signature covers the ticket, so it fails:

```text
Ticket 6-1 on ticket-escrow-v2.testnet, signed by te-d1-ana.testnet at 2026-11-13T20:03:57.569Z
NO  signature  The signature does not match this pass: it was altered or signed by another key. Ask the holder to sign a new pass.
ok  key        The signing key is a full-access key of te-d1-ana.testnet.
ok  holder     te-d1-ana.testnet holds ticket 6-1.
ok  ticket     Ticket 6-1 is active and has not been refunded.
DO NOT ADMIT
```

The account changed to `te-d1-luis.testnet`. NEP-413 does not sign the account name, so the signature still matches; the key read from the chain is what refuses it:

```text
Ticket 9-1 on ticket-escrow-v2.testnet, signed by te-d1-luis.testnet at 2026-11-13T20:03:57.569Z
ok  signature  The pass names ticket-escrow-v2.testnet and its signature checks out.
NO  key        The key that signed this pass is not a key of te-d1-luis.testnet now: it was deleted or never belonged to it. Ask the holder to sign a new pass.
NO  holder     te-d1-luis.testnet signed this pass but no longer holds ticket 9-1. The holder is te-d1-ana.testnet.
ok  ticket     Ticket 9-1 is active and has not been refunded.
DO NOT ADMIT
```

Both were checked while the pass was still fresh; the `fresh` line is left out here.

## What this shows and what it does not

- A pass made with the NEAR CLI alone, with no code of ours touching a key, is admitted by our checker: the format is the standard one.
- The verdict depends on the chain at the moment of the check, not on what the pass says about itself.
- It does not show a pass signed by a browser wallet. One was walked through by hand on 2026-11-14 with Meteor Wallet on the hosted site, and the door page answered "Admit" ([README, Limits, 10](../README.md#limits)); it is not recorded here. A pass scanned by a phone's camera has not been tried. In the web app's demo mode the pass is signed with a built-in demo key ([README, "Try it", step 7](../README.md#try-it)).
- The accounts are ours. The other refusals (a refunded ticket, a ticket given away after signing, a deleted key, a function-call key, a forged signature for a small-order key) are tested in `packages/client/src/pass.test.ts`, not played here.
- The agent's own pass, signed with its key and checked the same way, is in [`docs/mcp.md`](mcp.md), under "Verification".
