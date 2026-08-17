/**
 * Translating in the browser.
 *
 * `__("Email")` — an ordinary function call, importable anywhere. Not a hook,
 * and deliberately so: a hook can only be called from a component body, which
 * meant every helper, every `const OPTIONS = [...]` and every layout assigned
 * outside a render had to either thread a `t` down to itself or give up on being
 * translated. That restriction is what produced the `titleKey` props and the
 * arrays of key fragments this app used to carry.
 *
 * The key is the English sentence — `__("Email")`, not `__("auth.email")`.
 * English is the source language, so the source text is the key: there is no
 * `en.json`, no naming argument, and a string nobody has translated yet renders
 * as the words that were typed rather than as `nav.projects`.
 *
 * **How it stays current without React.** The catalog below is module state, fed
 * by `syncTranslations()` from the `resolve()` callback in `app.tsx` — which
 * Inertia calls with the incoming page *before* it swaps the component in. Every
 * render therefore sees the catalog for the page being rendered, including the
 * layouts that wrap it.
 *
 * The two rejected alternatives, so nobody re-litigates them:
 *
 *   `router.on("navigate")` — fires *after* the component swap, so the first
 *     render after a language change would still be in the old language.
 *   reading Inertia's `page` singleton — correct, but it is not exported from
 *     the package root, so it is a private path that an upgrade may remove.
 *
 * This app has no Inertia SSR (`config/inertia.ts` configures no `ssr` entry),
 * so module state is per-browser-tab. Adding SSR would make this shared between
 * concurrent requests — at which point the catalog has to move into a per-render
 * context instead.
 *
 * The rules here mirror `@zerotal/i18n`'s `Translator` exactly, because the same
 * string can be rendered by either side — a flash message is translated on the
 * server, the label above it in the browser — and a rule that held on only one
 * of them would show up as one translated sentence next to one untranslated one.
 */

type Messages = Record<string, unknown>;
type Replacements = Record<string, string | number>;

let catalog: Messages = {};
let activeLocale = "en";

/**
 * Point the translator at a page's locale and catalog.
 *
 * Called from `resolve()` on every visit. `messages` is left alone when the
 * incoming page does not carry it: a partial reload (`router.reload({ only })`)
 * sends only the props it was asked for, and treating that absence as an empty
 * catalog would blank every translated string on the page.
 */
export function syncTranslations(page: { props?: unknown } | undefined): void {
  // Structurally typed rather than Inertia's `Page`: that type lives in
  // `@inertiajs/core`, which this app does not depend on directly.
  const props = page?.props as { locale?: string; messages?: Messages } | undefined;
  if (!props) return;

  if (typeof props.locale === "string") activeLocale = props.locale;
  if (props.messages && typeof props.messages === "object") catalog = props.messages;
}

/**
 * Flat first, then nested.
 *
 * An English key is a sentence, and sentences contain dots: "Signed out." would
 * be split into a `Signed out` → `` path that no catalog has. Nested traversal
 * remains as a fallback so a grouped catalog still resolves.
 */
function lookup(messages: Messages, key: string): string | undefined {
  const flat = messages[key];
  if (typeof flat === "string") return flat;

  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Choose a pipe-separated segment by count.
 *  - 2 segments: `singular | plural` (count === 1 → first).
 *  - 3+ segments: `zero | one | many` (count 0 → first, 1 → second, else last).
 */
function pluralize(message: string, count: number): string {
  const segments = message.split("|").map((segment) => segment.trim());
  if (segments.length === 1) return segments[0]!;
  if (segments.length === 2) return count === 1 ? segments[0]! : segments[1]!;
  if (count === 0) return segments[0]!;
  if (count === 1) return segments[1]!;
  return segments[segments.length - 1]!;
}

export function translate(messages: Messages, key: string, replacements?: Replacements): string {
  // A missing entry falls through to the key, which *is* the English message —
  // and then goes on to be pluralized and interpolated like any other hit. That
  // last part is the whole reason the default locale needs no catalog.
  let message = lookup(messages, key) ?? key;

  if (typeof replacements?.count === "number") {
    message = pluralize(message, replacements.count);
  }
  if (!replacements) return message;

  // `{name}` — the same placeholder syntax the server's catalogs use, so one
  // string can be rendered by either side without being written twice.
  return message.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in replacements ? String(replacements[token]) : whole,
  );
}

/**
 * Translate an English source string.
 *
 * The same name, signature and semantics as `@zerotal/i18n`'s server-side
 * `__()`, so a string can be moved between a route and a component without
 * being rewritten.
 *
 * @example
 * __("Email");
 * __("{count} comment|{count} comments", { count: issue.comments });
 */
export function __(text: string, replacements?: Replacements): string {
  return translate(catalog, text, replacements);
}

/**
 * Installed on `globalThis`, so no component imports it.
 *
 * The server gets its `__()` from `I18nProvider` at boot; the browser has no
 * provider to boot, so the module that owns the browser translator installs it
 * itself. `app.tsx` imports this module for `syncTranslations`, which is what
 * guarantees the assignment has run before any page is resolved.
 *
 * There is no second type declaration for it. This app is one TypeScript
 * program, so `@zerotal/i18n`'s ambient `__` already covers these call sites —
 * and declaring another `var __` here would be a duplicate identifier, not an
 * override. The one difference is that the server's signature accepts a third
 * `locale` argument which this implementation ignores; the browser holds one
 * locale's catalog at a time, so there is nothing for it to select.
 */
(globalThis as { __?: typeof __ }).__ = __;

/** The active locale, for `lang` attributes and date formatting. */
export function currentLocale(): string {
  return activeLocale;
}
