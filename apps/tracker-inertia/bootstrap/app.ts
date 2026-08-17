import { Application, basePath } from "zerotal";
import { I18nContext, LocaleMiddleware } from "@zerotal/i18n";
import { share } from "@zerotal/inertia";
import { Auth } from "zerotal/auth";
import providers from "./providers";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "../config/i18n.ts";
import zu from "../resources/lang/zu.json";
import { Handler } from "../app/exceptions/Handler";
import type { User } from "../app/models/User.ts";

// Tell @zerotal/auth which model `Auth.user()` returns. The empty body is the
// point: this augmentation exists to bind the type, not to add members.
declare module "zerotal/auth" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface UserModel extends User {}
}

/**
 * The catalogs, again — this time for the browser.
 *
 * `@zerotal/i18n` loads these itself for server-side `__()`. They are imported
 * here a second time because the React interface has to translate in the
 * browser, and it cannot reach into the server's Translator to do it. Sharing
 * the active locale's messages as a prop is what makes `useTranslate()` on the
 * client possible at all.
 *
 * There is no `en` entry, and that is the point: keys *are* the English, so a
 * catalog for it would be a file mapping 205 strings to themselves. English
 * falls through to `{}` below and every `__()` call returns its own argument.
 *
 * A larger app would ship one catalog per page rather than the whole thing on
 * every response. At this size the whole file is a couple of kilobytes and
 * splitting it would buy nothing but a build step.
 */
const CATALOGS: Record<string, Record<string, unknown>> = { zu };

/**
 * The locale this response should render in.
 *
 * The signed-in account's choice first, then whatever the global
 * `LocaleMiddleware` resolved from query, cookie or Accept-Language.
 *
 * Reading the user here rather than relying on `UserLocaleMiddleware` is
 * deliberate: that middleware sits on individual routes, so it establishes the
 * context for server-side `t()` on those routes only. Every page shares these
 * props, and a sidebar that translates on `/profile` but not on `/dashboard` is
 * worse than one that never translates at all.
 */
function activeLocale(): string {
  // `userOrNull()`, never `user()`. `Auth.user()` throws UnauthorizedError for a
  // guest, and this thunk runs on *every* page — including the sign-in screen —
  // so reaching for the throwing accessor turns every public page into a 401.
  const stored = (Auth.userOrNull() as { locale?: string | null } | undefined)?.locale;
  return stored ?? I18nContext.current() ?? "en";
}

// Thunks, not values: `share` evaluates them per request, which is the only
// reason a locale chosen mid-session shows up on the very next page.
share("locale", () => activeLocale());
// `{}` for English, and for any locale whose catalog has not been written yet:
// an empty catalog means every key resolves to itself, which is the English.
share("messages", () => CATALOGS[activeLocale()] ?? {});
// Static, but shared rather than imported by the picker: the public pages have
// no other route through which to learn what languages exist.
share("locales", () =>
  SUPPORTED_LOCALES.map((code) => ({ code, name: LOCALE_NAMES[code] ?? code })),
);

const app = Application.create({ providers })
  // Every request resolves a locale before anything renders — including the
  // guest screens, which is the point: a sign-in page that ignores
  // Accept-Language has already lost the reader it was translated for.
  .use([LocaleMiddleware])
  .fileBasedRouting({
    web: basePath("app/routes"),
  })
  // Renders 404s and other HTTP errors through resources/js/pages/error.tsx.
  .withExceptionHandler(Handler);

export default app;
