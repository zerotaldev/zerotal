import { I18nConfig } from "@zerotal/i18n";

/**
 * Two locales — feature 12.
 *
 * isiZulu as the second, not a placeholder: it is a real language with real
 * differences from English — different word order, different plurals — so a
 * string that only *looks* translated is obvious. A `fr.json` of English text
 * would prove nothing.
 *
 * The isiZulu strings in `resources/lang/zu.json` were written for this app and
 * have **not been reviewed by a first-language speaker**. They are correct
 * enough to prove the mechanism; they are not correct enough to ship to isiZulu
 * readers without someone who speaks it reading them first.
 *
 * The resolver chain is order-sensitive and this is deliberate:
 *
 *   query   — `?lang=af` wins, so a link can demonstrate a locale without an account
 *   cookie  — what the switcher writes, so the choice survives a reload
 *   header  — Accept-Language, for someone who has never chosen
 *
 * A signed-in user's stored `locale` is applied ahead of all three, by
 * `UserLocaleMiddleware`. It is not a resolver here because the resolver chain
 * runs before auth has put a user on the request — see the note in that file.
 */
/**
 * The catalogs that exist, named once.
 *
 * Exported because the settings route validates against this list — a locale is
 * the name of a catalog file, so accepting one the app cannot load would leave
 * every string silently falling back. Adding `fr.json` and listing it here is
 * the whole job.
 */
export const SUPPORTED_LOCALES = ["en", "zu"] as const;

export const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  zu: "isiZulu",
};

export default I18nConfig({
  defaultLocale: "en",
  fallbackLocale: "en",
  supportedLocales: [...SUPPORTED_LOCALES],
  resolvers: ["query", "cookie", "accept-header"],
  queryKey: "lang",
  cookieKey: "locale",
  loadPath: "resources/lang",
});
