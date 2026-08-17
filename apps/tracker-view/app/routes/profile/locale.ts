import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import type { User } from "@app/models/User.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { SUPPORTED_LOCALES } from "../../../config/i18n.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * POST /profile/locale — choose a language.
 *
 * The acceptable values are `SUPPORTED_LOCALES`, the same list the config
 * declares — a locale is the name of a catalog file, so accepting one the app
 * cannot load would leave every string falling back silently.
 *
 * Both the column and the cookie are written. The column is what the queue reads
 * when it renders mail hours later and what `UserLocaleMiddleware` applies on
 * every authenticated request; the cookie is what carries the choice into the
 * *signed-out* pages, so signing out does not silently revert someone to
 * English.
 */
export async function POST(http: HttpContext): Promise<void> {
  const { locale } = await validate(http, (r) => ({
    locale: r.string().in([...SUPPORTED_LOCALES]),
  }));

  const user = Auth.user() as User;
  user.locale = locale;
  await user.save();

  // Said in the language just chosen, which is the confirmation: if this
  // sentence arrives in the old language, the change did not take.
  http.flash("success", __("Language updated.", {}, locale));
  http.redirect(`${route("profile")}?section=language`, 303);

  // After `redirect()`, which is what assigns the response.
  http.response?.headers.append(
    "Set-Cookie",
    `locale=${encodeURIComponent(locale)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
  );
}
