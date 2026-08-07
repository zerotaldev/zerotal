import { deepMerge } from "@zerotal/core";
import type { Catalogs, LocaleResolver } from "./types.ts";

export interface I18nConfigShape {
  /** Locale used when no resolver matches. */
  defaultLocale: string;
  /** Locale consulted when a key is missing in the active locale. */
  fallbackLocale: string;
  /** Locales the app accepts; resolvers only return one of these. */
  supportedLocales: string[];
  /** Request resolvers, tried in order. Default: query -> cookie -> accept-header. */
  resolvers: LocaleResolver[];
  /** Query-string key for the `query` resolver. Default: `lang`. */
  queryKey: string;
  /** Cookie name for the `cookie` resolver. Default: `locale`. */
  cookieKey: string;
  /** Directory of `<locale>.json` catalogs, loaded on boot. */
  loadPath?: string;
  /** In-memory catalogs, merged over anything loaded from `loadPath`. */
  catalogs?: Catalogs;
}

/**
 * Build the i18n configuration block.
 *
 * @example
 * // config/i18n.ts
 * import { I18nConfig } from '@zerotal/i18n';
 * export default I18nConfig({
 *   supportedLocales: ['en', 'fr', 'es'],
 *   loadPath: 'resources/lang',
 * });
 */
export function I18nConfig(options: Partial<I18nConfigShape> = {}): I18nConfigShape {
  // `fallbackLocale` and `supportedLocales` default off the chosen `defaultLocale`,
  // so the defaults are computed before the merge. deepMerge then applies any
  // explicit overrides (and replaces the `supportedLocales`/`resolvers` arrays).
  const defaultLocale = options.defaultLocale ?? "en";
  const defaults: I18nConfigShape = {
    defaultLocale,
    fallbackLocale: defaultLocale,
    supportedLocales: [defaultLocale],
    resolvers: ["query", "cookie", "accept-header"],
    queryKey: "lang",
    cookieKey: "locale",
  };
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    i18n: I18nConfigShape;
  }
}
