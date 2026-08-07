/**
 * How a log entry's context is written for a human reader.
 *
 * `JSON.stringify` is the right answer for a collector and the wrong one for a
 * terminal: it escapes every backslash, so a Windows path arrives as
 * `"C:\\Projects\\app"`, and it spends braces and quotes on structure the reader
 * can already see. These helpers render the same data as `key=value` pairs with
 * strings left literal.
 */

/**
 * A value as the string a person should see.
 *
 * Strings pass through untouched — the whole point, since a path or a URL is
 * already in its readable form. Everything else gets the shortest faithful
 * rendering, falling back to JSON for objects and arrays.
 *
 * @example
 * displayValue("C:\\app"); // "C:\app"  (not "C:\\\\app")
 * displayValue({ a: 1 });  // '{"a":1}'
 */
export function displayValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular, or a toJSON that throws — a readable placeholder beats a crash
    // inside logging.
    return String(value);
  }
}

/**
 * Render a context bag as ` key=value` pairs for a terminal line.
 *
 * A value containing whitespace is quoted so the pairs stay separable by eye;
 * nothing else is escaped, which keeps `C:\Program Files\app` legible where a
 * JSON rendering would double every separator. Keys are dimmed when `dim` is
 * supplied, so they recede behind the values that carry the information.
 *
 * @param context Structured context from a {@link LogEntry}.
 * @param dim     ANSI dim escape, or "" to render without colour.
 * @param reset   ANSI reset escape, paired with `dim`.
 * @returns The rendered pairs, each preceded by a space; "" when there is nothing.
 *
 * @example
 * formatContext({ port: 3000, dir: "C:\\app" }, "", "");
 * // " port=3000 dir=C:\app"
 */
export function formatContext(
  context: Record<string, unknown>,
  dim = "\x1b[2m",
  reset = "\x1b[0m",
): string {
  return formatPairs(context, dim, reset)
    .map((pair) => ` ${pair}`)
    .join("");
}

/**
 * The same pairs as {@link formatContext}, one string each and unprefixed, so a
 * caller can lay them out itself — wrapping them onto continuation lines when
 * they would otherwise run off the terminal.
 *
 * @example
 * formatPairs({ port: 3000, env: "web" }, "", ""); // ["port=3000", "env=web"]
 */
export function formatPairs(
  context: Record<string, unknown>,
  dim = "\x1b[2m",
  reset = "\x1b[0m",
): string[] {
  return Object.entries(context).map(
    ([key, value]) => `${dim}${key}=${reset}${_quoted(displayValue(value))}`,
  );
}

/** Printable width of `text`, ignoring ANSI colour escapes (which take no space). */
export function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Quote only when whitespace would otherwise run two pairs together. */
function _quoted(text: string): string {
  if (text === "") return '""';
  if (!/\s/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
