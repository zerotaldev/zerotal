import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, TwoFactor } from "zerotal/auth";
import type { User } from "@app/models/User";
import { RECOVERY_CODES_FLASH, SETUP_SECRET_KEY } from "@app/auth/two-factor";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { GET: { name: "settings.two-factor" }, DELETE: { name: "settings.two-factor.destroy" } };

/**
 * Settings → Two-factor.
 *
 * Turning it on takes two steps, so a half-finished setup can never lock anyone out:
 * POST makes a secret and keeps it in the session while the QR code is shown, and only
 * /settings/two-factor/confirm, given a working code from the app, saves it to the user.
 */

// GET /settings/two-factor
export const GET = async (http: HttpContext) => {
  const user = Auth.user() as User;
  const pending = user.hasTwoFactorEnabled() ? undefined : http.session?.get(SETUP_SECRET_KEY);

  return Inertia.render("settings/two-factor", {
    title: "Two-factor authentication",
    enabled: user.hasTwoFactorEnabled(),
    // While setting up: the QR code (drawn on the server as inline SVG — the secret is
    // never sent to an image service), and the secret as text for typing in by hand.
    setup:
      typeof pending === "string"
        ? {
            qrSvg: TwoFactor.getQrCodeSvg(user.email, pending, { size: 192 }),
            uri: TwoFactor.getQrCodeUrl(user.email, pending),
            secret: pending,
          }
        : null,
    // Shown once, straight after they are made, and never again.
    recoveryCodes: (http.session?.get(RECOVERY_CODES_FLASH) as string[] | undefined) ?? null,
    recoveryCodesLeft: user.hasTwoFactorEnabled() ? user.recoveryCodeHashes().length : 0,
  });
};

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
