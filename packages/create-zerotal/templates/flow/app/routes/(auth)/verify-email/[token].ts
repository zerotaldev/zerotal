import type { HttpContext } from "zerotal";
import { Auth } from "zerotal/auth";

// Route names, as `route()` knows them. Set here so they read the same across verbs.
export const meta = { GET: { name: "verify-email.verify" } };

// GET /verify-email/:token — the link from the email.
//
// The token is checked against the signed-in user: it names their id and their email
// at the time it was sent, expires after an hour, and works once. A visitor who opens it
// signed out is sent to sign in first and brought back here.
export async function GET(http: HttpContext): Promise<void> {
  const user = Auth.user();

  if (user.hasVerifiedEmail()) {
    http.redirect("/dashboard", 302);
    return;
  }

  if (!(await user.verifyEmailToken(String(http.params["token"] ?? "")))) {
    http.flash("error", "That link is invalid or has expired. Send yourself a new one.");
    http.redirect("/verify-email", 302);
    return;
  }

  http.flash("success", "Thanks — your email address is confirmed.");
  http.redirect("/dashboard", 302);
}
