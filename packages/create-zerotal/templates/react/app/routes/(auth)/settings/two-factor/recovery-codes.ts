import type { HttpContext } from "zerotal";
import { Auth, TwoFactor } from "zerotal/auth";
import { RECOVERY_CODES_FLASH } from "@app/auth/two-factor";

// POST /settings/two-factor/recovery-codes — a fresh set. The old ones stop working.
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user();
  if (!user.hasTwoFactorEnabled()) {
    http.redirect("/settings/two-factor", 303);
    return;
  }

  const { plain, hashed } = TwoFactor.generateRecoveryCodes();
  user.twoFactorRecoveryCodes = JSON.stringify(hashed);
  await user.save();

  http.flash(RECOVERY_CODES_FLASH, plain);
  http.flash("success", "New recovery codes made. The old ones no longer work.");
  http.redirect("/settings/two-factor", 303);
}
