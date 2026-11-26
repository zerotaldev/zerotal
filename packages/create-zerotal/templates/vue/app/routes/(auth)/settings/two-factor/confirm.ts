import type { HttpContext } from "zerotal";
import { Auth, TWO_FACTOR_SESSION_KEY, TwoFactor } from "zerotal/auth";
import { validate } from "zerotal/validator";
import type { User } from "@app/models/User";
import { rejectInput } from "@app/support/validation";
import { RECOVERY_CODES_FLASH, SETUP_SECRET_KEY } from "@app/auth/two-factor";

// POST /settings/two-factor/confirm — the first code from the app. Only now is the
// secret saved, with the recovery codes, and the account asks for a code at sign-in.
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user() as User;
  const secret = http.session?.get(SETUP_SECRET_KEY);

  if (typeof secret !== "string") {
    http.redirect("/settings/two-factor", 303);
    return;
  }

  const { code } = await validate(http, (r) => ({ code: r.string().trim().min(6) }));

  // The secret is new, so no code from it has been used yet. The step this one matched
  // is saved below, so the same code can't then sign in a second session.
  const check = TwoFactor.verifyCodeWithCounter(secret, code);
  if (!check.valid) {
    rejectInput(
      http,
      { code: "That code did not match. Try the newest one in the app." },
      "/settings/two-factor",
    );
  }

  const { plain, hashed } = TwoFactor.generateRecoveryCodes();
  user.twoFactorSecret = secret;
  user.twoFactorRecoveryCodes = JSON.stringify(hashed);
  user.twoFactorConfirmedAt = new Date();
  user.twoFactorLastCounter = check.counter;
  await user.save();

  http.session?.forget(SETUP_SECRET_KEY);
  // This session just proved the second factor; don't ask for it again here.
  http.session?.set(TWO_FACTOR_SESSION_KEY, true);
  http.flash(RECOVERY_CODES_FLASH, plain);
  http.flash("success", "Two-factor authentication is on.");
  http.redirect("/settings/two-factor", 303);
}
