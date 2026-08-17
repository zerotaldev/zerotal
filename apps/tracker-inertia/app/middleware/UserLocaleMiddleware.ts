import type { HttpContext, NextFn, Pipe } from "@zerotal/core";
import { I18nContext } from "@zerotal/i18n";
import { Auth } from "zerotal/auth";

/**
 * A signed-in person's stored language wins over the request's — feature 12.
 *
 * This is a second middleware rather than a fourth entry in the `resolvers`
 * chain in config/i18n.ts, and the reason is ordering: the resolvers run inside
 * `LocaleMiddleware`, which is registered globally and therefore runs *before*
 * auth has put a user on the request. A "user" resolver would be asking a
 * question nothing can answer yet.
 *
 * So the global middleware establishes a locale from query, cookie and header,
 * and this one — sitting on the authenticated routes, after `AuthMiddleware` —
 * re-enters the context with the account's own choice when there is one.
 *
 * Falling through when the user has no stored locale is the point: null is the
 * absence of a choice, not a vote for the default, so whatever the request
 * resolved to stands.
 */
export class UserLocaleMiddleware implements Pipe<HttpContext> {
  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    // `userOrNull()`: this only ever runs behind AuthMiddleware today, but a
    // middleware that throws on a guest is a trap for whoever reuses it.
    const locale = (Auth.userOrNull() as { locale?: string | null } | undefined)?.locale;
    if (!locale) return next();

    return I18nContext.run(locale, () => next());
  }
}
