import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { User } from "@app/models/User";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "../../config/i18n.ts";

// Only for signed-in visitors; everyone else is redirected to sign in.
export const middleware = [AuthMiddleware, UserLocaleMiddleware];

export const GET = async () => {
  const user = Auth.user() as User;

  return Inertia.render("profile", {
    title: "Your profile",
    // The switcher needs both: what is available, and what is currently chosen.
    // `null` is a real answer — it means "follow the request" — so it is passed
    // through rather than collapsed to the default.
    locales: SUPPORTED_LOCALES.map((code) => ({ code, name: LOCALE_NAMES[code] ?? code })),
    locale: user.locale ?? null,
  });
};

// Updates name and email. Changing the password is its own route, so a failure
// in one form never discards what was typed in the other.
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user() as User;

  const { name, email } = await validate(http, (r) => ({
    name: r.string().trim().min(2).max(80),
    email: r.string().trim().email(),
  }));

  // Someone else holding this address is the only conflict — keeping your own
  // is not a change at all.
  const taken = await User.query().where("email", email).first();
  if (taken && taken.id !== user.id) {
    http.flash("error", __("That email is already in use."));
    http.redirect("/profile", 303);
    return;
  }

  user.name = name;
  user.email = email;
  await user.save();

  http.flash("success", __("Details saved."));
  http.redirect("/profile", 303);
}
