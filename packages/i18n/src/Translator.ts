import { I18nContext } from "./I18nContext.ts";
import type { Catalogs, Messages, Replacements } from "./types.ts";

export interface TranslatorOptions {
  catalogs: Catalogs;
  defaultLocale: string;
  fallbackLocale: string;
}

/**
 * Resolves translation keys against per-locale catalogs, with fallback,
 * interpolation, and pluralization. Resolved from the container as `i18n`.
 */
export class Translator {
  private readonly catalogs: Catalogs;
  readonly defaultLocale: string;
  readonly fallbackLocale: string;

  constructor(opts: TranslatorOptions) {
    this.catalogs = opts.catalogs;
    this.defaultLocale = opts.defaultLocale;
    this.fallbackLocale = opts.fallbackLocale;
  }

  /** Loaded locales. */
  get locales(): string[] {
    return Object.keys(this.catalogs);
  }

  /** Merge messages into a locale's catalog (used by tooling/tests). */
  addCatalog(locale: string, messages: Messages): void {
    this.catalogs[locale] = { ...(this.catalogs[locale] ?? {}), ...messages };
  }

  /** Active locale: explicit arg → request context → default. */
  private _resolve(locale?: string): string {
    return locale ?? I18nContext.current() ?? this.defaultLocale;
  }

  /** True if `key` exists in the given (or active) locale or the fallback. */
  has(key: string, locale?: string): boolean {
    const loc = this._resolve(locale);
    return (
      this._lookup(key, loc) !== undefined || this._lookup(key, this.fallbackLocale) !== undefined
    );
  }

  /**
   * Translate `key`. Missing keys return the key itself (so the UI degrades
   * visibly rather than throwing).
   *
   * @example
   * t.translate('welcome.greeting', { name: 'Alice' }, 'fr');
   * t.translate('apples', { count: 2 }); // pipe-pluralized
   */
  translate(key: string, replacements: Replacements = {}, locale?: string): string {
    const loc = this._resolve(locale);
    let msg = this._lookup(key, loc);
    if (msg === undefined && loc !== this.fallbackLocale) {
      msg = this._lookup(key, this.fallbackLocale);
    }
    if (msg === undefined) return key;
    if (typeof replacements.count === "number") {
      msg = this._pluralize(msg, replacements.count);
    }
    return this._interpolate(msg, replacements);
  }

  /** Look up a key as a flat dotted key first, then as a nested path. */
  private _lookup(key: string, locale: string): string | undefined {
    const cat = this.catalogs[locale];
    if (!cat) return undefined;
    const flat = (cat as Record<string, unknown>)[key];
    if (typeof flat === "string") return flat;
    let node: unknown = cat;
    for (const part of key.split(".")) {
      if (node && typeof node === "object" && part in (node as object)) {
        node = (node as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return typeof node === "string" ? node : undefined;
  }

  /**
   * Choose a pipe-separated segment by count.
   *  - 2 segments: `singular | plural` (count === 1 → first).
   *  - 3+ segments: `zero | one | many` (count 0 → first, 1 → second, else last).
   */
  private _pluralize(message: string, count: number): string {
    const segs = message.split("|").map((s) => s.trim());
    if (segs.length === 1) return segs[0]!;
    if (segs.length === 2) return count === 1 ? segs[0]! : segs[1]!;
    if (count === 0) return segs[0]!;
    if (count === 1) return segs[1]!;
    return segs[segs.length - 1]!;
  }

  /** Replace `{name}` and `:name` placeholders from `replacements`. */
  private _interpolate(message: string, replacements: Replacements): string {
    return message.replace(/\{(\w+)\}|:(\w+)/g, (match, curly: string, colon: string) => {
      const key = curly ?? colon;
      return key in replacements ? String(replacements[key]) : match;
    });
  }
}
