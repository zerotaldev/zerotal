import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware, Hash } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { User } from "@app/models/User";

export const middleware = [AuthMiddleware];

// POST /profile/password
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user() as User;

  const { current_password, password } = await validate(http, (r) => ({
    current_password: r.string().min(1),
    // The match is checked on the confirmation, not on the password.
    // `confirmed()` here files the mismatch under `password`, so it rendered
    // beneath the Password box while the Confirm box — which already has an
    // error slot wired up in the form — could never show anything at all.
    password: r.string().min(8),
    password_confirmation: r.string().sameAs("password"),
  }));

  // Proving the current password is what stops a borrowed session from locking
  // the real owner out of their own account.
  if (!(await Hash.check(current_password, user.password))) {
    http.flash("error", __("Your current password is not correct."));
    http.redirect("/profile", 303);
    return;
  }

  user.password = await Hash.make(password);
  await user.save();

  http.flash("success", __("Password updated."));
  http.redirect("/profile", 303);
}
