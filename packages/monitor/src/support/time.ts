/** Time + number formatting helpers shared across the store and UI. */

/** Human "x ago" string from a millisecond timestamp. */
export function ago(tsMs: number): string {
  const s = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Thousands-separated integer. */
export function commas(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Signed percentage delta between current and previous values. */
export function delta(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}
