import type { HttpContext } from "zerotal";
import { AuthMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { THEMES } from "../../../bootstrap/app.ts";

export const middleware = [AuthMiddleware];

/**
 * POST /profile/appearance — light or dark, stored where the server can read it.
 *
 * A cookie rather than `localStorage`, and that is the whole difference from the
 * Inertia build. The theme has to be known *before* the first byte of HTML is
 * written, because this build has no script to correct the class afterwards —
 * so the choice has to travel on the request, and only a cookie does that.
 *
 * Not written against the user row, unlike the locale. A theme belongs to the
 * screen you are reading on, not to the account: the same person on a laptop and
 * a phone can reasonably want different answers, and mail has no theme at all.
 */
export async function POST(http: HttpContext): Promise<void> {
  const { theme } = await validate(http, (r) => ({
    theme: r.string().in([...THEMES]),
  }));

  http.flash("success", __("Theme updated."));
  http.redirect(`${route("profile")}?section=appearance`, 303);

  // After `redirect()`, which is what assigns the response.
  http.response?.headers.append(
    "Set-Cookie",
    `theme=${encodeURIComponent(theme)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
  );
}
