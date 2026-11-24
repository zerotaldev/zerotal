import type { HttpContext } from "zerotal";
import { Auth, TwoFactor } from "zerotal/auth";
import type { User } from "@app/models/User";
import { SETUP_SECRET_KEY } from "@app/auth/two-factor";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { DELETE: { name: "settings.two-factor.destroy" } };

/**
 * Settings → Two-factor.
 *
 * Turning it on takes two steps, so a half-finished setup can never lock anyone out:
 * POST makes a secret and keeps it in the session while the QR code is shown, and only
 * /settings/two-factor/confirm, given a working code from the app, saves it to the user.
 */

// POST /settings/two-factor — start setting it up.
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user() as User;
  if (!user.hasTwoFactorEnabled()) http.session?.set(SETUP_SECRET_KEY, TwoFactor.generateSecret());
  http.redirect("/settings/two-factor", 303);
}

// DELETE /settings/two-factor — turn it off, or abandon a setup.
export async function DELETE(http: HttpContext): Promise<void> {
  const user = Auth.user() as User;
  http.session?.forget(SETUP_SECRET_KEY);

  if (user.hasTwoFactorEnabled()) {
    user.twoFactorSecret = null;
    user.twoFactorRecoveryCodes = null;
    user.twoFactorConfirmedAt = null;
    await user.save();
    http.flash("success", "Two-factor authentication is off.");
  }
  http.redirect("/settings/two-factor", 303);
}
