/**
 * Page-number window for rendering a numbered pager, with `'...'` gaps —
 * e.g. `[1, '...', 4, 5, 6, '...', 20]`. The first and last pages are always
 * included. Shared by every paginator result (`Model.paginate()`, the in-memory
 * helper) so a pager renders identically whatever produced the page.
 *
 * @param current - The current 1-based page.
 * @param last - The last page number.
 * @param each - How many page links to show on each side of the current page (default `1`).
 * @returns Page numbers interleaved with `'...'` for elided ranges.
 *
 * @internal
 */
export function pageElements(current: number, last: number, each = 1): (number | "...")[] {
  if (last <= 1) return [1];
  each = Math.max(0, each);
  const wanted = new Set<number>([1, last]);
  for (let p = current - each; p <= current + each; p++) {
    if (p >= 1 && p <= last) wanted.add(p);
  }
  const out: (number | "...")[] = [];
  let prev = 0;
  for (const p of [...wanted].sort((a, b) => a - b)) {
    if (prev && p - prev > 1) out.push("...");
    out.push(p);
    prev = p;
  }
  return out;
}
