import type { HttpContext } from "zerotal";
import { Auth } from "zerotal/auth";
import { validate } from "zerotal/validator";
import type { User } from "@app/models/User.ts";
import { SUPPORTED_LOCALES } from "../../config/i18n.ts";

/** A year. The choice is a preference, not a session. */
const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * POST /locale — choose a language without an account.
 *
 * The resolver chain in `config/i18n.ts` already reads a `locale` cookie; until
 * now nothing wrote one, so a signed-out reader could only change language with
 * `?lang=zu` on every request. This is the missing half.
 *
 * A cookie rather than the session, deliberately. A language preference should
 * outlive a session and cost nothing to keep for someone who never signs in —
 * and it is not sensitive, so it is `SameSite=Lax` and readable, not `HttpOnly`.
 *
 * When someone *is* signed in the column is written too, and it wins: it is the
 * choice that travels to the queue, which has no cookies to read when it renders
 * their mail hours later. The cookie still gets set so the preference survives
 * signing out.
 */
export async function POST(http: HttpContext): Promise<void> {
  const { locale } = await validate(http, (r) => ({
    locale: r.string().in([...SUPPORTED_LOCALES]),
  }));

  const user = Auth.userOrNull() as User | undefined;
  if (user) {
    user.locale = locale;
    await user.save();
  }

  // Back where they were, so a switcher in the footer does not throw the reader
  // to the top of the site. `Referer` is absent on a direct POST; home is the
  // only honest fallback.
  const back = http.request.headers.get("Referer") ?? "/";
  http.redirect(back, 303);

  // After the response exists — `redirect()` is what assigns it.
  http.response?.headers.append(
    "Set-Cookie",
    `locale=${encodeURIComponent(locale)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`,
  );
}
