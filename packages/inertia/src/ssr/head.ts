/**
 * Splicing server-rendered `<Head>` tags into the template's `<head>`.
 *
 * Inertia's head managers hand back an array of finished HTML strings — a
 * `<title>`, some `<meta>`, whatever the page's `<Head>` declared. Getting them
 * into the document looks like string concatenation and is not, because the
 * template already has a `<head>` with opinions in it.
 *
 * Appending is the obvious move and it is wrong. Every Zerotal template ships a
 * `<title>`, and a document with two titles is a document with the **first** one:
 * the app name, on every page. The tag the page rendered would be present in the
 * markup, correct, and ignored — which is a worse failure than not injecting at
 * all, because it looks like it worked. The same holds for
 * `<meta name="description">` and for the `og:` pair a link preview reads.
 *
 * So a rendered tag *replaces* the template's tag of the same identity, and only
 * tags with no counterpart are appended before `</head>`.
 *
 * @module
 */

/** The template's `<title>`, whatever it says. */
const TITLE_TAG = /<title\b[^>]*>[\s\S]*?<\/title>/i;

/**
 * Where injected tags go. The *first* occurrence closes the head — a later one is
 * page content (a template that documents its own markup has the literal string in
 * a code block), and splicing there puts the title in the body.
 */
const HEAD_CLOSE = "</head>";

/**
 * The identity of a `<meta>` tag: its `name` or `property`, lowercased.
 *
 * These are the two attributes that make one meta tag a replacement for another —
 * `name="description"`, `property="og:title"`. A meta with neither (`charset`,
 * `http-equiv`) has no identity to match on and is treated as unkeyed.
 *
 * @param tag - A rendered `<meta …>` tag.
 * @returns `{ attr, value }`, or `null` when the tag is not a keyed meta.
 */
function metaIdentity(tag: string): { attr: string; value: string } | null {
  const match = /^<meta\b[^>]*?\s(name|property)\s*=\s*["']([^"']*)["']/i.exec(tag);
  if (!match) return null;
  return { attr: match[1]!.toLowerCase(), value: match[2]! };
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inject rendered head tags into an HTML prefix, replacing what they supersede.
 *
 * @param prefix - The HTML up to the injection point — everything containing `<head>`.
 * @param head - Rendered head tags, as Inertia's head manager produces them.
 * @returns The prefix with the tags spliced in. Returned unchanged when `head` is empty.
 *
 * @example
 * ```ts
 * injectHead('<head><title>App</title></head>', ['<title>Trip to Kruger</title>']);
 * // → '<head><title>Trip to Kruger</title></head>'
 * ```
 */
export function injectHead(prefix: string, head: string[]): string {
  if (head.length === 0) return prefix;

  let html = prefix;
  const appended: string[] = [];

  for (const tag of head) {
    if (/^<title\b/i.test(tag)) {
      // A title always wins over the template's, and there is only ever one.
      if (TITLE_TAG.test(html)) {
        html = html.replace(TITLE_TAG, tag);
      } else {
        appended.push(tag);
      }
      continue;
    }

    const identity = metaIdentity(tag);
    if (identity) {
      const existing = new RegExp(
        `<meta\\b[^>]*\\b${identity.attr}\\s*=\\s*["']${escapeRegExp(identity.value)}["'][^>]*>`,
        "i",
      );
      if (existing.test(html)) {
        html = html.replace(existing, tag);
        continue;
      }
    }

    appended.push(tag);
  }

  if (appended.length === 0) return html;

  const close = html.indexOf(HEAD_CLOSE);
  // No `</head>` is a template we cannot reason about — a fragment, or one that
  // relies on the parser to close the head for it. Appending is still better than
  // dropping the tags, and it lands in the same place the parser would put them.
  if (close === -1) return html + appended.join("");

  return html.slice(0, close) + appended.join("") + html.slice(close);
}
