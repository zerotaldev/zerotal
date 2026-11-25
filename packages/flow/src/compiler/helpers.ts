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

import { URL_ATTRIBUTES, sanitizeUrl } from "../urlSafety.ts";

/**
 * Escape a value for safe injection as HTML text content.
 *
 * @internal
 */
export function __esc(v: unknown): string {
  if (v == null || v === false || v === true) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape a value for safe injection inside an HTML attribute (double-quoted).
 *
 * @internal
 */
export function __escAttr(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * A whole attribute — leading space, name and quoted value — from a value worked out on the
 * server, written the way the runtime renderer writes it: `true` is the bare name, `false` and
 * nullish drop the attribute, and a URL-bearing attribute has its scheme checked, so
 * `href={user.website}` cannot carry `javascript:`.
 *
 * @internal
 */
export function __attr(name: string, v: unknown): string {
  if (v == null || v === false) return "";
  if (v === true) return ` ${name}`;
  const raw = String(v);
  const value = URL_ATTRIBUTES.has(name) ? sanitizeUrl(raw) : raw;
  return ` ${name}="${value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}"`;
}
