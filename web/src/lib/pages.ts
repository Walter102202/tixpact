/** Page size asked of the contract; it answers with at most `min(limit, max_page)` items. */
export const PAGE_SIZE = 50;
/** A guard against a contract that never returns an empty page. */
const MAX_ITEMS = 2_000;

/**
 * Reads a paginated view to the end. It stops at the first empty page, not at a short one:
 * the contract may cap a page below the size asked (`max_page`).
 */
export async function readAllPages<T>(
  read: (fromIndex: number, limit: number) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  for (;;) {
    const page = await read(all.length, PAGE_SIZE);
    if (page.length === 0) return all;
    all.push(...page);
    if (all.length >= MAX_ITEMS) throw new Error(`stopped after ${MAX_ITEMS} items`);
  }
}
