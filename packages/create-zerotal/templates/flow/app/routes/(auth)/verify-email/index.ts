import type { HttpContext } from "zerotal";
import { Auth } from "zerotal/auth";
import { VerifyEmailNotification } from "@app/notifications/VerifyEmailNotification";

// POST /verify-email — send the link again.
export async function POST(http: HttpContext): Promise<void> {
  const user = Auth.user();
  if (user.hasVerifiedEmail()) {
    http.redirect("/dashboard", 303);
    return;
  }

  await user.notify(new VerifyEmailNotification(user.createEmailVerificationToken()));

  http.flash("success", `A new link is on its way to ${user.email}.`);
  http.redirect("/verify-email", 303);
}
