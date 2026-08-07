/**
 * `@zerotal/flow/compiler-helpers` — tiny HTML-escaping helpers imported by
 * AOT-compiled render functions. These are the only runtime dependency of the
 * generated `.zerotal/compiled/*.js` files and are not intended for direct use.
 *
 * @example
 * ```ts
 * // Emitted by the Flow compiler into a compiled render function:
 * html += "<p>" + __esc(this.name) + "</p>";
 * html += '<a href="' + __escAttr(this.url) + '">link</a>';
 * ```
 *
 * @packageDocumentation
 */

/** Escape a value for safe injection as HTML text content. */
export function __esc(v: unknown): string {
  if (v == null || v === false || v === true) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape a value for safe injection inside an HTML attribute (double-quoted). */
export function __escAttr(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
