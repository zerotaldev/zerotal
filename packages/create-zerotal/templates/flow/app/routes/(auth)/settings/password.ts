import type { HttpContext } from "zerotal";
import { AUTH_PASSWORD_HASH_KEY, Auth, Hash } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { revokeOtherSessions } from "@app/auth/sessions";
import { rejectInput } from "@app/support/validation";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { PUT: { name: "settings.password.update" } };

// PUT /settings/password
export async function PUT(http: HttpContext): Promise<void> {
  const user = Auth.user();

  const { current_password, password } = await validate(http, (r) => ({
    current_password: r.string().min(1),
    password: r.string().min(8).confirmed(),
  }));

  // Proving the current password is what stops a borrowed session from locking the
  // real owner out of their own account.
  if (!(await Hash.check(current_password, user.password))) {
    rejectInput(
      http,
      { current_password: "That is not your current password." },
      "/settings/password",
    );
  }

  user.password = await Hash.make(password);
  await user.save();

  // A new password ends every other session: AuthenticateSessionMiddleware sees their
  // stored hash no longer match. This one is kept by recording the new hash here.
  http.session?.set(AUTH_PASSWORD_HASH_KEY, user.password);
  await revokeOtherSessions(http, user.id);

  http.flash("success", "Password changed. Other devices have been signed out.");
  http.redirect("/settings/password", 303);
}
