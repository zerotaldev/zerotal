import type { HttpContext } from "zerotal";
import { Auth, Social } from "zerotal/auth";
import { Log } from "zerotal/logger";
import { enabledProvider, signInWithProvider } from "@app/auth/social";
import { intendedUrl } from "@app/support/redirects";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { GET: { name: "social.callback" }, POST: { name: "social.callback.store" } };

// GET /auth/:provider/callback — where the provider sends the visitor back.
export async function GET(http: HttpContext): Promise<void> {
  const name = enabledProvider(http);

  let profile;
  try {
    // Checks the `state` the redirect stored, then swaps the code for the profile.
    profile = await Social.driver(name).user();
  } catch (error) {
    Log.warn(`Social sign-in with ${name} failed`, {
      reason: error instanceof Error ? error.message : String(error),
    });
    http.flash("error", "That sign-in did not go through. Please try again.");
    http.redirect("/login", 303);
    return;
  }

  const result = await signInWithProvider(name, profile);

  if (result.status === "no-email") {
    http.flash("error", "Your account there has no email address we can use.");
    http.redirect("/login", 303);
    return;
  }
  if (result.status === "needs-password") {
    http.flash(
      "warning",
      `An account already uses ${result.email}. Sign in with your password once to confirm it is yours.`,
    );
    http.redirect("/login", 303);
    return;
  }

  if (Auth.twoFactorPending()) {
    http.redirect("/two-factor/challenge", 303);
    return;
  }
  http.redirect(intendedUrl(http), 303);
}

// Some providers post the callback rather than redirect to it.
export const POST = GET;
