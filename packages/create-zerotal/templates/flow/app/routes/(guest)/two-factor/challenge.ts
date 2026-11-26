import type { HttpContext } from "zerotal";
import { Auth, TwoFactor, loginThrottle } from "zerotal/auth";
import { validate } from "zerotal/validator";
import type { User } from "@app/models/User";
import { intendedUrl } from "@app/support/redirects";
import { rejectInput } from "@app/support/validation";
import { claimTwoFactorStep } from "@app/auth/two-factor";

/**
 * The second step of signing in, for an account with two-factor on.
 *
 * The password was right, but `Auth.login()` left the session *pending*: every route
 * still sees a guest. `Auth.pendingTwoFactorUser()` is the one place the account is
 * visible, and `Auth.completeTwoFactor()` finishes the sign-in.
 */

function pendingUser(): User | undefined {
  return Auth.pendingTwoFactorUser() as User | undefined;
}

// POST /two-factor/challenge — a code from the authenticator app, or a recovery code.
export async function POST(http: HttpContext): Promise<void> {
  const user = pendingUser();
  if (!user?.twoFactorSecret) {
    http.flash("info", "Sign in again to continue.");
    http.redirect("/login", 303);
    return;
  }

  const { code, recovery_code } = await validate(http, (r) => ({
    code: r.string().trim().optional(),
    recovery_code: r.string().trim().optional(),
  }));

  // A six-digit code is a million guesses; five a minute makes that a very long time.
  const throttleKey = `two-factor:${user.id}`;
  const wait = loginThrottle.ensureNotLocked(http, throttleKey);
  if (wait !== null) {
    rejectInput(
      http,
      { code: `Too many attempts. Try again in ${wait} seconds.` },
      "/two-factor/challenge",
    );
  }

  if (recovery_code) {
    // Each recovery code works once: the matched one is dropped from the stored set.
    const result = TwoFactor.verifyRecoveryCode(user.recoveryCodeHashes(), recovery_code);
    if (!result.valid) {
      loginThrottle.recordFailure(http, throttleKey);
      rejectInput(
        http,
        { recovery_code: "That recovery code is not valid." },
        "/two-factor/challenge",
      );
    }
    user.twoFactorRecoveryCodes = JSON.stringify(result.remaining);
    await user.save();
  } else {
    // A code works once. The time step it matched is saved, and a code from that step or
    // an earlier one is refused, so a code someone saw over a shoulder or in a screen
    // recording can't be used again while it is still current.
    const check = TwoFactor.verifyCodeWithCounter(
      user.twoFactorSecret,
      code ?? "",
      user.twoFactorLastCounter,
    );
    const step = check.valid ? check.counter : null;
    if (step === null || !(await claimTwoFactorStep(user.id, step))) {
      loginThrottle.recordFailure(http, throttleKey);
      rejectInput(
        http,
        { code: "That code is not valid or was already used. Enter the newest one from your app." },
        "/two-factor/challenge",
      );
    }
  }

  loginThrottle.clearFor(http, throttleKey);
  await Auth.completeTwoFactor();

  if (recovery_code && user.recoveryCodeHashes().length <= 2) {
    http.flash(
      "warning",
      "You are running low on recovery codes. Make new ones in Settings → Two-factor.",
    );
  }
  http.redirect(intendedUrl(http), 303);
}
