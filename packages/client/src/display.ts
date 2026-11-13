import { sha256 } from '@noble/hashes/sha2.js';
import { base64Decode, base64Encode } from 'near-api-js';
import { z } from 'zod';
import { CLAIM_LABELS, formatAmount, type Unit } from './format.js';
import type { Claim, EventView, TicketView } from './schemas.js';

// What a wallet shows for a ticket: the NEP-177 metadata the contract derives at every read from
// the event and the ticket (plan v2, "The ticket shows its state"; contract/src/display.rs).

/** The only `media` this app shows: an SVG carried in the metadata itself. */
export const SVG_MEDIA_PREFIX = 'data:image/svg+xml;base64,';

/** A ticket as `nft_token` describes it. Each field is null when the metadata leaves it out. */
export interface TicketDisplay {
  title: string | null;
  description: string | null;
  /** `data:image/svg+xml;base64,…`, or null for any other or missing media. */
  media: string | null;
  /** Base64 SHA-256 of the SVG bytes, as the contract gives it. */
  mediaHash: string | null;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** NEP-171 `nft_token`: null for a ticket that does not exist. Only the fields shown are read. */
export const NftTokenSchema = z
  .object({
    metadata: z
      .object({
        title: z.string().nullish(),
        description: z.string().nullish(),
        // Checked below: a media this app does not show is dropped, never an error.
        media: z.unknown(),
        media_hash: z.string().nullish(),
      })
      .nullish(),
  })
  .nullable();

/** The display of a parsed `nft_token` answer; a media that is not an SVG data URL becomes null. */
export function ticketDisplayOf(token: z.output<typeof NftTokenSchema>): TicketDisplay | null {
  if (token === null) return null;
  const metadata = token.metadata;
  const raw = metadata?.media;
  const media =
    typeof raw === 'string' &&
    raw.startsWith(SVG_MEDIA_PREFIX) &&
    BASE64.test(raw.slice(SVG_MEDIA_PREFIX.length))
      ? raw
      : null;
  return {
    title: metadata?.title ?? null,
    description: metadata?.description ?? null,
    media,
    mediaHash: metadata?.media_hash ?? null,
  };
}

/**
 * Whether the picture is the one the contract hashed: SHA-256 of the SVG bytes in `media`, in
 * base64, equals `mediaHash`. False when either is missing or cannot be read.
 */
export function mediaMatchesHash(display: TicketDisplay): boolean {
  if (display.media === null || display.mediaHash === null) return false;
  try {
    const bytes = base64Decode(display.media.slice(SVG_MEDIA_PREFIX.length));
    return base64Encode(sha256(bytes)) === display.mediaHash;
  } catch {
    return false;
  }
}

// The drawing, mirrored from contract/src/display.rs (`ticket_svg`, `description`) so that demo
// mode shows what the chain shows. A test checks it byte for byte against a ticket read on testnet.

/** Characters of the title the drawn ticket shows before it cuts it with an ellipsis. */
const SVG_TITLE_CHARS = 26;

const ACCENTS: Readonly<Record<Claim, string>> = {
  Reserved: '#3b5bdb',
  Refundable: '#b35c00',
  RefundPending: '#b35c00',
  Refunded: '#2b8a3e',
  ReleasedToOrganizer: '#5c5f66',
};

/** `escape_xml`: markup characters escaped, control characters turned into spaces. */
function escapeXml(text: string): string {
  return Array.from(text, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return /\p{Cc}/u.test(character) ? ' ' : character;
    }
  }).join('');
}

/** `short_title`: at most 26 characters (code points, as Rust counts `chars`). */
function shortTitle(title: string): string {
  const characters = Array.from(title);
  if (characters.length <= SVG_TITLE_CHARS) return title;
  return `${characters.slice(0, SVG_TITLE_CHARS - 1).join('')}…`;
}

/** `ticket_svg`: the title, the serial, the amount and the claim word, in the claim's colour. */
export function drawTicket(title: string, serial: number, amount: string, claim: Claim): string {
  const accent = ACCENTS[claim];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180" viewBox="0 0 360 180">',
    `<rect x="2" y="2" width="356" height="176" rx="14" fill="#fbfaff" stroke="${accent}" stroke-width="3"/>`,
    `<line x1="284" y1="16" x2="284" y2="164" stroke="${accent}" stroke-width="2" stroke-dasharray="6 6"/>`,
    '<g font-family="system-ui,sans-serif" fill="#1b1b29">',
    `<text x="22" y="46" font-size="17" font-weight="700">${escapeXml(shortTitle(title))}</text>`,
    `<text x="22" y="74" font-size="13">Ticket ${serial}</text>`,
    `<text x="22" y="142" font-size="24" font-weight="700">${escapeXml(amount)}</text>`,
    '</g>',
    `<text x="322" y="90" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="${accent}" text-anchor="middle" transform="rotate(-90 322 90)">${CLAIM_LABELS[claim]}</text>`,
    '</svg>',
  ].join('');
}

/** `description`: which ticket it is, then one sentence on where its money stands. */
function describe(event: EventView, ticket: TicketView, amount: string): string {
  const state: Record<Claim, string> = {
    Reserved: `${amount} is reserved in the contract until the event is resolved.`,
    Refundable: `The event was not confirmed: whoever holds this ticket can claim ${amount}.`,
    RefundPending: `A refund of ${amount} is on its way to the holder.`,
    Refunded: `${amount} was refunded to the holder.`,
    ReleasedToOrganizer: 'The event was confirmed and the price went to the organizer.',
  };
  return `Ticket ${ticket.serial} of ${event.capacity} for ${event.title} at ${event.venue}. ${state[ticket.claim]}`;
}

/** What the contract would answer for this ticket now (`token_metadata`), for demo mode. */
export function ticketDisplayFor(event: EventView, ticket: TicketView, unit: Unit): TicketDisplay {
  const amount = formatAmount(ticket.principal, unit);
  const bytes = new TextEncoder().encode(
    drawTicket(event.title, ticket.serial, amount, ticket.claim),
  );
  return {
    title: `${event.title} - ticket ${ticket.serial}`,
    description: describe(event, ticket, amount),
    media: `${SVG_MEDIA_PREFIX}${base64Encode(bytes)}`,
    mediaHash: base64Encode(sha256(bytes)),
  };
}
