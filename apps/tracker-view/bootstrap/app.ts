import { Application, basePath } from "zerotal";
import { RequestContext } from "@zerotal/core";
import { I18nContext, LocaleMiddleware } from "@zerotal/i18n";
import { Auth } from "zerotal/auth";
import providers from "./providers";
import { Handler } from "../app/exceptions/Handler.tsx";
import type { User } from "../app/models/User.ts";

declare module "zerotal/auth" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface UserModel extends User {}
}

/**
 * The locale this response renders in — the same rule the Inertia build applies,
 * expressed where a server-rendered app can reach it.
 *
 * There are no shared props here: every page is rendered by its own route, so
 * the layout reads this directly rather than receiving it through a prop bag.
 */
export function activeLocale(): string {
  const stored = (Auth.userOrNull() as { locale?: string | null } | undefined)?.locale;
  return stored ?? I18nContext.current() ?? "en";
}

/** The themes this build offers. `system` is absent — see `activeTheme()`. */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Light or dark, read from a cookie the server can see.
 *
 * The Inertia build keeps this choice in `localStorage` and flips a class with a
 * script. Neither is available here, so the choice moves to where a server can
 * read it: a cookie, applied to `<html>` while the page is being built. It works
 * with JavaScript off, and there is no flash of the wrong theme because the
 * markup never had the other one.
 *
 * What is lost is "follow the system": that answer only exists in the browser,
 * via `prefers-color-scheme`, and a server has no way to ask. So this build
 * offers the two explicit choices and defaults to light rather than pretending
 * to a third option it cannot honour.
 *
 * `tryGet()` rather than `get()`: this is called from layouts, and a layout
 * rendered outside a request — a test, a mail preview — should fall back rather
 * than throw.
 */
export function activeTheme(): Theme {
  const cookie = RequestContext.tryGet()?.request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)theme=([^;]+)/.exec(cookie);
  const value = match?.[1] ? decodeURIComponent(match[1]) : "";
  return value === "dark" ? "dark" : "light";
}

/**
 * There is no `__()` here any more.
 *
 * This app used to define its own, binding `activeLocale()` per call, because
 * the package's `__()` reads the ambient `I18nContext` — which `LocaleMiddleware`
 * fills from query, cookie and Accept-Language, but *not* from the signed-in
 * account's stored choice. That is `UserLocaleMiddleware`'s job, and it applies
 * only on routes that mount it.
 *
 * The gap was one route: `logout` was authenticated without mounting it. Adding
 * it there closes the difference — every route where a user exists now enters
 * the context with their locale — so `I18nProvider`'s injected global `__()` is
 * correct everywhere, and a second helper that behaves *almost* identically is
 * one more thing to pick wrongly.
 *
 * `activeLocale()` stays: `<html lang>` wants the code, not a message.
 */
const app = Application.create({ providers })
  .use([LocaleMiddleware])
  .fileBasedRouting({ web: basePath("app/routes") })
  .withExceptionHandler(Handler);

export default app;
