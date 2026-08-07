/**
 * HTML escaping for server-rendered output — the framework's one escaper.
 *
 * Delegates to `Bun.escapeHTML`, which is SIMD-optimized and escapes the full
 * set (`&` `<` `>` `"` `'`, emitting `&#x27;` for the apostrophe). Safe for
 * both text content and double-quoted attribute values; both JSX runtimes and
 * the docs app render through it, so it runs on every SSR text child.
 */
export function escapeHtml(value: string): string {
  return Bun.escapeHTML(value);
}
