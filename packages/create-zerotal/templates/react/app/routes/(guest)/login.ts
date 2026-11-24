import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth, loginThrottle } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { passkeysEnabled } from "@app/auth/passkeys";
import { socialProviders } from "@app/auth/social";
import { intendedUrl } from "@app/support/redirects";
import { rejectInput } from "@app/support/validation";

// GET /login
export const GET = async () => {
  return Inertia.render("auth/login", {
    title: "Sign in",
    // Which other ways in to offer. Both are off until their keys are in .env.
    passkeys: passkeysEnabled(),
    providers: socialProviders(),
  });
};

// POST /login
export async function POST(http: HttpContext): Promise<void> {
  const { email, password, remember } = await validate(http, (r) => ({
    email: r.string().trim().email(),
    password: r.string().min(1),
    remember: r.boolean().optional(),
  }));

  // Five wrong passwords for one address from one IP, and that pair waits a minute.
  // Said plainly, with the wait, rather than as a generic failure the visitor retries.
  const wait = loginThrottle.ensureNotLocked(http, email);
  if (wait !== null) {
    rejectInput(
      http,
      { email: `Too many sign-in attempts. Try again in ${wait} second${wait === 1 ? "" : "s"}.` },
      "/login",
    );
  }

  if (!(await Auth.attempt({ email, password }, Boolean(remember)))) {
    loginThrottle.recordFailure(http, email);
    // One message for a wrong address and a wrong password alike. Saying which was
    // wrong would turn this form into a way to discover valid accounts.
    rejectInput(http, { email: "Those credentials do not match our records." }, "/login");
  }

  loginThrottle.clearFor(http, email);

  // The password was right, but this account has two-factor on: the session stays
  // signed out until the code is in. `Auth.login()` made that decision, not this route.
  if (Auth.twoFactorPending()) {
    http.redirect("/two-factor/challenge", 303);
    return;
  }

  http.redirect(intendedUrl(http), 303);
}
