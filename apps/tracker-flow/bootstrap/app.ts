import { Application, basePath } from "zerotal";
import { RequestContext } from "@zerotal/core";
import { I18nContext, LocaleMiddleware } from "@zerotal/i18n";
import { Auth } from "zerotal/auth";
import providers from "./providers";
import { Handler } from "../app/exceptions/Handler.ts";
import type { User } from "../app/models/User.ts";

declare module "zerotal/auth" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface UserModel extends User {}
}

/**
 * The locale this response renders in — the same rule the other two builds apply.
 *
 * There are no shared props here and no prop bag at all: a Flow page is a class
 * that renders itself, so a layout reads this directly.
 */
export function activeLocale(): string {
  const stored = (Auth.userOrNull() as { locale?: string | null } | undefined)?.locale;
  return stored ?? I18nContext.current() ?? "en";
}

/** The themes this build offers. */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Light or dark, read from a cookie.
 *
 * Flow *could* do this the Inertia way — a client store toggling a class with no
 * round trip — and the theme control on the profile page does exactly that for
 * the live page. The cookie is what survives a reload: the first paint of the
 * next request has to be right, and only something on the request can decide
 * that. So the toggle writes both.
 */
export function activeTheme(): Theme {
  const cookie = RequestContext.tryGet()?.request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)theme=([^;]+)/.exec(cookie);
  const value = match?.[1] ? decodeURIComponent(match[1]) : "";
  return value === "dark" ? "dark" : "light";
}

const app = Application.create({ providers })
  // Every request resolves a locale before anything renders — including the
  // guest screens, which is the point: a sign-in page that ignores
  // Accept-Language has already lost the reader it was translated for.
  .use([LocaleMiddleware])
  // Flow discovers pages by file. `app/flow/pages/projects/[project]/index.tsx`
  // is `/projects/:project`, the same URL the other two builds serve.
  .fileBasedRouting({ web: basePath("app/flow/pages") })
  // A second group for the endpoints that are not pages: a POST that signs you
  // out, and a GET that returns bytes. Neither has a UI to be reactive about, so
  // making them Flow components would be ceremony around a `Response`.
  .fileBasedRouting({ web: basePath("app/routes") })
  .withExceptionHandler(Handler);

export default app;
