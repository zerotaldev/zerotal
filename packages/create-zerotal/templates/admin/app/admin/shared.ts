/** Formatting helpers shared by the resources. */

/** Render minor units as money — prices are stored as integers, never floats. */
export function money(value: unknown, currency = "USD"): string {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Trim a value to `n` characters with an ellipsis, for table cells. */
export function excerpt(value: unknown, n = 60): string {
  const s = String(value ?? "").trim();
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

/** Make a URL slug from arbitrary text. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Coerce an empty form value to null, for nullable columns. */
export function nullIfEmpty(value: unknown): unknown {
  return value === "" || value == null ? null : value;
}

/** Format a timestamp column as a relative time. */
export function humanDate(value: unknown): string {
  const c = value as { diffForHumans?: () => string } | null | undefined;
  return c?.diffForHumans ? c.diffForHumans() : "—";
}
