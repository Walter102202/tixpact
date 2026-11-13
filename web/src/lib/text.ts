const encoder = new TextEncoder();

/** Length in UTF-8 bytes: the unit the contract's text limits are written in. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** The error for text over a byte limit, or null when it fits. */
export function tooLong(label: string, text: string, max: number): string | null {
  const bytes = utf8Bytes(text);
  return bytes > max ? `The ${label} is ${bytes} bytes; the limit is ${max}.` : null;
}
